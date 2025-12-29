import { BaseMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { createFinanceTools } from "./tools";

import * as dotenv from "dotenv";
dotenv.config({ path: '.env.local' })

// Define the agent state using Annotation
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  // Track agent reasoning/planning
  reasoning: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),
  // Track which tools were used
  toolsUsed: Annotation<string[]>({
    reducer: (x, y) => [...new Set([...x, ...y])],
    default: () => [],
  }),
  // Final response for the user
  finalResponse: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),
  // Chart data if visualization is needed
  chartData: Annotation<{
    type: "pie" | "bar" | "line" | null;
    data: Array<{ name: string; value: number; [key: string]: unknown }>;
  } | null>({
    reducer: (_x, y) => y,
    default: () => null,
  }),
  // SQL query that was executed (for display)
  executedSQL: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),
  // Query results
  queryResults: Annotation<unknown[]>({
    reducer: (_x, y) => y,
    default: () => [],
  }),
});

type AgentStateType = typeof AgentState.State;

// Create the model with tool binding for a specific user
function createModel(userId: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const tools = createFinanceTools(userId);
  
  return {
    model: new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0,
      openAIApiKey: apiKey,
    }).bindTools(tools),
    tools,
  };
}

// System prompt for the finance agent
const SYSTEM_PROMPT = `You are a helpful personal finance assistant that helps users understand and analyze their transaction data.

You have access to a PostgreSQL database (NeonDB) containing the user's financial transactions. Your job is to:
1. Understand the user's question about their finances
2. Use the appropriate tools to gather data
3. Analyze the results and provide clear, actionable insights
4. Suggest visualizations when appropriate
5. Help users recategorize transactions and improve categorization accuracy

IMPORTANT GUIDELINES:
- Always be specific with numbers and use proper currency formatting ($X.XX)
- When comparing periods, calculate percentage changes
- Proactively provide context (e.g., "This is 20% higher than last month")
- If data is insufficient, explain what's missing
- Be conversational but concise
- For spending questions, use ABS() on amounts since expenses are negative

TOOL SELECTION STRATEGY:
- For "how much did I spend" questions → use sql_query or get_financial_summary
- For "what categories" questions → use get_categories first
- For "compare" or "trend" questions → use compare_periods or get_monthly_trends
- For finding specific transactions → use search_transactions
- For complex custom queries → use sql_query
- For "recategorize" or "fix categories" → use recategorize_transactions
- For "what category is..." → use preview_categorization
- For finding similar transactions → use find_similar_transactions (uses pgvector)

CATEGORIZATION SYSTEM:
The system uses a smart multi-tier categorization approach:
1. Rule-based: Exact matches from learned patterns (from user corrections)
2. Pattern-based: Extended pattern matching for common merchants
3. AI-powered: GPT-4o-mini fallback for unrecognized merchants

When users correct a category, the system can learn and create rules for future transactions.

When you have enough information to answer, provide a clear, helpful response.`;

// Agent node that decides what to do next
function createAgentNode(userId: string) {
  return async function agentNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const { model } = createModel(userId);
    
    // Add system message if this is the first call
    const messages = state.messages.length === 0 || 
      (state.messages.length > 0 && state.messages[0]._getType() !== "system")
      ? [{ role: "system", content: SYSTEM_PROMPT }, ...state.messages]
      : state.messages;

    const response = await model.invoke(messages);
    
    return { messages: [response] };
  };
}

// Create tool node for a specific user
function createToolNodeWithTracking(userId: string) {
  const tools = createFinanceTools(userId);
  const toolNode = new ToolNode(tools);
  
  return async function toolNodeWithTracking(state: AgentStateType): Promise<Partial<AgentStateType>> {
    const result = await toolNode.invoke(state);
    
    // Extract tool names from the last AI message
    const lastAIMessage = state.messages
      .slice()
      .reverse()
      .find((m): m is AIMessage => m._getType() === "ai");
      
    const toolsUsed: string[] = [];
    if (lastAIMessage?.tool_calls) {
      for (const tc of lastAIMessage.tool_calls) {
        toolsUsed.push(tc.name);
      }
    }

    // Extract SQL query if sql_query tool was used
    let executedSQL = state.executedSQL;
    let queryResults = state.queryResults;
    
    if (result.messages) {
      for (const msg of result.messages) {
        if (msg._getType() === "tool") {
          const toolMsg = msg as ToolMessage;
          try {
            const content = JSON.parse(toolMsg.content as string);
            if (content.query) {
              executedSQL = content.query;
            }
            if (content.data) {
              queryResults = content.data;
            }
          } catch {
            // Not JSON, skip
          }
        }
      }
    }
    
    return {
      ...result,
      toolsUsed,
      executedSQL,
      queryResults,
    };
  };
}

// Response formatter node - processes final response
async function responseFormatterNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if (lastMessage._getType() !== "ai") {
    return {};
  }
  
  const aiMessage = lastMessage as AIMessage;
  const content = typeof aiMessage.content === "string" 
    ? aiMessage.content 
    : JSON.stringify(aiMessage.content);
  
  // Detect if we should suggest a chart based on the query results
  let chartData: AgentStateType["chartData"] = null;
  
  if (state.queryResults.length > 0) {
    const results = state.queryResults as Record<string, unknown>[];
    const firstRow = results[0];
    
    // Check if results look like category data (for pie chart)
    if (firstRow && ("category" in firstRow || "name" in firstRow) && 
        ("total" in firstRow || "value" in firstRow || "count" in firstRow)) {
      const valueKey = "total" in firstRow ? "total" : "value" in firstRow ? "value" : "count";
      chartData = {
        type: "pie",
        data: results.slice(0, 10).map(r => ({
          name: (r.category as string) || (r.name as string) || "Unknown",
          value: Math.abs(Number(r[valueKey]) || 0),
        })),
      };
    }
    // Check if results look like time series data (for line chart)
    else if (firstRow && ("month" in firstRow || "date" in firstRow)) {
      const timeKey = "month" in firstRow ? "month" : "date";
      const valueKey = "expenses" in firstRow ? "expenses" : "total" in firstRow ? "total" : "amount";
      chartData = {
        type: "line",
        data: results.map(r => ({
          name: r[timeKey] as string,
          value: Math.abs(Number(r[valueKey]) || 0),
          ...(("income" in r) ? { income: Number(r.income) || 0 } : {}),
        })),
      };
    }
    // Check for comparison data (bar chart)
    else if (results.length <= 5 && firstRow && Object.keys(firstRow).length <= 4) {
      const numericKey = Object.keys(firstRow).find(k => typeof firstRow[k] === "number");
      if (numericKey) {
        chartData = {
          type: "bar",
          data: results.map((r, i) => ({
            name: `Item ${i + 1}`,
            value: Math.abs(Number(r[numericKey]) || 0),
          })),
        };
      }
    }
  }
  
  return {
    finalResponse: content,
    chartData,
  };
}

// Routing function - decides whether to continue with tools or end
function shouldContinue(state: AgentStateType): "tools" | "respond" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if (lastMessage._getType() !== "ai") {
    return END;
  }
  
  const aiMessage = lastMessage as AIMessage;
  
  // If there are tool calls, route to tools
  if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
    return "tools";
  }
  
  // Otherwise, format the response and end
  return "respond";
}

// Build the graph for a specific user
function createFinanceAgentGraph(userId: string) {
  const agentNode = createAgentNode(userId);
  const toolNodeWithTracking = createToolNodeWithTracking(userId);
  
  const workflow = new StateGraph(AgentState)
    .addNode("agent", agentNode)
    .addNode("tools", toolNodeWithTracking)
    .addNode("respond", responseFormatterNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      respond: "respond",
      [END]: END,
    })
    .addEdge("tools", "agent")
    .addEdge("respond", END);

  return workflow.compile();
}

// Main function to run the agent for a specific user
export async function runFinanceAgent(userQuery: string, userId: string): Promise<{
  response: string;
  chartData: AgentStateType["chartData"];
  executedSQL: string;
  queryResults: unknown[];
  toolsUsed: string[];
}> {
  const graph = createFinanceAgentGraph(userId);
  
  const initialState = {
    messages: [new HumanMessage(userQuery)],
  };
  
  const result = await graph.invoke(initialState);
  
  return {
    response: result.finalResponse || "I apologize, but I couldn't process your request. Please try again.",
    chartData: result.chartData,
    executedSQL: result.executedSQL,
    queryResults: result.queryResults,
    toolsUsed: result.toolsUsed,
  };
}

// Export types
export type { AgentStateType };
