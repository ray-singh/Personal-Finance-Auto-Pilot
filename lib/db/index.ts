/**
 * Drizzle ORM Database Client
 * 
 * Configures connection to NeonDB (serverless Postgres) with Drizzle ORM.
 * Provides the main database client and utilities.
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless'
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from './schema'

// Lazy initialization to avoid build-time errors
let _sql: NeonQueryFunction<false, false> | null = null
let _db: NeonHttpDatabase<typeof schema> | null = null

function getConnectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required. Set it to your NeonDB connection string.')
  }
  return url
}

/**
 * Get the raw Neon SQL client for custom queries
 * Lazy-initialized on first access
 */
export function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    _sql = neon(getConnectionString())
  }
  return _sql
}

/**
 * Get the Drizzle database client
 * Lazy-initialized on first access
 */
export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(getSql(), { schema })
  }
  return _db
}

// Export getters as the main exports
// These will be called at runtime, not build time
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_, prop) {
    return (getDb() as any)[prop]
  }
})

export const sql = new Proxy((() => {}) as unknown as NeonQueryFunction<false, false>, {
  get(_, prop) {
    return (getSql() as any)[prop]
  },
  apply(_, thisArg, args) {
    return (getSql() as any).apply(thisArg, args)
  }
})

// Re-export schema for convenience
export * from './schema'
