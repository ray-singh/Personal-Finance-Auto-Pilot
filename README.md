# Personal Finance Auto-Pilot

An AI Agent-powered financial assistant that allows users to upload bank statements (CSV) and chat with their data using natural language. The system autonomously categorizes transactions and generates SQL queries to answer your financial questions.

## Features

### Secure Authentication & Multi-Tenancy
- **Clerk Integration**: Enterprise-grade authentication with email/password and social login
- **Multi-User Support**: Complete data isolation between users - each user only sees their own data
- **Protected Routes**: All financial data and API endpoints are secured and user-scoped
- **User Management**: Built-in user profile management and account settings

### AI Agent System
- **LangGraph Multi-Agent Architecture**: Intelligent agent with 6 specialized tools for financial analysis
- **Autonomous Tool Selection**: Agent automatically chooses the right tools for your question
- **Multi-Step Reasoning**: Plans complex queries, executes multiple tools, and synthesizes results
- **Tool Transparency**: See exactly which tools the agent used to answer your question
- **Adaptive Responses**: Agent learns from context and adjusts its approach dynamically

### Core Capabilities
- **📤 Smart CSV Upload**: Upload bank statements with automatic parsing and flexible column detection
- **🤖 Autonomous Categorization**: 200+ built-in pattern rules automatically categorize transactions across 20+ categories
- **💬 Natural Language Chat**: Ask questions in plain English like "How much did I spend on coffee this month?"
- **🔍 Agent-Powered Queries**: Advanced LangGraph agent with specialized financial analysis tools
- **📊 Interactive Visualizations**: Charts automatically appear in chat responses when relevant (pie, bar, line charts)
- **📈 Comprehensive Dashboard**: Track spending by category, monthly trends, and top merchants
- **🔄 Transaction Management**: View, search, filter, edit, and delete transactions with pagination
- **⚙️ Category Rules Management**: Add custom categorization patterns and auto-update existing transactions

### Advanced Features
- **🧠 Intelligent Agent Tools**: sql_query, get_categories, get_financial_summary, get_monthly_trends, search_transactions, compare_periods (all user-scoped)
- **Real-time Chart Generation**: System automatically detects when to show visual data in chat responses
- **SQL Query Visibility**: View the generated SQL queries to understand how your data is being analyzed
- **Data Table Display**: Toggle between chart and table views for detailed data inspection
- **Smart Filtering**: Search transactions by description, filter by category, date range
- **Multi-User Architecture**: Complete data isolation ensures users never see each other's financial data
- **Error Boundaries**: Robust error handling with user-friendly error messages
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices

## 🛠️ Tech Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| **Frontend** | Next.js 14 | React framework with App Router |
| **Language** | TypeScript 5.3 | Type-safe development |
| **Authentication** | Clerk | Secure user authentication & management |
| **Styling** | Tailwind CSS | Utility-first CSS framework |
| **Database** | NeonDB + Drizzle ORM | Serverless PostgreSQL with type-safe ORM |
| **Vector Search** | pgvector | Native PostgreSQL vector similarity search |
| **AI/ML** | OpenAI GPT-4o-mini | Text-to-SQL generation & NL responses |
| **Agent Framework** | LangChain + LangGraph | Multi-agent orchestration & tool calling |
| **Visualization** | Recharts | Interactive charts and graphs |
| **CSV Parsing** | PapaParse | Robust CSV file handling |
| **Icons** | Lucide React | Beautiful, consistent icons |

## 📋 Quick Start

### Automated Setup (Recommended)
```bash
# Run the setup script
./setup.sh

# Add your OpenAI API key to .env.local
# Then start the dev server
npm run dev
```

### Manual Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd Personal-Finance-Auto-Pilot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.local.example .env.local
   ```
   
   Edit `.env.local` and add your keys:
   ```env
   # OpenAI API Key
   OPENAI_API_KEY=sk-proj-...your-key-here
   
   # NeonDB Database URL (get from console.neon.tech)
   DATABASE_URL=postgresql://user:password@ep-cool-name-123456.us-east-1.aws.neon.tech/neondb?sslmode=require
   
   # Clerk Authentication Keys
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   ```
   
   **Get your API keys:**
   - OpenAI: https://platform.openai.com/api-keys
   - Clerk: https://dashboard.clerk.com
   - NeonDB: https://console.neon.tech

4. **Push database schema to NeonDB**
   ```bash
   npm run db:push
   ```

5. **Configure Clerk Authentication** (First-time setup)
   - Go to https://dashboard.clerk.com
   - Create a new application
   - Select "Email" and "Google" (or your preferred authentication methods)
   - Copy the **Publishable Key** and **Secret Key** to your `.env.local`
   - In Clerk Dashboard, go to "Paths" and set:
     - Sign-in URL: `/sign-in`
     - Sign-up URL: `/sign-up`
     - After sign-in URL: `/dashboard`
     - After sign-up URL: `/dashboard`

5. **Start the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   Navigate to http://localhost:3000

7. **Upload sample data** (optional)
   Use the provided sample CSV: `sample-data/bank-statement-sample.csv`
   npm run dev
   ```

5. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

### 🤖 AI Agent Architecture (LangGraph)

The application uses a **LangGraph-based multi-agent system** for intelligent financial analysis. Instead of simple text-to-SQL conversion, the agent can:

**Agent Workflow:**
```
User Query → Agent Planner → Tool Selection → Tool Execution → Result Analysis → Response
                  ↑                                                                    |
                  └────────────────── Iterate if needed ──────────────────────────────┘
```

**Available Agent Tools:**

1. **`sql_query`** - Execute custom SQL queries for complex analysis
   - Read-only SELECT statements for security
   - Full access to transactions and category_rules tables
   
2. **`get_categories`** - List all transaction categories with counts and totals
   - Quick overview of spending distribution
   - Used before making detailed queries
   
3. **`get_financial_summary`** - Get comprehensive financial overview
   - Filter by timeframe (this_month, last_month, this_year, etc.)
   - Includes totals, averages, and top categories
   
4. **`get_monthly_trends`** - Analyze spending patterns over time
   - Monthly income vs expenses
   - Configurable number of months
   
5. **`search_transactions`** - Find specific transactions
   - Search by description or category
   - Useful for finding specific merchants or patterns
   
6. **`compare_periods`** - Compare spending between time periods
   - This month vs last month
   - This week vs last week
   - Optional category filtering

### Text-to-SQL Engine with Visual Intelligence

The system uses OpenAI GPT-4o-mini to:
1. **Understand** your natural language query
2. **Analyze** the database schema with all available categories
3. **Generate** optimized SQL queries with proper date handling
4. **Detect** when data should be visualized
5. **Create** appropriate charts (pie, bar, or line)
6. **Format** results into conversational responses

**Intelligent Chart Detection:**
- **Line Charts**: Automatically shown for time-series queries (monthly trends, spending over time)
- **Pie Charts**: Created for category breakdowns and distribution queries
- **Bar Charts**: Generated for comparisons, rankings, and top-N queries


**Advanced Query Features:**
- Context-aware date handling (understands "this month", "last week", etc.)
- Automatic use of ABS() for expense totals
- Common Table Expressions (CTEs) for complex queries
- ROUND() for proper currency formatting
- Safe query execution (read-only SELECT statements)
- Result size limits to prevent overwhelming responsesWHOLE FOODS", "SAFEWAY" → Groceries
- "UBER", "LYFT" → Transportation
- "NETFLIX", "SPOTIFY" → Entertainment
- And many more...

Transactions that don't match known patterns are categorized as "Other".

## 🎯 Example Questions

### Basic Queries (Agent automatically selects get_financial_summary or sql_query)
- "What's my total spending this month?"
- "Show me all coffee purchases in December"
- "What are my top 3 expense categories?"
- "How much did I spend at restaurants?"
- "List all transactions over $50"

### Comparative Analysis (Agent uses compare_periods tool)
- "Compare my spending this month to last month"
- "Compare my groceries spending to last month"
- "How much did I spend on coffee compared to last month?"
- "Show my monthly spending trend"

### Statistical Queries (Agent uses get_financial_summary or sql_query)
- "What's my average daily spending?"
- "What was my largest transaction?"
- "Show me my income sources"
- "What percentage of my spending is on dining?"

### Time-based Queries (Agent uses get_monthly_trends or sql_query)
- "Show my spending by month for the last 6 months"
- "What are my spending trends over time?"
- "How much did I spend in each category this month?"

### Search Queries (Agent uses search_transactions tool)
- "Find all Starbucks transactions"
- "Show me transactions over $100 in the shopping category"
- "List my recent grocery purchases"

**Pro Tip**: The AI agent automatically chooses the best tool(s) for your question and can use multiple tools in sequence for complex queries. Click "Show Tools" in the chat to see which tools were used!
SELECT * FROM current_month, last_month;

Response: "You spent $32.75 on coffee this month, compared to 
$28.50 last month. That's an increase of $4.25 (14.9%)."
```

### Production Build

1. **Build the application**
   ```bash
   npm run build
   ```

2. **Start the production server**
   ```bash
   npm start
   ```

3. **Environment variables**
   Set `OPENAI_API_KEY` in your production environment

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

### Ways to Contribute
- 🐛 Report bugs via GitHub Issues
- 💡 Suggest features or improvements
- 📝 Improve documentation
- 🎨 Enhance UI/UX
- 🧪 Add test coverage
- 🌐 Add support for more CSV formats
- 📊 Create new visualization types
- 🤖 Add new agent tools or improve existing ones

### Development Setup
```bash
git checkout -b feature/your-feature-name
# Make your changes
npm run dev  # Test locally
npm run build  # Ensure it builds
# Create pull request
```

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- Powered by [OpenAI GPT-4](https://openai.com/)
- Agent orchestration by [LangChain](https://js.langchain.com/) & [LangGraph](https://langchain-ai.github.io/langgraphjs/)
- Visualizations by [Recharts](https://recharts.org/)
- Icons by [Lucide](https://lucide.dev/)

---

**Built using Next.js, OpenAI, LangGraph, SQLite, and Recharts**
*Making personal finance accessible and intelligent with AI agents, one transaction at a time.* 💰✨🤖

## 🔒 Privacy & Security

- **Local Storage**: All data is stored locally in SQLite
- **No Cloud Storage**: Transactions never leave your machine
- **API Key**: Only used to communicate with OpenAI for query generation
- **No Data Sharing**: Your financial data is private

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest new features
- Submit pull requests

## 📧 Support

For issues or questions, please open an issue on GitHub.

---

Built using Next.js, OpenAI, and SQLite
