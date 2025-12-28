#!/usr/bin/env npx ts-node
/**
 * Backfill Embeddings Script
 * 
 * Generates embeddings for all existing transactions in the database.
 * Run this once after implementing RAG to index historical data.
 * 
 * Usage:
 *   npx ts-node scripts/backfill-embeddings.ts [--user-id <userId>] [--batch-size <n>]
 * 
 * Options:
 *   --user-id    Process only a specific user (default: all users)
 *   --batch-size Number of transactions per batch (default: 50)
 *   --dry-run    Show what would be processed without making changes
 */

import { db, initializeDatabase } from '../lib/database'
import { initializeVectorStore } from '../lib/vectorStore'
import { indexUserTransactions, addQueryExamples, getDefaultQueryExamples } from '../lib/rag'

// Parse command line arguments
const args = process.argv.slice(2)
const getUserIdArg = (): string | null => {
  const idx = args.indexOf('--user-id')
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null
}
const getBatchSize = (): number => {
  const idx = args.indexOf('--batch-size')
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : 50
}
const isDryRun = args.includes('--dry-run')

async function main() {
  console.log('🚀 Starting embeddings backfill...\n')
  
  // Initialize database and vector store
  initializeDatabase()
  initializeVectorStore()
  
  const specificUserId = getUserIdArg()
  const batchSize = getBatchSize()
  
  console.log(`Configuration:`)
  console.log(`  - User ID: ${specificUserId || 'all users'}`)
  console.log(`  - Batch size: ${batchSize}`)
  console.log(`  - Dry run: ${isDryRun}\n`)

  // Get all unique user IDs
  let userIds: string[]
  if (specificUserId) {
    userIds = [specificUserId]
  } else {
    const stmt = db.prepare(`SELECT DISTINCT user_id FROM transactions WHERE user_id != ''`)
    const rows = stmt.all() as Array<{ user_id: string }>
    userIds = rows.map(r => r.user_id)
  }

  if (userIds.length === 0) {
    console.log('⚠️  No users found with transactions.')
    return
  }

  console.log(`Found ${userIds.length} user(s) to process.\n`)

  let totalIndexed = 0
  let totalExamples = 0

  for (const userId of userIds) {
    console.log(`\n📊 Processing user: ${userId.substring(0, 12)}...`)
    
    // Get transaction count for this user
    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM transactions WHERE user_id = ?`)
    const { count } = countStmt.get(userId) as { count: number }
    
    console.log(`   Found ${count} transactions`)
    
    if (isDryRun) {
      console.log(`   [DRY RUN] Would index ${count} transactions and add default examples`)
      continue
    }

    try {
      // Index all transactions for this user
      console.log(`   Indexing transactions...`)
      const indexed = await indexUserTransactions(userId)
      console.log(`   ✅ Indexed ${indexed} transactions`)
      totalIndexed += indexed

      // Add default query examples
      console.log(`   Adding query examples...`)
      const examples = getDefaultQueryExamples()
      const added = await addQueryExamples(userId, examples)
      console.log(`   ✅ Added ${added} query examples`)
      totalExamples += added

    } catch (error) {
      console.error(`   ❌ Error processing user ${userId}:`, error)
    }
  }

  console.log('\n' + '='.repeat(50))
  console.log('📈 Backfill Summary:')
  console.log(`   - Users processed: ${userIds.length}`)
  console.log(`   - Transactions indexed: ${totalIndexed}`)
  console.log(`   - Query examples added: ${totalExamples}`)
  console.log('='.repeat(50))
  
  if (!isDryRun) {
    // Show vector store stats
    const vectorStmt = db.prepare(`SELECT COUNT(*) as count FROM vector_store`)
    const { count: vectorCount } = vectorStmt.get() as { count: number }
    console.log(`\n📦 Vector store now contains ${vectorCount} documents.`)
  }

  console.log('\n✅ Backfill complete!')
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
