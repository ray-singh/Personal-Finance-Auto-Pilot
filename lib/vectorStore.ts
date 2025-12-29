/**
 * Vector Store Module (pgvector)
 * 
 * NeonDB + pgvector-based vector store for RAG.
 * Uses native Postgres vector similarity search for efficient retrieval.
 */

import { eq, and, sql as drizzleSql } from 'drizzle-orm'
import { db, sql, vectorStore } from './db'
import { embedText, formatTransactionForEmbedding } from './embeddings'
import type { DocumentType } from './db/schema'

export { type DocumentType } from './db/schema'

export interface VectorDocument {
  id: number
  userId: string
  docType: DocumentType
  sourceId: string
  text: string
  embedding: number[]
  metadata: Record<string, unknown>
  createdAt: Date | null
}

export interface SearchResult {
  document: VectorDocument
  score: number
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
  const embeddingStr = `[${embedding.join(',')}]`

  // Use raw SQL for upsert with pgvector
  const result = await sql`
    INSERT INTO vector_store (user_id, doc_type, source_id, text, embedding, metadata)
    VALUES (${userId}, ${docType}, ${String(sourceId)}, ${text}, ${embeddingStr}::vector, ${JSON.stringify(metadata)})
    ON CONFLICT (user_id, doc_type, source_id) DO UPDATE SET
      text = EXCLUDED.text,
      embedding = EXCLUDED.embedding,
      metadata = EXCLUDED.metadata,
      created_at = NOW()
    RETURNING id
  `
  return (result[0] as { id: number }).id
}

/**
 * Upsert multiple documents in batch
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

  const ids: number[] = []
  
  // Insert each document
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i]
    const embeddingStr = `[${embeddings[i].join(',')}]`
    
    const result = await sql`
      INSERT INTO vector_store (user_id, doc_type, source_id, text, embedding, metadata)
      VALUES (${doc.userId}, ${doc.docType}, ${String(doc.sourceId)}, ${doc.text}, ${embeddingStr}::vector, ${JSON.stringify(doc.metadata || {})})
      ON CONFLICT (user_id, doc_type, source_id) DO UPDATE SET
        text = EXCLUDED.text,
        embedding = EXCLUDED.embedding,
        metadata = EXCLUDED.metadata,
        created_at = NOW()
      RETURNING id
    `
    ids.push((result[0] as { id: number }).id)
  }

  return ids
}

/**
 * Search for similar documents using pgvector cosine similarity
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
  const embeddingStr = `[${queryEmbedding.join(',')}]`

  // Build doc_type filter
  let docTypeFilter = ''
  if (docTypes && docTypes.length > 0) {
    docTypeFilter = `AND doc_type IN (${docTypes.map(t => `'${t}'`).join(', ')})`
  }

  // Use pgvector's cosine distance operator (<=>)
  // Convert distance to similarity: 1 - distance
  const result = await sql.unsafe(`
    SELECT 
      id,
      user_id,
      doc_type,
      source_id,
      text,
      metadata,
      created_at,
      1 - (embedding <=> '${embeddingStr}'::vector) as similarity
    FROM vector_store
    WHERE user_id = '${userId}'
    ${docTypeFilter}
    ORDER BY embedding <=> '${embeddingStr}'::vector
    LIMIT ${topK}
  `)

  // Cast result through unknown to handle type conversion
  const rows = result as unknown as Array<{
    id: number
    user_id: string
    doc_type: string
    source_id: string
    text: string
    metadata: string
    created_at: Date | null
    similarity: number
  }>

  // Filter by minimum score and map to SearchResult
  return rows
    .filter(row => row.similarity >= minScore)
    .map(row => ({
      document: {
        id: row.id,
        userId: row.user_id,
        docType: row.doc_type as DocumentType,
        sourceId: row.source_id,
        text: row.text,
        embedding: [], // Don't return embedding for efficiency
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
        createdAt: row.created_at,
      },
      score: row.similarity,
    }))
}

/**
 * Delete a document from the vector store
 */
export async function deleteDocument(
  userId: string,
  docType: DocumentType,
  sourceId: string | number
): Promise<boolean> {
  const result = await db.delete(vectorStore)
    .where(and(
      eq(vectorStore.userId, userId),
      eq(vectorStore.docType, docType),
      eq(vectorStore.sourceId, String(sourceId))
    ))
    .returning({ id: vectorStore.id })
  return result.length > 0
}

/**
 * Delete all documents for a user
 */
export async function deleteUserDocuments(userId: string): Promise<number> {
  const result = await db.delete(vectorStore)
    .where(eq(vectorStore.userId, userId))
    .returning({ id: vectorStore.id })
  return result.length
}

/**
 * Get document count for a user
 */
export async function getDocumentCount(userId: string, docType?: DocumentType): Promise<number> {
  let whereClause = eq(vectorStore.userId, userId)
  if (docType) {
    whereClause = and(eq(vectorStore.userId, userId), eq(vectorStore.docType, docType))!
  }

  const [result] = await db.select({ count: drizzleSql<number>`count(*)` })
    .from(vectorStore)
    .where(whereClause)
  
  return Number(result?.count || 0)
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
    category?: string | null
    transactionType?: string | null
  }
): Promise<number> {
  const text = formatTransactionForEmbedding({
    date: transaction.date,
    description: transaction.description,
    amount: transaction.amount,
    category: transaction.category || undefined,
    transaction_type: transaction.transactionType || undefined,
  })
  
  return upsertDocument(userId, 'transaction', transaction.id, text, {
    date: transaction.date,
    amount: transaction.amount,
    category: transaction.category,
    transaction_type: transaction.transactionType,
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
