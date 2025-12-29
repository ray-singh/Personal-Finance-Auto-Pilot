/**
 * Drizzle ORM Schema
 * 
 * Defines the database schema for NeonDB (Postgres) with pgvector support.
 * Uses Drizzle ORM for type-safe queries and migrations.
 */

import { pgTable, text, serial, real, timestamp, index, uniqueIndex, customType } from 'drizzle-orm/pg-core'

// Custom type for pgvector
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)' // OpenAI text-embedding-3-small dimension
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`
  },
  fromDriver(value: string): number[] {
    // Parse pgvector string format: [0.1,0.2,0.3,...]
    const cleaned = value.replace(/[\[\]]/g, '')
    return cleaned.split(',').map(Number)
  },
})

// ============================================================================
// TRANSACTIONS TABLE
// ============================================================================

export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD format
  description: text('description').notNull(),
  amount: real('amount').notNull(),
  category: text('category'),
  account: text('account'),
  transactionType: text('transaction_type'), // 'expense' | 'income'
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_transactions_user_id').on(table.userId),
  dateIdx: index('idx_transactions_date').on(table.date),
  categoryIdx: index('idx_transactions_category').on(table.category),
  userDateIdx: index('idx_transactions_user_date').on(table.userId, table.date),
}))

export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert

// ============================================================================
// CATEGORY RULES TABLE
// ============================================================================

export const categoryRules = pgTable('category_rules', {
  id: serial('id').primaryKey(),
  pattern: text('pattern').notNull().unique(),
  category: text('category').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  patternIdx: uniqueIndex('idx_category_rules_pattern').on(table.pattern),
}))

export type CategoryRule = typeof categoryRules.$inferSelect
export type NewCategoryRule = typeof categoryRules.$inferInsert

// ============================================================================
// VECTOR STORE TABLE (pgvector)
// ============================================================================

export const vectorStore = pgTable('vector_store', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  docType: text('doc_type').notNull(), // 'transaction' | 'category_rule' | 'query_example' | 'schema'
  sourceId: text('source_id').notNull(),
  text: text('text').notNull(),
  embedding: vector('embedding').notNull(),
  metadata: text('metadata').default('{}'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_vector_store_user_id').on(table.userId),
  docTypeIdx: index('idx_vector_store_doc_type').on(table.docType),
  userDocTypeIdx: index('idx_vector_store_user_doctype').on(table.userId, table.docType),
  // Note: HNSW index for vector similarity should be created manually:
  // CREATE INDEX ON vector_store USING hnsw (embedding vector_cosine_ops);
  uniqueDoc: uniqueIndex('idx_vector_store_unique').on(table.userId, table.docType, table.sourceId),
}))

export type VectorStoreDoc = typeof vectorStore.$inferSelect
export type NewVectorStoreDoc = typeof vectorStore.$inferInsert

// Document types enum
export type DocumentType = 'transaction' | 'category_rule' | 'query_example' | 'schema'
