/**
 * Embeddings Module
 * 
 * Provides text embedding generation using OpenAI's text-embedding-3-small model.
 * Used for RAG (Retrieval-Augmented Generation) to create vector representations
 * of transactions, queries, and documents for similarity search.
 */

import OpenAI from 'openai'
import * as dotenv from "dotenv";
dotenv.config({ path: '.env.local' })

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Embedding model configuration
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536

/**
 * Generate embedding for a single text string
 */
export async function embedText(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot embed empty text')
  }

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.trim(),
  })

  return response.data[0].embedding
}

/**
 * Generate embeddings for multiple texts in batch
 * More efficient for bulk operations
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return []
  }

  // Filter out empty strings and trim
  const cleanTexts = texts.map(t => t.trim()).filter(t => t.length > 0)
  
  if (cleanTexts.length === 0) {
    return []
  }

  // OpenAI supports up to 2048 texts per batch
  const batchSize = 2048
  const allEmbeddings: number[][] = []

  for (let i = 0; i < cleanTexts.length; i += batchSize) {
    const batch = cleanTexts.slice(i, i + batchSize)
    
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    })

    const batchEmbeddings = response.data.map(d => d.embedding)
    allEmbeddings.push(...batchEmbeddings)
  }

  return allEmbeddings
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA === 0 || normB === 0) {
    return 0
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Format a transaction for embedding
 * Creates a rich text representation that captures semantic meaning
 */
export function formatTransactionForEmbedding(transaction: {
  date: string
  description: string
  amount: number
  category?: string
  transaction_type?: string
}): string {
  const type = transaction.transaction_type || (transaction.amount < 0 ? 'expense' : 'income')
  const absAmount = Math.abs(transaction.amount).toFixed(2)
  const category = transaction.category || 'Uncategorized'
  
  return `${type} of $${absAmount} on ${transaction.date}: ${transaction.description} (category: ${category})`
}

/**
 * Format a user query for embedding
 * Normalizes common financial query patterns
 */
export function formatQueryForEmbedding(query: string): string {
  return query.trim().toLowerCase()
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS }
