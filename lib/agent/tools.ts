import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { db, initializeDatabase } from "../database";
import { augmentQuery, findSimilarTransactions } from "../rag";

// Initialize database
initializeDatabase();

/**
 * Create SQL Query Tool - Executes read-only SQL queries against the transactions database
 * Automatically filters by user_id for security
 */
export function createSqlQueryTool(userId: string) {
  return tool(
    async ({ query }: { query: string }): Promise<string> => {
      try {
        // Security: Only allow SELECT statements
        const normalizedQuery = query.trim().toUpperCase();
        if (!normalizedQuery.startsWith("SELECT")) {
          return JSON.stringify({
            error: "Only SELECT queries are allowed for security reasons.",
            success: false,
          });
        }

        // Security: Inject user_id filter into the query
        // Replace FROM transactions with FROM transactions WHERE user_id = 'userId'
        // Or add AND user_id = 'userId' if WHERE already exists
        let secureQuery = query;
        const fromTransactionsRegex = /FROM\s+transactions\b/gi;
        const hasWhere = /FROM\s+transactions\s+WHERE/gi.test(query);
        
        if (fromTransactionsRegex.test(query)) {
          if (hasWhere) {
            // Add user_id condition after WHERE
            secureQuery = query.replace(
              /FROM\s+transactions\s+WHERE/gi,
              `FROM transactions WHERE user_id = '${userId}' AND`
            );
          } else {
            // Add WHERE clause with user_id
            secureQuery = query.replace(
              /FROM\s+transactions\b/gi,
              `FROM transactions WHERE user_id = '${userId}'`
            );
          }
        }

        // Execute the query
        const stmt = db.prepare(secureQuery);
        const results = stmt.all();

        return JSON.stringify({
          success: true,
          rowCount: results.length,
          data: results.slice(0, 100), // Limit to 100 rows
          query: secureQuery,
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
      description: `Execute a read-only SQL query against the SQLite transactions database.
      
The database has the following schema:

TABLE: transactions
- id: INTEGER PRIMARY KEY
- date: TEXT (format: YYYY-MM-DD)
- description: TEXT (merchant/transaction description)
- amount: REAL (negative for expenses, positive for income)
- category: TEXT (e.g., 'Coffee', 'Groceries', 'Dining', 'Transportation', 'Entertainment', 'Shopping', 'Healthcare', 'Income', 'Transfer', etc.)
- account: TEXT (optional account name)
- transaction_type: TEXT ('expense' or 'income')
- created_at: TEXT (timestamp)

TABLE: category_rules
- id: INTEGER PRIMARY KEY
- pattern: TEXT (merchant pattern to match)
- category: TEXT (category to assign)
- created_at: TEXT

IMPORTANT TIPS:
- Use ABS(amount) when summing expenses to get positive totals
- Use strftime('%Y-%m', date) for monthly grouping
- Use date('now') for current date, date('now', 'start of month') for month start
- Category names are case-sensitive
- For comparisons, use date('now', '-1 month', 'start of month') for last month
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
        const stmt = db.prepare(`
          SELECT DISTINCT category, COUNT(*) as count, 
                 ROUND(ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)), 2) as total_spent
          FROM transactions 
          WHERE category IS NOT NULL AND user_id = ?
          GROUP BY category
          ORDER BY count DESC
        `);
        const categories = stmt.all(userId);

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
        let dateFilter = "";
        if (timeframe === "this_month") {
          dateFilter = "AND date >= date('now', 'start of month')";
        } else if (timeframe === "last_month") {
          dateFilter = "AND date >= date('now', '-1 month', 'start of month') AND date < date('now', 'start of month')";
        } else if (timeframe === "this_year") {
          dateFilter = "AND date >= date('now', 'start of year')";
        } else if (timeframe === "last_30_days") {
          dateFilter = "AND date >= date('now', '-30 days')";
        }

        const stmt = db.prepare(`
          SELECT 
            COUNT(*) as total_transactions,
            ROUND(ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)), 2) as total_expenses,
            ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 2) as total_income,
            ROUND(SUM(amount), 2) as net_savings,
            MIN(date) as earliest_date,
            MAX(date) as latest_date,
            ROUND(AVG(CASE WHEN amount < 0 THEN ABS(amount) ELSE NULL END), 2) as avg_expense
          FROM transactions
          WHERE user_id = ? ${dateFilter}
        `);
        const summary = stmt.get(userId);

        // Get top categories
        const topCategoriesStmt = db.prepare(`
          SELECT category, 
                 ROUND(ABS(SUM(amount)), 2) as total,
                 COUNT(*) as count
          FROM transactions 
          WHERE amount < 0 AND user_id = ? ${dateFilter}
          GROUP BY category
          ORDER BY total DESC
          LIMIT 5
        `);
        const topCategories = topCategoriesStmt.all(userId);

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
        
        const stmt = db.prepare(`
          SELECT 
            strftime('%Y-%m', date) as month,
            ROUND(ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)), 2) as expenses,
            ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 2) as income,
            COUNT(*) as transaction_count
          FROM transactions
          WHERE date >= date('now', '-' || ? || ' months') AND user_id = ?
          GROUP BY strftime('%Y-%m', date)
          ORDER BY month DESC
          LIMIT ?
        `);
        const trends = stmt.all(limit, userId, limit);

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
        
        let whereClause = "WHERE user_id = ?";
        const params: (string | number)[] = [userId];
        
        if (searchTerm) {
          whereClause += " AND LOWER(description) LIKE LOWER(?)";
          params.push(`%${searchTerm}%`);
        }
        
        if (category) {
          whereClause += " AND LOWER(category) = LOWER(?)";
          params.push(category);
        }
        
        const stmt = db.prepare(`
          SELECT id, date, description, amount, category
          FROM transactions
          ${whereClause}
          ORDER BY date DESC
          LIMIT ?
        `);
        params.push(maxResults);
        
        const transactions = stmt.all(...params);

        return JSON.stringify({
          success: true,
          count: transactions.length,
          transactions: transactions,
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
        const getPeriodData = (period: string, cat?: string) => {
          let dateFilter = "";
          if (period === "this_month") {
            dateFilter = "date >= date('now', 'start of month')";
          } else if (period === "last_month") {
            dateFilter = "date >= date('now', '-1 month', 'start of month') AND date < date('now', 'start of month')";
          } else if (period === "this_week") {
            dateFilter = "date >= date('now', 'weekday 0', '-7 days')";
          } else if (period === "last_week") {
            dateFilter = "date >= date('now', 'weekday 0', '-14 days') AND date < date('now', 'weekday 0', '-7 days')";
          }
          
          let categoryFilter = "";
          if (cat) {
            categoryFilter = `AND LOWER(category) = LOWER('${cat}')`;
          }
          
          const stmt = db.prepare(`
            SELECT 
              ROUND(ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)), 2) as expenses,
              ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 2) as income,
              COUNT(*) as count
            FROM transactions
            WHERE ${dateFilter} AND user_id = ? ${categoryFilter}
          `);
          return stmt.get(userId);
        };
        
        const data1 = getPeriodData(period1, category);
        const data2 = getPeriodData(period2, category);

        interface PeriodData {
          expenses: number;
          income: number;
          count: number;
        }

        const p1 = data1 as PeriodData;
        const p2 = data2 as PeriodData;

        const expenseChange = p1.expenses && p2.expenses 
          ? ((p1.expenses - p2.expenses) / p2.expenses * 100).toFixed(1)
          : null;

        return JSON.stringify({
          success: true,
          comparison: {
            period1: { name: period1, ...p1 },
            period2: { name: period2, ...p2 },
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
 * Uses embeddings and vector similarity search
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
      description: `Search for similar transactions and relevant context using semantic similarity.
Use this tool to:
- Find transactions similar to a description
- Get context about past spending patterns
- Find examples of how similar queries were answered
- Understand categorization patterns

This uses RAG (Retrieval-Augmented Generation) to find semantically similar data.`,
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
          categoryCounts[tx.category] = (categoryCounts[tx.category] || 0) + 1;
        }
        const suggestedCategory = Object.entries(categoryCounts)
          .sort((a, b) => b[1] - a[1])[0][0];

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
      description: "Find transactions similar to a given description. Useful for predicting categories or understanding spending patterns.",
      schema: z.object({
        description: z.string().describe("The transaction description to find similar items for"),
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
  ];
}

// For backward compatibility, export a default set (though these should not be used directly)
export const financeTools = createFinanceTools("");
