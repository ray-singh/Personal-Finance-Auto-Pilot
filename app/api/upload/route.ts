import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Papa from 'papaparse'
import { insertTransaction, clearTransactions } from '@/lib/db/queries'
import { getTransactionType, parseDate, parseAmount } from '@/lib/categorization'
import { batchCategorize, CategorizationResult } from '@/lib/smartCategorization'
import { indexUserTransactions } from '@/lib/rag'

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

    const formData = await request.formData()
    const file = formData.get('file') as File
    const clearExisting = formData.get('clearExisting') === 'true'

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    const text = await file.text()

    // Parse CSV
    const result = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
    })

    if (result.errors.length > 0) {
      return NextResponse.json(
        { error: 'Error parsing CSV', details: result.errors },
        { status: 400 }
      )
    }

    // Clear existing transactions for this user if requested
    if (clearExisting) {
      await clearTransactions(userId)
    }

    let processedCount = 0
    const errors: string[] = []

    // First pass: collect all valid rows for batch categorization
    const validRows: Array<{
      date: string
      description: string
      amount: string | number
      account: string
    }> = []

    for (const row of result.data as any[]) {
      try {
        const date = row.Date || row.date || row.DATE || 
                     row['Transaction Date'] || row['Posting Date'] || ''
        
        const description = row.Description || row.description || 
                           row.DESCRIPTION || row.Merchant || row.merchant || 
                           row.Name || ''
        
        const amount = row.Amount || row.amount || row.AMOUNT || 
                      row.Debit || row.Credit || 0

        if (!date || !description) {
          errors.push(`Skipping row: missing date or description`)
          continue
        }

        validRows.push({
          date,
          description: description.trim(),
          amount,
          account: row.Account || row.account || 'Default',
        })
      } catch (error) {
        errors.push(`Error processing row: ${error}`)
      }
    }

    // Batch categorize all descriptions at once (much more efficient)
    const descriptions = validRows.map(r => r.description)
    const categorizations = await batchCategorize(descriptions)

    // Second pass: insert transactions with categories
    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]
      const categorizationResult = categorizations[i]

      try {
        const parsedDate = parseDate(row.date)
        const parsedAmount = parseAmount(row.amount)
        const category = categorizationResult.category
        const transactionType = getTransactionType(parsedAmount)

        await insertTransaction({
          userId: userId,
          date: parsedDate,
          description: row.description,
          amount: parsedAmount,
          category,
          transactionType: transactionType,
          account: row.account,
        })

        processedCount++
      } catch (error) {
        errors.push(`Error inserting transaction: ${error}`)
      }
    }

    // Count categorization methods used
    const methodCounts = categorizations.reduce((acc, r) => {
      acc[r.method] = (acc[r.method] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    // Index transactions for RAG (async, don't wait)
    // This allows semantic search over the user's transactions
    indexUserTransactions(userId).catch(err => {
      console.error('Failed to index transactions for RAG:', err)
    })

    return NextResponse.json({
      success: true,
      message: `Successfully processed ${processedCount} transactions`,
      processedCount,
      categorization: {
        byRule: methodCounts['rule'] || 0,
        byPattern: methodCounts['pattern'] || 0,
        byAI: methodCounts['ai'] || 0,
        uncategorized: methodCounts['default'] || 0,
      },
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Failed to process file', details: String(error) },
      { status: 500 }
    )
  }
}
