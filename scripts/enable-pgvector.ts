import { neon } from '@neondatabase/serverless'
import * as dotenv from "dotenv";
dotenv.config({ path: '.env.local' })

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required to enable pgvector. Set it in .env.local or the environment.')
    process.exit(1)
  }

  const sql = neon(url)

  try {
    console.log('Enabling pgvector extension (if not exists)...')
    await sql`CREATE EXTENSION IF NOT EXISTS vector`
    console.log('✅ pgvector enabled')
  } catch (err) {
    console.error('Failed to enable pgvector extension:', err)
    process.exit(1)
  }
}

main()
