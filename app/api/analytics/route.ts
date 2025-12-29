import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, transactions } from '@/lib/db'
import { eq, desc, lt, sql, and } from 'drizzle-orm'

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get category breakdown for this user
    const categoryData = await db.select({
      category: transactions.category,
      transaction_count: sql<number>`COUNT(*)`,
      total_spent: sql<number>`ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END))`,
      total_earned: sql<number>`SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)`,
    })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .groupBy(transactions.category)
      .orderBy(desc(sql`ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END))`))

    // Get monthly spending trend for this user (PostgreSQL syntax)
    const monthlyData = await db.select({
      month: sql<string>`TO_CHAR(date::date, 'YYYY-MM')`,
      expenses: sql<number>`ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END))`,
      income: sql<number>`SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)`,
    })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .groupBy(sql`TO_CHAR(date::date, 'YYYY-MM')`)
      .orderBy(desc(sql`TO_CHAR(date::date, 'YYYY-MM')`))
      .limit(12)

    // Get recent transactions for this user
    const recentTransactions = await db.select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(20)

    // Get summary statistics for this user
    const [summary] = await db.select({
      total_transactions: sql<number>`COUNT(*)`,
      total_expenses: sql<number>`ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END))`,
      total_income: sql<number>`SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)`,
      avg_expense: sql<number>`ABS(AVG(CASE WHEN amount < 0 THEN amount ELSE NULL END))`,
      first_transaction_date: sql<string>`MIN(date)`,
      last_transaction_date: sql<string>`MAX(date)`,
    })
      .from(transactions)
      .where(eq(transactions.userId, userId))

    // Get top merchants for this user
    const topMerchants = await db.select({
      description: transactions.description,
      category: transactions.category,
      transaction_count: sql<number>`COUNT(*)`,
      total_amount: sql<number>`ABS(SUM(amount))`,
    })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), lt(transactions.amount, 0)))
      .groupBy(transactions.description, transactions.category)
      .orderBy(desc(sql`ABS(SUM(amount))`))
      .limit(10)

    return NextResponse.json({
      categoryData,
      monthlyData: [...monthlyData].reverse(), // Show oldest to newest
      recentTransactions,
      summary,
      topMerchants,
    })
  } catch (error) {
    console.error('Analytics error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch analytics', details: String(error) },
      { status: 500 }
    )
  }
}
