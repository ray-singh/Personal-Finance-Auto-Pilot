import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, transactions } from '@/lib/db'
import { eq, and, inArray } from 'drizzle-orm'
import { smartCategorize, batchCategorize, normalizeMerchant, CATEGORIES } from '@/lib/smartCategorization'

/**
 * POST /api/recategorize
 * 
 * Recategorize transactions using the smart categorization system.
 * Supports single transaction, batch, or all uncategorized.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { transactionIds, recategorizeAll, onlyOther } = body

    let txnsToProcess: Array<{ id: number; description: string }> = []

    if (recategorizeAll) {
      // Get all transactions (optionally only those categorized as "Other")
      const whereCondition = onlyOther
        ? and(eq(transactions.userId, userId), eq(transactions.category, 'Other'))
        : eq(transactions.userId, userId)

      const allTxns = await db.select({
        id: transactions.id,
        description: transactions.description,
      })
        .from(transactions)
        .where(whereCondition)

      txnsToProcess = allTxns
    } else if (transactionIds && Array.isArray(transactionIds)) {
      // Get specific transactions
      const selectedTxns = await db.select({
        id: transactions.id,
        description: transactions.description,
      })
        .from(transactions)
        .where(and(
          eq(transactions.userId, userId),
          inArray(transactions.id, transactionIds)
        ))

      txnsToProcess = selectedTxns
    } else {
      return NextResponse.json(
        { error: 'Provide transactionIds array or set recategorizeAll: true' },
        { status: 400 }
      )
    }

    if (txnsToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No transactions to recategorize',
        updated: 0,
      })
    }

    // Batch categorize for efficiency
    const descriptions = txnsToProcess.map(t => t.description)
    const results = await batchCategorize(descriptions)

    // Update transactions with new categories
    let updated = 0
    const updates: Array<{ id: number; oldCategory?: string; newCategory: string; method: string }> = []

    for (let i = 0; i < txnsToProcess.length; i++) {
      const txn = txnsToProcess[i]
      const result = results[i]

      // Update the transaction
      const [updatedTxn] = await db.update(transactions)
        .set({ category: result.category })
        .where(and(eq(transactions.id, txn.id), eq(transactions.userId, userId)))
        .returning({ id: transactions.id, category: transactions.category })

      if (updatedTxn) {
        updated++
        updates.push({
          id: txn.id,
          newCategory: result.category,
          method: result.method,
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: `Recategorized ${updated} transaction(s)`,
      updated,
      details: updates.slice(0, 50), // Return first 50 for preview
    })
  } catch (error) {
    console.error('Recategorize error:', error)
    return NextResponse.json(
      { error: 'Failed to recategorize', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET /api/recategorize/preview
 * 
 * Preview what categories would be assigned without actually updating.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const description = searchParams.get('description')

    if (!description) {
      // Return available categories
      return NextResponse.json({
        categories: CATEGORIES,
      })
    }

    // Preview categorization for a single description
    const result = await smartCategorize(description)

    return NextResponse.json({
      description,
      normalizedMerchant: result.normalizedMerchant,
      category: result.category,
      confidence: result.confidence,
      method: result.method,
      suggestRule: result.suggestRule,
    })
  } catch (error) {
    console.error('Preview error:', error)
    return NextResponse.json(
      { error: 'Failed to preview categorization', details: String(error) },
      { status: 500 }
    )
  }
}
