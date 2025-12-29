/**
 * Database Initialization Script
 * 
 * Enables the pgvector extension and creates indexes for vector similarity search.
 * Run this once after setting up your NeonDB database.
 * 
 * Usage:
 *   IMPORTANT: If your schema uses the `vector` type, enable the pgvector extension
 *   BEFORE running `drizzle-kit push`. Run the helper below to enable it:
 *     npm run db:enable-vector
 *   Then run:
 *     npm run db:push
 *   After pushing schema, run this script to create indexes and other optional setup:
 *     npm run db:init
 */

import { neon } from '@neondatabase/serverless'
import * as dotenv from "dotenv";
dotenv.config({ path: '.env.local' })

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required.')
    console.log('   Set it to your NeonDB connection string.')
    process.exit(1)
  }

  console.log('🚀 Initializing database extensions...\n')
  
  const sql = neon(process.env.DATABASE_URL)

  try {
    // Enable pgvector extension
    console.log('📦 Enabling pgvector extension...')
    await sql`CREATE EXTENSION IF NOT EXISTS vector`
    console.log('   ✅ pgvector extension enabled\n')

    // Create HNSW index for fast vector similarity search (if not exists)
    console.log('🔍 Creating vector similarity index...')
    await sql`
      CREATE INDEX IF NOT EXISTS vector_store_embedding_idx 
      ON vector_store 
      USING hnsw (embedding vector_cosine_ops)
    `
    console.log('   ✅ HNSW index created for vector_store\n')

    // Create additional useful indexes
    console.log('📊 Creating additional indexes...')
    
    await sql`
      CREATE INDEX IF NOT EXISTS transactions_user_date_idx 
      ON transactions (user_id, date DESC)
    `
    console.log('   ✅ Created transactions user+date index')
    
    await sql`
      CREATE INDEX IF NOT EXISTS transactions_category_idx 
      ON transactions (category)
    `
    console.log('   ✅ Created transactions category index')
    
    await sql`
      CREATE INDEX IF NOT EXISTS vector_store_user_type_idx 
      ON vector_store (user_id, doc_type)
    `
    console.log('   ✅ Created vector_store user+type index\n')

    console.log('✨ Database initialization complete!')
    console.log('\nNext steps:')
    console.log('  1. Run npm run dev to start the application')
    console.log('  2. Upload your transaction data')
    console.log('  3. Run npm run backfill-embeddings to index transactions for RAG')
  } catch (error) {
    console.error('❌ Error initializing database:', error)
    process.exit(1)
  }
}

main()
