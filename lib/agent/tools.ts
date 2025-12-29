/**
 * Agent Tools Module (Drizzle/NeonDB/Postgres)
 * 
 * Provides LangChain tools for the AI agent to interact with the database.
 * Uses Drizzle ORM with NeonDB (Postgres) and pgvector for RAG.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { sql } from "../db";
import { 
  getTransactions, 
  getSpendingByCategory, 
  getFinancialSummary, 
  getMonthlyTrends,
  searchTransactions,
  executeRawQuery 
} from "../db/queries";
import { augmentQuery, findSimilarTransactions } from "../rag";
import { 
  smartCategorize, 
  batchCategorize, 
  learnFromCorrection, 
  CATEGORIES,
  normalizeMerchant 
} from "../smartCategorization";

/**
 * Create SQL Query Tool - Executes read-only SQL queries against the Postgres database
 * Automatically filters by user_id for security
 */
export function createSqlQueryTool(userId: string) {
  return tool(
    async ({ query }: { query: string }): Promise<string> => {
      try {
        const results = await executeRawQuery(userId, query);

        return JSON.stringify({
          success: true,
          rowCount: results.length,
          data: results.slice(0, 100), // Limit to 100 rows
          query: query,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Query execution failed",
          query: query,
        });
      }
    },
    {
      name: "sql_query",
      description: `Execute a read-only SQL query against the PostgreSQL transactions database.
      
The database has the following schema:

TABLE: transactions
- id: SERIAL PRIMARY KEY
- user_id: TEXT (user identifier)
- date: TEXT (format: YYYY-MM-DD)
- description: TEXT (merchant/transaction description)
- amount: REAL (negative for expenses, positive for income)
- category: TEXT (e.g., 'Coffee', 'Groceries', 'Dining', 'Transportation', etc.)
- account: TEXT (optional account name)
- transaction_type: TEXT ('expense' or 'income')
- created_at: TIMESTAMP

TABLE: category_rules
- id: SERIAL PRIMARY KEY
- pattern: TEXT (merchant pattern to match)
- category: TEXT (category to assign)
- created_at: TIMESTAMP

IMPORTANT TIPS (PostgreSQL syntax):
- Use ABS(amount) when summing expenses to get positive totals
- Use TO_CHAR(date::date, 'YYYY-MM') for monthly grouping
- Use CURRENT_DATE for current date
- Use DATE_TRUNC('month', CURRENT_DATE) for month start
- Use CURRENT_DATE - INTERVAL '1 month' for date arithmetic
- Use ILIKE for case-insensitive matching
- DO NOT include user_id in your queries - it is automatically filtered

Only SELECT queries are allowed.`,
      schema: z.object({
        query: z.string().describe("The SQL SELECT query to execute"),
      }),
    }
  );
}

/**
 * Create Get Categories Tool - Returns all unique categories for the user
 */
export function createGetCategoresTool(userId: string) {
  return tool(
    async (): Promise<string> => {
      try {
        const categories = await getSpendingByCategory(userId, 50);

        return JSON.stringify({
          success: true,
          categories: categories,
          count: categories.length,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Failed to get categories",
        });
      }
    },
    {
      name: "get_categories",
      description: "Get all unique transaction categories with their transaction counts and total spending. Use this to understand what categories exist before querying.",
      schema: z.object({}),
    }
  );
}

/**
 * Create Summary Statistics Tool - Returns overall financial summary for the user
 */
export function createGetSummaryTool(userId: string) {
  return tool(
    async ({ timeframe }: { timeframe?: string }): Promise<string> => {
      try {
        // Calculate date range based on timeframe
        let dateFilter: { start: string; end: string } | undefined;
        const today = new Date().toISOString().split('T')[0];
        
        if (timeframe === "this_month") {
          const start = new Date();
          start.setDate(1);
          dateFilter = { start: start.toISOString().split('T')[0], end: today };
        } else if (timeframe === "last_month") {
          const end = new Date();
          end.setDate(0); // Last day of previous month
          const start = new Date(end);
          start.setDate(1);
          dateFilter = { 
            start: start.toISOString().split('T')[0], 
            end: end.toISOString().split('T')[0] 
          };
        } else if (timeframe === "this_year") {
          const start = new Date();
          start.setMonth(0, 1);
          dateFilter = { start: start.toISOString().split('T')[0], end: today };
        } else if (timeframe === "last_30_days") {
          const start = new Date();
          start.setDate(start.getDate() - 30);
          dateFilter = { start: start.toISOString().split('T')[0], end: today };
        }

        const summary = await getFinancialSummary(userId, dateFilter);
        const topCategories = await getSpendingByCategory(userId, 5);

        return JSON.stringify({
          success: true,
          timeframe: timeframe || "all_time",
          summary: summary,
          topCategories: topCategories,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Failed to get summary",
        });
      }
    },
    {
      name: "get_financial_summary",
      description: "Get a financial summary including total expenses, income, savings, and top spending categories. Optionally filter by timeframe.",
      schema: z.object({
        timeframe: z.enum(["this_month", "last_month", "this_year", "last_30_days", "all_time"])
          .optional()
          .describe("Time period for the summary. Defaults to all_time."),
      }),
    }
  );
}

/**
 * Create Monthly Trends Tool - Returns spending by month for the user
 */
export function createGetMonthlyTrendsTool(userId: string) {
  return tool(
    async ({ months }: { months?: number }): Promise<string> => {
      try {
        const limit = months || 6;
        const trends = await getMonthlyTrends(userId, limit);

        return JSON.stringify({
          success: true,
          months: limit,
          trends: (trends as unknown[]).reverse(), // Chronological order
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Failed to get trends",
        });
      }
    },
    {
      name: "get_monthly_trends",
      description: "Get monthly spending and income trends over time. Useful for visualizing financial patterns.",
      schema: z.object({
        months: z.number().optional().describe("Number of months to include. Defaults to 6."),
      }),
    }
  );
}

/**
 * Create Search Transactions Tool - Search transactions for the user
 */
export function createSearchTransactionsTool(userId: string) {
  return tool(
    async ({ searchTerm, category, limit }: { searchTerm?: string; category?: string; limit?: number }): Promise<string> => {
      try {
        const maxResults = Math.min(limit || 20, 50);
        
        let transactions;
        if (searchTerm) {
          transactions = await searchTransactions(userId, searchTerm, maxResults);
        } else {
          transactions = await getTransactions(userId, maxResults);
        }

        // Filter by category if specified
        if (category) {
          transactions = transactions.filter(
            t => t.category?.toLowerCase() === category.toLowerCase()
          );
        }

        return JSON.stringify({
          success: true,
          count: transactions.length,
          transactions: transactions.map(t => ({
            id: t.id,
            date: t.date,
            description: t.description,
            amount: t.amount,
            category: t.category,
          })),
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Failed to search transactions",
        });
      }
    },
    {
      name: "search_transactions",
      description: "Search for specific transactions by description text or filter by category. Returns matching transactions with details.",
      schema: z.object({
        searchTerm: z.string().optional().describe("Text to search for in transaction descriptions"),
        category: z.string().optional().describe("Category to filter by"),
        limit: z.number().optional().describe("Maximum results to return (max 50)"),
      }),
    }
  );
}

/**
 * Create Compare Periods Tool - Compare spending between two time periods for the user
 */
export function createComparePeriodsTool(userId: string) {
  return tool(
    async ({ period1, period2, category }: { period1: string; period2: string; category?: string }): Promise<string> => {
      try {
        const getDateRange = (period: string): { start: string; end: string } => {
          const today = new Date();
          
          if (period === "this_month") {
            const start = new Date(today.getFullYear(), today.getMonth(), 1);
            return { 
              start: start.toISOString().split('T')[0], 
              end: today.toISOString().split('T')[0] 
            };
          } else if (period === "last_month") {
            const end = new Date(today.getFullYear(), today.getMonth(), 0);
            const start = new Date(end.getFullYear(), end.getMonth(), 1);
            return { 
              start: start.toISOString().split('T')[0], 
              end: end.toISOString().split('T')[0] 
            };
          } else if (period === "this_week") {
            const dayOfWeek = today.getDay();
            const start = new Date(today);
            start.setDate(today.getDate() - dayOfWeek);
            return { 
              start: start.toISOString().split('T')[0], 
              end: today.toISOString().split('T')[0] 
            };
          } else { // last_week
            const dayOfWeek = today.getDay();
            const end = new Date(today);
            end.setDate(today.getDate() - dayOfWeek - 1);
            const start = new Date(end);
            start.setDate(end.getDate() - 6);
            return { 
              start: start.toISOString().split('T')[0], 
              end: end.toISOString().split('T')[0] 
            };
          }
        };

        const range1 = getDateRange(period1);
        const range2 = getDateRange(period2);

        const data1 = await getFinancialSummary(userId, range1);
        const data2 = await getFinancialSummary(userId, range2);

        const expenseChange = data1.totalExpenses && data2.totalExpenses 
          ? ((Number(data1.totalExpenses) - Number(data2.totalExpenses)) / Number(data2.totalExpenses) * 100).toFixed(1)
          : null;

        return JSON.stringify({
          success: true,
          comparison: {
            period1: { name: period1, ...data1 },
            period2: { name: period2, ...data2 },
            expenseChangePercent: expenseChange,
            category: category || "all",
          },
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Failed to compare periods",
        });
      }
    },
    {
      name: "compare_periods",
      description: "Compare spending between two time periods. Useful for analyzing spending changes month-over-month or week-over-week.",
      schema: z.object({
        period1: z.enum(["this_month", "last_month", "this_week", "last_week"])
          .describe("First time period to compare"),
        period2: z.enum(["this_month", "last_month", "this_week", "last_week"])
          .describe("Second time period to compare"),
        category: z.string().optional().describe("Optional category to filter the comparison"),
      }),
    }
  );
}

/**
 * Create RAG Retrieval Tool - Retrieves similar transactions and context for a query
 * Uses pgvector embeddings and vector similarity search
 */
export function createRetrievalTool(userId: string) {
  return tool(
    async ({ query, topK }: { query: string; topK?: number }): Promise<string> => {
      try {
        const { context, sources } = await augmentQuery(userId, query, {
          topK: topK || 5,
          includeSchema: false,
        });

        if (sources.length === 0) {
          return JSON.stringify({
            success: true,
            message: "No similar transactions found in the vector store.",
            context: "",
            sources: [],
          });
        }

        return JSON.stringify({
          success: true,
          context,
          sourceCount: sources.length,
          sources: sources.map(s => ({
            type: s.type,
            text: s.text,
            score: Math.round(s.score * 100) / 100,
            sourceId: s.sourceId,
          })),
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Retrieval failed",
        });
      }
    },
    {
      name: "retrieve_context",
      description: `Search for similar transactions and relevant context using semantic similarity (pgvector).
Use this tool to:
- Find transactions similar to a description
- Get context about past spending patterns
- Find examples of how similar queries were answered
- Understand categorization patterns

This uses RAG (Retrieval-Augmented Generation) with pgvector for fast similarity search.`,
      schema: z.object({
        query: z.string().describe("The search query or transaction description to find similar items for"),
        topK: z.number().optional().describe("Number of results to return (default: 5)"),
      }),
    }
  );
}

/**
 * Create Similar Transactions Tool - Find transactions similar to a description
 * Useful for categorization hints
 */
export function createSimilarTransactionsTool(userId: string) {
  return tool(
    async ({ description }: { description: string }): Promise<string> => {
      try {
        const similar = await findSimilarTransactions(userId, description, 5);

        if (similar.length === 0) {
          return JSON.stringify({
            success: true,
            message: "No similar transactions found.",
            suggestions: [],
          });
        }

        // Get most common category from similar transactions
        const categoryCounts: Record<string, number> = {};
        for (const tx of similar) {
          if (tx.category) {
            categoryCounts[tx.category] = (categoryCounts[tx.category] || 0) + 1;
          }
        }
        const suggestedCategory = Object.entries(categoryCounts)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

        return JSON.stringify({
          success: true,
          suggestedCategory,
          similarTransactions: similar,
          confidence: similar[0]?.score || 0,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Failed to find similar transactions",
        });
      }
    },
    {
      name: "find_similar_transactions",
      description: "Find transactions similar to a given description using pgvector similarity. Useful for predicting categories or understanding spending patterns.",
      schema: z.object({
        description: z.string().describe("The transaction description to find similar items for"),
      }),
    }
  );
}

/**
 * Create Preview Categorization Tool - Preview what category would be assigned to a merchant
 */
export function createPreviewCategorizationTool() {
  return tool(
    async ({ description }: { description: string }): Promise<string> => {
      try {
        const result = await smartCategorize(description);
        
        return JSON.stringify({
          success: true,
          originalDescription: description,
          normalizedMerchant: result.normalizedMerchant,
          category: result.category,
          confidence: result.confidence,
          method: result.method,
          suggestRule: result.suggestRule,
          availableCategories: CATEGORIES,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Failed to preview categorization",
        });
      }
    },
    {
      name: "preview_categorization",
      description: `Preview what category would be assigned to a merchant/transaction description.
Uses the smart categorization system which:
1. First checks for exact rule matches from learned patterns
2. Then uses extended pattern matching for common merchants
3. Finally falls back to AI (GPT-4o-mini) for unrecognized merchants

Returns the category, confidence level (high/medium/low), and which method was used.`,
      schema: z.object({
        description: z.string().describe("The merchant name or transaction description to categorize"),
      }),
    }
  );
}

/**
 * Create Recategorize Transactions Tool - Recategorize transactions using smart categorization
 */
export function createRecategorizeTool(userId: string) {
  return tool(
    async ({ onlyOther, limit }: { onlyOther?: boolean; limit?: number }): Promise<string> => {
      try {
        // Get transactions to recategorize
        const transactions = await getTransactions(userId, limit || 100);
        
        const toProcess = onlyOther 
          ? transactions.filter(t => t.category === 'Other')
          : transactions;
        
        if (toProcess.length === 0) {
          return JSON.stringify({
            success: true,
            message: onlyOther 
              ? "No transactions with 'Other' category found."
              : "No transactions found to recategorize.",
            updated: 0,
          });
        }

        // Batch categorize
        const descriptions = toProcess.map(t => t.description);
        const results = await batchCategorize(descriptions);

        // Count method usage
        const methodCounts: Record<string, number> = {};
        const categoryChanges: Array<{ id: number; old: string; new: string; method: string }> = [];
        
        for (let i = 0; i < toProcess.length; i++) {
          const tx = toProcess[i];
          const result = results[i];
          methodCounts[result.method] = (methodCounts[result.method] || 0) + 1;
          
          if (tx.category !== result.category) {
            categoryChanges.push({
              id: tx.id,
              old: tx.category || 'Unknown',
              new: result.category,
              method: result.method,
            });
          }
        }

        return JSON.stringify({
          success: true,
          analyzed: toProcess.length,
          wouldChange: categoryChanges.length,
          methodUsage: methodCounts,
          changes: categoryChanges.slice(0, 20), // Preview first 20
          note: "This is a preview. Use the /api/recategorize endpoint to apply changes.",
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Failed to recategorize",
        });
      }
    },
    {
      name: "recategorize_transactions",
      description: `Analyze transactions and preview what categories would be assigned using the smart categorization system.
This tool previews changes but doesn't apply them - it shows what WOULD change.
Set onlyOther to true to only analyze transactions currently categorized as "Other".
Use this when users ask to "fix categories" or "recategorize".`,
      schema: z.object({
        onlyOther: z.boolean().optional().describe("Only recategorize transactions with 'Other' category"),
        limit: z.number().optional().describe("Maximum transactions to analyze (default: 100)"),
      }),
    }
  );
}

/**
 * Create Learn Category Tool - Create a categorization rule from a user correction
 */
export function createLearnCategoryTool() {
  return tool(
    async ({ description, category }: { description: string; category: string }): Promise<string> => {
      try {
        // Validate category (case-insensitive check)
        const validCategory = CATEGORIES.find(c => c.toLowerCase() === category.toLowerCase());
        if (!validCategory) {
          return JSON.stringify({
            success: false,
            error: `Invalid category. Available categories: ${CATEGORIES.join(', ')}`,
          });
        }

        const result = await learnFromCorrection(description, validCategory, true);
        
        return JSON.stringify({
          success: true,
          ruleCreated: result.ruleCreated,
          pattern: result.pattern,
          category: validCategory,
          message: result.ruleCreated 
            ? `Created rule: "${result.pattern}" → ${validCategory}. Future transactions matching this pattern will be auto-categorized.`
            : `Rule already exists for this pattern.`,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Failed to learn category",
        });
      }
    },
    {
      name: "learn_category",
      description: `Create a categorization rule from a user correction.
When a user says something like "Starbucks should be Coffee" or "mark XYZ as Groceries",
use this tool to create a rule so future transactions are auto-categorized.
The pattern is automatically normalized (prefixes like SQ*, PP* are stripped).`,
      schema: z.object({
        description: z.string().describe("The merchant name or transaction description"),
        category: z.string().describe("The correct category to assign"),
      }),
    }
  );
}

/**
 * Create all finance tools for a specific user
 */
export function createFinanceTools(userId: string) {
  return [
    createSqlQueryTool(userId),
    createGetCategoresTool(userId),
    createGetSummaryTool(userId),
    createGetMonthlyTrendsTool(userId),
    createSearchTransactionsTool(userId),
    createComparePeriodsTool(userId),
    createRetrievalTool(userId),
    createSimilarTransactionsTool(userId),
    createPreviewCategorizationTool(),
    createRecategorizeTool(userId),
    createLearnCategoryTool(),
  ];
}

// For backward compatibility
export const financeTools = createFinanceTools("");
