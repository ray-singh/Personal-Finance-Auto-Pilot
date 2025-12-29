#!/usr/bin/env tsx
/**
 * Seed default category rules into the database.
 * Usage: npm run db:seed-categories
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { seedCategoryRules } from '../lib/db/queries'
import { neon } from '@neondatabase/serverless'

const DEFAULT_RULES: Array<{ pattern: string; category: string }> = [
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

async function fallbackRawInsert() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is required for fallback raw insertion')
  }
  const sql = neon(url)
  let inserted = 0
  for (const r of DEFAULT_RULES) {
    try {
      await sql`INSERT INTO category_rules (pattern, category) VALUES (${r.pattern}, ${r.category}) ON CONFLICT (pattern) DO NOTHING`
      inserted++
    } catch (e) {
      // log and continue
      console.warn('raw insert failed for', r, e)
    }
  }
  return inserted
}

async function main() {
  try {
    console.log('Seeding default category rules (via Drizzle API)...')
    const inserted = await seedCategoryRules()
    if (inserted && inserted > 0) {
      console.log(`✅ Seed complete. Inserted ${inserted} rules.`)
      return
    }

    console.log('Drizzle seed did not insert records (attempting fallback raw inserts)...')
    const rawInserted = await fallbackRawInsert()
    console.log(`✅ Fallback complete. Attempted raw inserts for ${rawInserted} rules (some may have conflicted).`)
  } catch (err) {
    console.error('Failed to seed category rules:', err)
    process.exit(1)
  }
}

main()
