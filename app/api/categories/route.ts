import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, transactions, categoryRules } from '@/lib/db'
import { 
  getCategoryRules, 
  insertCategoryRule, 
  deleteCategoryRule as deleteCategoryRuleQuery 
} from '@/lib/db/queries'
import { eq, and, like, sql } from 'drizzle-orm'

export async function GET() {
  try {
    // Check authentication
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const rules = await getCategoryRules()

    return NextResponse.json({ rules })
  } catch (error) {
    console.error('Categories error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch categories', details: String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { pattern, category } = await request.json()

    if (!pattern || !category) {
      return NextResponse.json(
        { error: 'Pattern and category are required' },
        { status: 400 }
      )
    }

    const rule = await insertCategoryRule({
      pattern: pattern.toUpperCase(),
      category,
    })

    // Re-categorize existing transactions with this pattern (only for this user)
    // Use PostgreSQL ILIKE for case-insensitive matching
    const updateResult = await db.update(transactions)
      .set({ category })
      .where(and(
        eq(transactions.userId, userId),
        like(sql`UPPER(description)`, `%${pattern.toUpperCase()}%`)
      ))
      .returning({ id: transactions.id })

    return NextResponse.json({
      success: true,
      ruleId: rule.id,
      transactionsUpdated: updateResult.length,
    })
  } catch (error: any) {
    if (error.code === '23505') { // PostgreSQL unique violation
      return NextResponse.json(
        { error: 'This pattern already exists' },
        { status: 400 }
      )
    }
    console.error('Add category error:', error)
    return NextResponse.json(
      { error: 'Failed to add category rule', details: String(error) },
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

    if (!id) {
      return NextResponse.json(
        { error: 'Rule ID is required' },
        { status: 400 }
      )
    }

    const deleted = await deleteCategoryRuleQuery(parseInt(id))

    return NextResponse.json({
      success: true,
      deleted,
    })
  } catch (error) {
    console.error('Delete category error:', error)
    return NextResponse.json(
      { error: 'Failed to delete category rule', details: String(error) },
      { status: 500 }
    )
  }
}
