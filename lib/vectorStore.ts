/**
 * Vector Store Module
 * 
 * SQLite-based vector store for RAG (Retrieval-Augmented Generation).
 * Stores embeddings with metadata and provides similarity search.
 * 
 * Uses manual cosine similarity for simplicity and portability.
 */

import { db } from './database'
import { embedText, cosineSimilarity, formatTransactionForEmbedding } from './embeddings'

// Document types for different content
export type DocumentType = 'transaction' | 'category_rule' | 'query_example' | 'schema'

export interface VectorDocument {
  id: number
  userId: string
  docType: DocumentType
  sourceId: string | number  // ID of the source record (e.g., transaction id)
  text: string
  embedding: number[]
  metadata: Record<string, unknown>
  createdAt: string
}

export interface SearchResult {
  document: VectorDocument
  score: number
}

/**
 * Initialize the vector store table
 */
export function initializeVectorStore() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vector_store (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, doc_type, source_id)
    )
  `)

  // Create indexes for efficient querying
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vector_store_user_id ON vector_store(user_id);
    CREATE INDEX IF NOT EXISTS idx_vector_store_doc_type ON vector_store(doc_type);
    CREATE INDEX IF NOT EXISTS idx_vector_store_user_doctype ON vector_store(user_id, doc_type);
  `)
}

/**
 * Serialize embedding array to Buffer for storage
 */
function serializeEmbedding(embedding: number[]): Buffer {
  const float32Array = new Float32Array(embedding)
  return Buffer.from(float32Array.buffer)
}

/**
 * Deserialize Buffer to embedding array
 */
function deserializeEmbedding(buffer: Buffer): number[] {
  const float32Array = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
  return Array.from(float32Array)
}

/**
 * Upsert a document with its embedding
 */
export async function upsertDocument(
  userId: string,
  docType: DocumentType,
  sourceId: string | number,
  text: string,
  metadata: Record<string, unknown> = {}
): Promise<number> {
  // Generate embedding
  const embedding = await embedText(text)
  const embeddingBlob = serializeEmbedding(embedding)

  const stmt = db.prepare(`
    INSERT INTO vector_store (user_id, doc_type, source_id, text, embedding, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, doc_type, source_id) DO UPDATE SET
      text = excluded.text,
      embedding = excluded.embedding,
      metadata = excluded.metadata,
      created_at = CURRENT_TIMESTAMP
  `)

  const result = stmt.run(
    userId,
    docType,
    String(sourceId),
    text,
    embeddingBlob,
    JSON.stringify(metadata)
  )

  return result.lastInsertRowid as number
}

/**
 * Upsert multiple documents in batch (more efficient)
 */
export async function upsertDocuments(
  documents: Array<{
    userId: string
    docType: DocumentType
    sourceId: string | number
    text: string
    metadata?: Record<string, unknown>
  }>
): Promise<number[]> {
  const { embedTexts } = await import('./embeddings')
  
  // Generate all embeddings in batch
  const texts = documents.map(d => d.text)
  const embeddings = await embedTexts(texts)

  const stmt = db.prepare(`
    INSERT INTO vector_store (user_id, doc_type, source_id, text, embedding, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, doc_type, source_id) DO UPDATE SET
      text = excluded.text,
      embedding = excluded.embedding,
      metadata = excluded.metadata,
      created_at = CURRENT_TIMESTAMP
  `)

  const insertMany = db.transaction((docs: typeof documents) => {
    const ids: number[] = []
    docs.forEach((doc, i) => {
      const result = stmt.run(
        doc.userId,
        doc.docType,
        String(doc.sourceId),
        doc.text,
        serializeEmbedding(embeddings[i]),
        JSON.stringify(doc.metadata || {})
      )
      ids.push(result.lastInsertRowid as number)
    })
    return ids
  })

  return insertMany(documents)
}

/**
 * Search for similar documents using cosine similarity
 */
export async function searchSimilar(
  userId: string,
  query: string,
  options: {
    topK?: number
    docTypes?: DocumentType[]
    minScore?: number
  } = {}
): Promise<SearchResult[]> {
  const { topK = 10, docTypes, minScore = 0.5 } = options

  // Generate query embedding
  const queryEmbedding = await embedText(query)

  // Build SQL query with optional doc_type filter
  let sql = `SELECT * FROM vector_store WHERE user_id = ?`
  const params: (string | number)[] = [userId]

  if (docTypes && docTypes.length > 0) {
    const placeholders = docTypes.map(() => '?').join(', ')
    sql += ` AND doc_type IN (${placeholders})`
    params.push(...docTypes)
  }

  const stmt = db.prepare(sql)
  const rows = stmt.all(...params) as Array<{
    id: number
    user_id: string
    doc_type: string
    source_id: string
    text: string
    embedding: Buffer
    metadata: string
    created_at: string
  }>

  // Calculate similarity scores
  const results: SearchResult[] = rows.map(row => {
    const embedding = deserializeEmbedding(row.embedding)
    const score = cosineSimilarity(queryEmbedding, embedding)
    
    return {
      document: {
        id: row.id,
        userId: row.user_id,
        docType: row.doc_type as DocumentType,
        sourceId: row.source_id,
        text: row.text,
        embedding,
        metadata: JSON.parse(row.metadata),
        createdAt: row.created_at,
      },
      score,
    }
  })

  // Filter by minimum score and sort by similarity (descending)
  return results
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/**
 * Delete a document from the vector store
 */
export function deleteDocument(
  userId: string,
  docType: DocumentType,
  sourceId: string | number
): boolean {
  const stmt = db.prepare(`
    DELETE FROM vector_store 
    WHERE user_id = ? AND doc_type = ? AND source_id = ?
  `)
  const result = stmt.run(userId, docType, String(sourceId))
  return result.changes > 0
}

/**
 * Delete all documents for a user
 */
export function deleteUserDocuments(userId: string): number {
  const stmt = db.prepare(`DELETE FROM vector_store WHERE user_id = ?`)
  const result = stmt.run(userId)
  return result.changes
}

/**
 * Get document count for a user
 */
export function getDocumentCount(userId: string, docType?: DocumentType): number {
  let sql = `SELECT COUNT(*) as count FROM vector_store WHERE user_id = ?`
  const params: string[] = [userId]

  if (docType) {
    sql += ` AND doc_type = ?`
    params.push(docType)
  }

  const stmt = db.prepare(sql)
  const result = stmt.get(...params) as { count: number }
  return result.count
}

/**
 * Embed a transaction and store it
 */
export async function embedTransaction(
  userId: string,
  transaction: {
    id: number
    date: string
    description: string
    amount: number
    category?: string
    transaction_type?: string
  }
): Promise<number> {
  const text = formatTransactionForEmbedding(transaction)
  
  return upsertDocument(userId, 'transaction', transaction.id, text, {
    date: transaction.date,
    amount: transaction.amount,
    category: transaction.category,
    transaction_type: transaction.transaction_type,
  })
}

/**
 * Retrieve context for a query (main RAG retrieval function)
 */
export async function retrieveContext(
  userId: string,
  query: string,
  options: {
    topK?: number
    includeTransactions?: boolean
    includeCategoryRules?: boolean
    includeExamples?: boolean
  } = {}
): Promise<{
  context: string
  sources: SearchResult[]
}> {
  const {
    topK = 5,
    includeTransactions = true,
    includeCategoryRules = true,
    includeExamples = true,
  } = options

  const docTypes: DocumentType[] = []
  if (includeTransactions) docTypes.push('transaction')
  if (includeCategoryRules) docTypes.push('category_rule')
  if (includeExamples) docTypes.push('query_example')

  const results = await searchSimilar(userId, query, {
    topK,
    docTypes,
    minScore: 0.4,
  })

  if (results.length === 0) {
    return { context: '', sources: [] }
  }

  // Format context for LLM consumption
  const contextParts = results.map((r, i) => {
    const typeLabel = r.document.docType === 'transaction' ? 'Transaction' :
                      r.document.docType === 'category_rule' ? 'Category Rule' :
                      r.document.docType === 'query_example' ? 'Example' : 'Document'
    return `[${typeLabel} ${i + 1}] ${r.document.text}`
  })

  return {
    context: contextParts.join('\n'),
    sources: results,
  }
}

// Initialize on module load
initializeVectorStore()
