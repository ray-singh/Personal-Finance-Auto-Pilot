import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Papa from 'papaparse'
import { insertTransaction, clearTransactions } from '@/lib/database'
import { categorizeTransaction, getTransactionType, parseDate, parseAmount } from '@/lib/categorization'
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
      clearTransactions(userId)
    }

    let processedCount = 0
    const errors: string[] = []

    // Process each row
    for (const row of result.data as any[]) {
      try {
        // Try to identify date, description, and amount columns
        // Support common CSV formats
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

        // Parse and normalize data
        const parsedDate = parseDate(date)
        const parsedAmount = parseAmount(amount)
        const category = categorizeTransaction(description)
        const transactionType = getTransactionType(parsedAmount)

        // Insert into database with user_id
        insertTransaction({
          user_id: userId,
          date: parsedDate,
          description: description.trim(),
          amount: parsedAmount,
          category,
          transaction_type: transactionType,
          account: row.Account || row.account || 'Default',
        })

        processedCount++
      } catch (error) {
        errors.push(`Error processing row: ${error}`)
      }
    }

    // Index transactions for RAG (async, don't wait)
    // This allows semantic search over the user's transactions
    indexUserTransactions(userId).catch(err => {
      console.error('Failed to index transactions for RAG:', err)
    })

    return NextResponse.json({
      success: true,
      message: `Successfully processed ${processedCount} transactions`,
      processedCount,
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
