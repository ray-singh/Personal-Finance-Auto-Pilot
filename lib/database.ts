/**
 * Database Module (Compatibility Layer)
 * 
 * Re-exports from the new Drizzle-based database for backward compatibility.
 * This file maintains the same API as the old SQLite-based database.ts
 */

// Re-export everything from the new Drizzle modules
export * from './db'
export * from './db/queries'

// Re-export specific items for compatibility
export { 
  transactions, 
  categoryRules, 
  vectorStore,
  type Transaction,
  type NewTransaction,
  type CategoryRule,
} from './db/schema'
