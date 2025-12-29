import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, transactions } from '@/lib/db'
import { 
  getTransactionCount, 
  deleteTransaction as deleteTransactionQuery, 
  clearTransactions,
  updateTransaction as updateTransactionQuery 
} from '@/lib/db/queries'
import { eq, and, gte, lte, like, desc, asc, sql } from 'drizzle-orm'

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

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')
    const category = searchParams.get('category')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const search = searchParams.get('search')
    const sortBy = searchParams.get('sortBy') || 'date'
    const sortOrder = searchParams.get('sortOrder') || 'DESC'

    // Build conditions array for Drizzle query
    const conditions = [eq(transactions.userId, userId)]

    if (category) {
      conditions.push(eq(transactions.category, category))
    }

    if (startDate) {
      conditions.push(gte(transactions.date, startDate))
    }

    if (endDate) {
      conditions.push(lte(transactions.date, endDate))
    }

    if (search) {
      conditions.push(like(transactions.description, `%${search}%`))
    }

    // Validate sortBy to prevent SQL injection
    const validSortColumns = ['date', 'amount', 'description', 'category', 'id']
    const safeSortBy = validSortColumns.includes(sortBy) ? sortBy : 'date'
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'

    // Get sorting column reference
    const sortColumn = safeSortBy === 'date' ? transactions.date
      : safeSortBy === 'amount' ? transactions.amount
      : safeSortBy === 'description' ? transactions.description
      : safeSortBy === 'category' ? transactions.category
      : transactions.id

    // Get total count
    const [countResult] = await db.select({ total: sql<number>`count(*)` })
      .from(transactions)
      .where(and(...conditions))

    // Get transactions with sorting
    const orderFn = safeSortOrder === 'ASC' ? asc : desc
    const transactionResults = await db.select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset)

    // Get available categories for filtering (user-specific)
    const categoriesResult = await db.selectDistinct({ category: transactions.category })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(asc(transactions.category))

    return NextResponse.json({
      transactions: transactionResults,
      total: Number(countResult?.total || 0),
      limit,
      offset,
      categories: categoriesResult.map(c => c.category),
    })
  } catch (error) {
    console.error('Transactions error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch transactions', details: String(error) },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Check authentication
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (id) {
      // Delete single transaction (only if it belongs to this user)
      const deleted = await deleteTransactionQuery(parseInt(id), userId)
      return NextResponse.json({ 
        success: true, 
        message: deleted ? 'Deleted 1 transaction' : 'Transaction not found' 
      })
    }

    // Delete all transactions for this user
    const deleteAll = searchParams.get('deleteAll') === 'true'
    if (deleteAll) {
      const count = await clearTransactions(userId)
      return NextResponse.json({ 
        success: true, 
        message: `All ${count} transactions deleted` 
      })
    }

    return NextResponse.json(
      { error: 'No id or deleteAll parameter provided' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete transaction', details: String(error) },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Check authentication
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { id, category, description, learnFromCorrection } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Transaction ID is required' },
        { status: 400 }
      )
    }

    const updates: Partial<{ category: string; description: string }> = {}

    if (category !== undefined) {
      updates.category = category
    }

    if (description !== undefined) {
      updates.description = description
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No updates provided' },
        { status: 400 }
      )
    }

    // Only update if transaction belongs to this user
    const result = await updateTransactionQuery(parseInt(id), userId, updates)

    // If category was changed and learning is requested, create a rule
    let ruleCreated = false
    let rulePattern: string | undefined
    
    if (result && category !== undefined && learnFromCorrection) {
      try {
        // Import dynamically to avoid circular deps
        const { learnFromCorrection: learn } = await import('@/lib/smartCategorization')
        const learningResult = await learn(result.description, category, true)
        ruleCreated = learningResult.ruleCreated
        rulePattern = learningResult.pattern
      } catch (e) {
        console.error('Failed to learn from correction:', e)
      }
    }

    return NextResponse.json({
      success: true,
      message: result ? 'Updated 1 transaction' : 'Transaction not found',
      ruleCreated,
      rulePattern,
    })
  } catch (error) {
    console.error('Update error:', error)
    return NextResponse.json(
      { error: 'Failed to update transaction', details: String(error) },
      { status: 500 }
    )
  }
}
