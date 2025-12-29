/**
 * Database Queries Module
 * 
 * Provides typed query functions using Drizzle ORM.
 * Replaces the old SQLite-based database.ts functions.
 */

import { eq, and, desc, sql, like, gte, lt, asc } from 'drizzle-orm'
import { db, transactions, categoryRules, vectorStore, type Transaction, type NewTransaction, type CategoryRule, type NewCategoryRule } from './index'

// ============================================================================
// TRANSACTION QUERIES
// ============================================================================

/**
 * Insert a new transaction
 */
export async function insertTransaction(transaction: NewTransaction): Promise<Transaction> {
  const [result] = await db.insert(transactions).values(transaction).returning()
  return result
}

/**
 * Insert multiple transactions in batch
 */
export async function insertTransactions(txns: NewTransaction[]): Promise<Transaction[]> {
  if (txns.length === 0) return []
  return db.insert(transactions).values(txns).returning()
}

/**
 * Get transactions for a user
 */
export async function getTransactions(userId: string, limit = 100): Promise<Transaction[]> {
  return db.select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.date))
    .limit(limit)
}

/**
 * Get a single transaction by ID
 */
export async function getTransactionById(id: number, userId: string): Promise<Transaction | undefined> {
  const [result] = await db.select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .limit(1)
  return result
}

/**
 * Update a transaction
 */
export async function updateTransaction(
  id: number,
  userId: string,
  updates: Partial<Omit<NewTransaction, 'id' | 'userId'>>
): Promise<Transaction | undefined> {
  const [result] = await db.update(transactions)
    .set(updates)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .returning()
  return result
}

/**
 * Delete a transaction
 */
export async function deleteTransaction(id: number, userId: string): Promise<boolean> {
  const result = await db.delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .returning({ id: transactions.id })
  return result.length > 0
}

/**
 * Clear all transactions for a user
 */
export async function clearTransactions(userId: string): Promise<number> {
  const result = await db.delete(transactions)
    .where(eq(transactions.userId, userId))
    .returning({ id: transactions.id })
  return result.length
}

/**
 * Search transactions by description
 */
export async function searchTransactions(
  userId: string,
  searchTerm: string,
  limit = 50
): Promise<Transaction[]> {
  return db.select()
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      like(transactions.description, `%${searchTerm}%`)
    ))
    .orderBy(desc(transactions.date))
    .limit(limit)
}

/**
 * Get transactions by date range
 */
export async function getTransactionsByDateRange(
  userId: string,
  startDate: string,
  endDate: string
): Promise<Transaction[]> {
  return db.select()
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      gte(transactions.date, startDate),
      lt(transactions.date, endDate)
    ))
    .orderBy(desc(transactions.date))
}

/**
 * Get transaction count for a user
 */
export async function getTransactionCount(userId: string): Promise<number> {
  const [result] = await db.select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.userId, userId))
  return Number(result?.count || 0)
}

// ============================================================================
// CATEGORY RULES QUERIES
// ============================================================================

/**
 * Get all category rules
 */
export async function getCategoryRules(): Promise<CategoryRule[]> {
  return db.select().from(categoryRules).orderBy(asc(categoryRules.pattern))
}

/**
 * Insert a category rule
 */
export async function insertCategoryRule(rule: NewCategoryRule): Promise<CategoryRule> {
  const [result] = await db.insert(categoryRules).values(rule).returning()
  return result
}

/**
 * Delete a category rule
 */
export async function deleteCategoryRule(id: number): Promise<boolean> {
  const result = await db.delete(categoryRules)
    .where(eq(categoryRules.id, id))
    .returning({ id: categoryRules.id })
  return result.length > 0
}

/**
 * Insert default category rules (upsert-like behavior)
 */
export async function seedCategoryRules(): Promise<number> {
  const defaultRules: NewCategoryRule[] = [
    { pattern: 'STARBUCKS', category: 'Coffee' },
    { pattern: 'COFFEE', category: 'Coffee' },
    { pattern: 'DUNKIN', category: 'Coffee' },
    { pattern: 'PEET', category: 'Coffee' },
    { pattern: 'WHOLE FOODS', category: 'Groceries' },
    { pattern: 'SAFEWAY', category: 'Groceries' },
    { pattern: 'TRADER JOE', category: 'Groceries' },
    { pattern: 'KROGER', category: 'Groceries' },
    { pattern: 'WALMART', category: 'Groceries' },
    { pattern: 'TARGET', category: 'Shopping' },
    { pattern: 'AMAZON', category: 'Shopping' },
    { pattern: 'UBER', category: 'Transportation' },
    { pattern: 'LYFT', category: 'Transportation' },
    { pattern: 'SHELL', category: 'Gas' },
    { pattern: 'CHEVRON', category: 'Gas' },
    { pattern: 'EXXON', category: 'Gas' },
    { pattern: 'BP ', category: 'Gas' },
    { pattern: 'NETFLIX', category: 'Entertainment' },
    { pattern: 'SPOTIFY', category: 'Entertainment' },
    { pattern: 'HULU', category: 'Entertainment' },
    { pattern: 'DISNEY', category: 'Entertainment' },
    { pattern: 'RESTAURANT', category: 'Dining' },
    { pattern: 'PIZZA', category: 'Dining' },
    { pattern: 'MCDONALD', category: 'Dining' },
    { pattern: 'CHIPOTLE', category: 'Dining' },
    { pattern: 'SUBWAY', category: 'Dining' },
    { pattern: 'VENMO', category: 'Transfer' },
    { pattern: 'PAYPAL', category: 'Transfer' },
    { pattern: 'ZELLE', category: 'Transfer' },
    { pattern: 'ATM', category: 'Cash Withdrawal' },
    { pattern: 'PHARMACY', category: 'Healthcare' },
    { pattern: 'CVS', category: 'Healthcare' },
    { pattern: 'WALGREENS', category: 'Healthcare' },
    { pattern: 'GYM', category: 'Fitness' },
    { pattern: 'FITNESS', category: 'Fitness' },
  ]

  let inserted = 0
  for (const rule of defaultRules) {
    try {
      await db.insert(categoryRules)
        .values(rule)
        .onConflictDoNothing({ target: categoryRules.pattern })
      inserted++
    } catch {
      // Ignore conflicts
    }
  }
  return inserted
}

// ============================================================================
// ANALYTICS QUERIES
// ============================================================================

/**
 * Get financial summary for a user
 */
export async function getFinancialSummary(userId: string, dateFilter?: { start: string; end: string }) {
  // Build conditions array
  const conditions = [eq(transactions.userId, userId)]
  
  if (dateFilter) {
    conditions.push(gte(transactions.date, dateFilter.start))
    conditions.push(lt(transactions.date, dateFilter.end))
  }

  const [result] = await db.select({
    totalTransactions: sql<number>`count(*)`,
    totalExpenses: sql<number>`COALESCE(ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)), 0)`,
    totalIncome: sql<number>`COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)`,
    netSavings: sql<number>`COALESCE(SUM(amount), 0)`,
    avgExpense: sql<number>`COALESCE(AVG(CASE WHEN amount < 0 THEN ABS(amount) ELSE NULL END), 0)`,
    earliestDate: sql<string>`MIN(date)`,
    latestDate: sql<string>`MAX(date)`,
  }).from(transactions).where(and(...conditions))

  return result
}

/**
 * Get spending by category
 */
export async function getSpendingByCategory(userId: string, limit = 10) {
  return db.select({
    category: transactions.category,
    total: sql<number>`ROUND(ABS(SUM(amount)), 2)`,
    count: sql<number>`count(*)`,
  })
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      lt(transactions.amount, 0)
    ))
    .groupBy(transactions.category)
    .orderBy(desc(sql`ABS(SUM(amount))`))
    .limit(limit)
}

/**
 * Get monthly spending trends
 */
export async function getMonthlyTrends(userId: string, months = 12) {
  return db.select({
    month: sql<string>`TO_CHAR(date::date, 'YYYY-MM')`,
    expenses: sql<number>`ROUND(ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)), 2)`,
    income: sql<number>`ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 2)`,
    net: sql<number>`ROUND(SUM(amount), 2)`,
  })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .groupBy(sql`TO_CHAR(date::date, 'YYYY-MM')`)
    .orderBy(desc(sql`TO_CHAR(date::date, 'YYYY-MM')`))
    .limit(months)
}

// ============================================================================
// RAW SQL EXECUTION (for agent tools)
// ============================================================================

/**
 * Execute a raw SQL query (SELECT only, for agent tools)
 * Injects user_id filter for security
 */
export async function executeRawQuery(userId: string, query: string): Promise<Record<string, unknown>[]> {
  // Security: Only allow SELECT statements
  const normalizedQuery = query.trim().toUpperCase()
  if (!normalizedQuery.startsWith('SELECT')) {
    throw new Error('Only SELECT queries are allowed')
  }

  // Security: Inject user_id filter
  let secureQuery = query
  const fromTransactionsRegex = /FROM\s+transactions\b/gi
  const hasWhere = /FROM\s+transactions\s+WHERE/gi.test(query)
  
  if (fromTransactionsRegex.test(query)) {
    if (hasWhere) {
      secureQuery = query.replace(
        /FROM\s+transactions\s+WHERE/gi,
        `FROM transactions WHERE user_id = '${userId}' AND`
      )
    } else {
      secureQuery = query.replace(
        /FROM\s+transactions\b/gi,
        `FROM transactions WHERE user_id = '${userId}'`
      )
    }
  }

  // Execute using raw SQL with Neon's tagged template literal
  // We use sql.unsafe() by creating a template from the string
  const { sql: neonSql } = await import('./index')
  const result = await neonSql.call(null, [secureQuery] as unknown as TemplateStringsArray)
  return result as Record<string, unknown>[]
}

// ============================================================================
// SCHEMA INFO (for agent tools)
// ============================================================================

/**
 * Get all table names
 */
export async function getAllTables(): Promise<{ name: string }[]> {
  const { sql: neonSql } = await import('./index')
  const result = await neonSql`
    SELECT table_name as name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
  `
  return result as { name: string }[]
}

/**
 * Get table schema (columns)
 */
export async function getTableSchema(tableName: string): Promise<{ column_name: string; data_type: string }[]> {
  const { sql: neonSql } = await import('./index')
  const result = await neonSql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = ${tableName}
    ORDER BY ordinal_position
  `
  return result as { column_name: string; data_type: string }[]
}
