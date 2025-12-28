/**
 * RAG (Retrieval-Augmented Generation) Module
 * 
 * High-level interface for RAG operations in the finance app.
 * Provides query augmentation, context retrieval, and response generation
 * with source citations.
 */

import { retrieveContext, searchSimilar, embedTransaction, upsertDocument, type DocumentType } from './vectorStore'
import { formatQueryForEmbedding } from './embeddings'
import { db } from './database'

export interface RAGResponse {
  augmentedPrompt: string
  context: string
  sources: Array<{
    id: number
    type: DocumentType
    text: string
    score: number
    sourceId: string
  }>
}

export interface QueryExample {
  naturalLanguage: string
  sql: string
  explanation: string
}

/**
 * Augment a user query with retrieved context
 * This is the main entry point for RAG in the agent
 */
export async function augmentQuery(
  userId: string,
  query: string,
  options: {
    topK?: number
    includeSchema?: boolean
  } = {}
): Promise<RAGResponse> {
  const { topK = 5, includeSchema = true } = options

  // Get relevant context from vector store
  const { context, sources } = await retrieveContext(userId, query, {
    topK,
    includeTransactions: true,
    includeCategoryRules: true,
    includeExamples: true,
  })

  // Build augmented prompt
  let augmentedPrompt = ''

  if (includeSchema) {
    augmentedPrompt += `DATABASE SCHEMA:
TABLE: transactions
- id: INTEGER PRIMARY KEY
- date: TEXT (YYYY-MM-DD format)
- description: TEXT (merchant/transaction description)
- amount: REAL (negative for expenses, positive for income)
- category: TEXT (Coffee, Groceries, Dining, Transportation, etc.)
- transaction_type: TEXT ('expense' or 'income')

`
  }

  if (context) {
    augmentedPrompt += `RELEVANT CONTEXT FROM USER'S DATA:
${context}

`
  }

  augmentedPrompt += `USER QUERY: ${query}`

  return {
    augmentedPrompt,
    context,
    sources: sources.map(s => ({
      id: s.document.id,
      type: s.document.docType,
      text: s.document.text,
      score: s.score,
      sourceId: s.document.sourceId as string,
    })),
  }
}

/**
 * Index all transactions for a user
 * Call this after bulk import or periodically
 */
export async function indexUserTransactions(userId: string): Promise<number> {
  const stmt = db.prepare(`
    SELECT id, date, description, amount, category, transaction_type
    FROM transactions
    WHERE user_id = ?
  `)
  
  const transactions = stmt.all(userId) as Array<{
    id: number
    date: string
    description: string
    amount: number
    category: string
    transaction_type: string
  }>

  let indexed = 0
  
  // Process in batches of 100
  const batchSize = 100
  for (let i = 0; i < transactions.length; i += batchSize) {
    const batch = transactions.slice(i, i + batchSize)
    
    for (const tx of batch) {
      try {
        await embedTransaction(userId, tx)
        indexed++
      } catch (error) {
        console.error(`Failed to embed transaction ${tx.id}:`, error)
      }
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < transactions.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return indexed
}

/**
 * Index a single new transaction (call after insert)
 */
export async function indexNewTransaction(
  userId: string,
  transaction: {
    id: number
    date: string
    description: string
    amount: number
    category?: string
    transaction_type?: string
  }
): Promise<void> {
  await embedTransaction(userId, transaction)
}

/**
 * Add NL→SQL examples for few-shot learning
 * These help the model generate better SQL
 */
export async function addQueryExamples(
  userId: string,
  examples: QueryExample[]
): Promise<number> {
  let added = 0

  for (const example of examples) {
    const text = `Question: "${example.naturalLanguage}" → SQL: ${example.sql}`
    
    try {
      await upsertDocument(
        userId,
        'query_example',
        `example_${added}`,
        text,
        {
          naturalLanguage: example.naturalLanguage,
          sql: example.sql,
          explanation: example.explanation,
        }
      )
      added++
    } catch (error) {
      console.error('Failed to add query example:', error)
    }
  }

  return added
}

/**
 * Get default NL→SQL examples for bootstrapping
 */
export function getDefaultQueryExamples(): QueryExample[] {
  return [
    {
      naturalLanguage: "How much did I spend on coffee this month?",
      sql: "SELECT SUM(ABS(amount)) as total FROM transactions WHERE category = 'Coffee' AND date >= date('now', 'start of month') AND user_id = ?",
      explanation: "Sum absolute amount for Coffee category in current month",
    },
    {
      naturalLanguage: "What are my top 5 expense categories?",
      sql: "SELECT category, SUM(ABS(amount)) as total FROM transactions WHERE amount < 0 AND user_id = ? GROUP BY category ORDER BY total DESC LIMIT 5",
      explanation: "Group expenses by category, sum amounts, order by total descending",
    },
    {
      naturalLanguage: "Show my spending trend by month",
      sql: "SELECT strftime('%Y-%m', date) as month, SUM(ABS(amount)) as total FROM transactions WHERE amount < 0 AND user_id = ? GROUP BY month ORDER BY month",
      explanation: "Group expenses by month, show trend over time",
    },
    {
      naturalLanguage: "What did I spend at restaurants last week?",
      sql: "SELECT SUM(ABS(amount)) as total FROM transactions WHERE category = 'Dining' AND date >= date('now', '-7 days') AND user_id = ?",
      explanation: "Sum Dining category for last 7 days",
    },
    {
      naturalLanguage: "List my largest purchases",
      sql: "SELECT date, description, ABS(amount) as amount, category FROM transactions WHERE amount < 0 AND user_id = ? ORDER BY ABS(amount) DESC LIMIT 10",
      explanation: "Order expenses by absolute amount descending, limit to 10",
    },
    {
      naturalLanguage: "How much income did I receive this year?",
      sql: "SELECT SUM(amount) as total FROM transactions WHERE amount > 0 AND date >= date('now', 'start of year') AND user_id = ?",
      explanation: "Sum positive amounts (income) for current year",
    },
    {
      naturalLanguage: "Compare my spending this month vs last month",
      sql: "SELECT 'This Month' as period, SUM(ABS(amount)) as total FROM transactions WHERE amount < 0 AND date >= date('now', 'start of month') AND user_id = ? UNION ALL SELECT 'Last Month', SUM(ABS(amount)) FROM transactions WHERE amount < 0 AND date >= date('now', '-1 month', 'start of month') AND date < date('now', 'start of month') AND user_id = ?",
      explanation: "Use UNION to compare current month vs previous month spending",
    },
    {
      naturalLanguage: "What subscriptions do I have?",
      sql: "SELECT description, amount, date FROM transactions WHERE category = 'Subscriptions' AND user_id = ? ORDER BY date DESC LIMIT 20",
      explanation: "List recent subscription transactions",
    },
  ]
}

/**
 * Bootstrap RAG for a new user with default examples
 */
export async function bootstrapUserRAG(userId: string): Promise<{
  transactionsIndexed: number
  examplesAdded: number
}> {
  // Index existing transactions
  const transactionsIndexed = await indexUserTransactions(userId)

  // Add default query examples
  const examples = getDefaultQueryExamples()
  const examplesAdded = await addQueryExamples(userId, examples)

  return { transactionsIndexed, examplesAdded }
}

/**
 * Search for similar transactions (useful for categorization)
 */
export async function findSimilarTransactions(
  userId: string,
  description: string,
  topK: number = 5
): Promise<Array<{
  description: string
  category: string
  amount: number
  score: number
}>> {
  const results = await searchSimilar(userId, description, {
    topK,
    docTypes: ['transaction'],
    minScore: 0.6,
  })

  return results.map(r => ({
    description: r.document.text,
    category: (r.document.metadata.category as string) || 'Unknown',
    amount: (r.document.metadata.amount as number) || 0,
    score: r.score,
  }))
}
