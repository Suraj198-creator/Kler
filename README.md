# KlerAI

> Full-stack AI chat application with RAG capabilities, dual-track memory management, and intelligent tool orchestration

[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js_15-000000?style=flat&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Claude](https://img.shields.io/badge/Claude_AI-191919?style=flat&logo=anthropic&logoColor=white)](https://www.anthropic.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python_3.11-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)

---

## 🌟 Key Features

### **Dual-Track Memory Architecture (~60% Token Reduction)**
- Maintains parallel histories: **Full** (complete archive) + **Summarised** (sent to AI)
- Intelligent context retrieval when summaries are insufficient
- Reduces API costs whilst maintaining conversation accuracy

### **Multi-Turn Reasoning Engine**
- Supports complex workflows: Search → Retrieve docs → Synthesise response
- Max 15 turns with automatic completion detection
- Enables sophisticated problem-solving across multiple data sources

### **Advanced RAG Pipeline**
- **Hybrid Search**: Combines BM25 (keyword) + Vector (semantic) search
- **Context7 Integration**: External API documentation retrieval
- **Claude-Powered Reranking**: Intelligent result prioritisation
- **Reciprocal Rank Fusion**: Optimal result merging

### **GitHub MCP Integration**
- Dynamic tool integration via Model Context Protocol
- Docker-based GitHub server with repository search capabilities
- Automatic tool result summarisation

### **Credit-Based Usage System**
- Fine-grained cost tracking per tool usage
- Transparent pricing: Base query + tools
- Stripe integration for subscriptions and one-time purchases

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Request                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   FastAPI Backend (Python)                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            ChatService (Turn Loop Manager)                │  │
│  │  • Dual-track history (full + summarised)                │  │
│  │  • ID-based message tracking (q1, q1-r, q1-t1)           │  │
│  │  • Multi-turn orchestration (max 15 turns)               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓                                   │
│  ┌─────────────────────┬──────────────────┬──────────────────┐ │
│  │  retrieve_full      │  retrieve_doc    │  GitHub MCP      │ │
│  │  _context           │  umentation      │  Tools           │ │
│  │                     │                  │                  │ │
│  │  • Lookup by ID     │  • Context7 API  │  • Docker-based  │ │
│  │  • Full history     │  • Hybrid search │  • Dynamic tools │ │
│  │    retrieval        │  • BM25 + Vector │  • Auto-summary  │ │
│  └─────────────────────┴──────────────────┴──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              Next.js Frontend (TypeScript + React)               │
│  • Real-time streaming (SSE)                                     │
│  • Markdown rendering with syntax highlighting                  │
│  • Supabase authentication                                       │
│  • Credit balance tracking                                       │
└─────────────────────────────────────────────────────────────────┘
```

### How Dual-Track Memory Works

**Problem**: Sending entire conversation histories to AI APIs is expensive
**Solution**: Maintain two parallel tracks

| Track | Content | Usage |
|-------|---------|-------|
| **Full** | Complete messages, tool results (5000+ chars) | Archive for retrieval |
| **Summarised** | Claude-generated summaries (80-200 chars) | Sent to API |

**Example**:
```
Full Track:        [ID:q1-r] 3500 characters of OAuth implementation code
Summarised Track:  [ID:q1-r-sum, ref:q1-r] "Explained OAuth2 flow with code"
Token Savings:     ~60% reduction
```

When the AI needs full details, it calls `retrieve_full_context` tool with the ID reference.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.11+
- **Docker** (for GitHub MCP server)
- **Supabase** account (for auth and database)
- API Keys:
  - [Anthropic Claude](https://console.anthropic.com/)
  - [VoyageAI](https://www.voyageai.com/)
  - [Context7](https://context7.com/)
  - [GitHub Personal Access Token](https://github.com/settings/tokens)

### Installation

#### 1. Clone the repository
```bash
git clone https://github.com/yourusername/klerAI.git
cd klerAI
```

#### 2. Frontend Setup
```bash
cd kler
npm install
```

Create `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_BACKEND_API_URL=http://localhost:8000
```

Start development server:
```bash
npm run dev
# Opens on http://localhost:3000
```

#### 3. Backend Setup
```bash
cd kler/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

Create `backend/.env`:
```env
ANTHROPIC_API_KEY=your_anthropic_key
VOYAGE_API_KEY=your_voyage_key
GITHUB_KEY=your_github_token
CONTEXT7_API_KEY=your_context7_key

# Stripe (optional, for payments)
STRIPE_SECRET_KEY=your_stripe_secret
STRIPE_WEBHOOK_SECRET=your_webhook_secret

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
```

Start backend server:
```bash
uvicorn app.main:app --reload
# Runs on http://localhost:8000
```

#### 4. Database Setup

Create these tables in your Supabase project:

```sql
-- Profiles table
CREATE TABLE profiles (
    id UUID REFERENCES auth.users PRIMARY KEY,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    plan TEXT DEFAULT 'free',
    credits INTEGER DEFAULT 50,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Conversations table
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id),
    title TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations(id),
    role TEXT CHECK (role IN ('user', 'assistant')),
    content TEXT,
    summary TEXT,
    message_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Credit transactions table
CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id),
    amount INTEGER,
    type TEXT,
    description TEXT,
    conversation_id UUID,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 📖 Usage Examples

### Basic Chat Query
```typescript
// Frontend (Next.js)
const response = await fetch('/api/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: "How do I implement Stripe webhooks?",
    user_id: userId,
    conversation_id: conversationId
  })
});

const reader = response.body.getReader();
// Stream events: text_delta, tool_start, tool_complete, done
```

### Multi-Turn Workflow Example

**User Query**: "How do I set up OAuth for Twitter ads?"

**Turn 1**: AI calls `retrieve_documentation`
- Fetches X API documentation from Context7
- Applies hybrid search (BM25 + Vector)
- Returns top 6 relevant sections

**Turn 2**: AI calls `search_repositories` (GitHub MCP)
- Searches GitHub for OAuth examples
- Finds relevant code repositories

**Turn 3**: AI synthesises final response
- Combines documentation + code examples
- Provides complete implementation guide

**Cost**: 5 (base) + 10 (docs) + 3 (GitHub) = **18 credits**

---

## 🔧 Key Components

### Backend (`kler/backend/app/`)

#### `chat_service.py`
Core orchestration engine managing:
- Dual-track history per user
- Turn-based loop (max 15 turns)
- Tool execution and result summarisation
- ID generation and tracking

```python
user_histories[user_id] = {
    "full": [],         # Complete archive
    "summarised": [],   # Sent to Claude
    "query_counter": 0  # ID generation
}
```

#### `rag_pipeline.py`
RAG components:
- **VectorIndex**: Cosine/Euclidean distance with VoyageAI embeddings
- **BM25Index**: TF-IDF keyword search
- **Retriever**: Hybrid search with RRF fusion
- **MCPClient**: GitHub MCP server integration
- **retrieve_doc()**: Context7 API documentation retrieval
- **reranker_fn()**: Claude-powered result reranking

#### `main.py`
FastAPI application with:
- `/api/chat/stream`: SSE streaming endpoint
- `/api/load_conversation`: Load history from database
- Credit system endpoints
- Stripe payment integration

### Frontend (`kler/src/`)

#### `app/dashboard/page.tsx`
Main chat interface with:
- Real-time message streaming
- Tool execution indicators
- Credit balance display
- Markdown rendering with syntax highlighting

#### `lib/api.ts`
Backend communication:
- `sendMessage()`: Chat API calls
- `loadConversation()`: Load history
- SSE event parsing

#### `components/dashboard/`
- `chat-input.tsx`: Message input with markdown preview
- `chat-message.tsx`: Message display with code highlighting
- `sidebar.tsx`: Conversation list
- `header.tsx`: Navigation with credit balance

---

## 💰 Credit System

### Pricing Model
```
Base Query:                  5 credits
+ retrieve_documentation:   10 credits
+ Each GitHub MCP tool:      3 credits
+ Each other tool:           2 credits
```

### Example Costs
| Query Type | Tools Used | Cost |
|-----------|-----------|------|
| Simple question | None | 5 credits |
| With documentation | retrieve_documentation | 15 credits |
| Complex workflow | docs + 2 GitHub tools | 21 credits |

### Plans
- **Free**: 50 credits/day (resets daily)
- **Pro**: $19/month → 150 credits/day (max 3,000/month)
- **Credit Packs**: Starting at $20 for 500 credits

---

## 🔑 Environment Variables

### Frontend (`.env.local`)
```env
NEXT_PUBLIC_SUPABASE_URL=          # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # Supabase anon key
NEXT_PUBLIC_BACKEND_API_URL=       # Backend URL (http://localhost:8000)
```

### Backend (`backend/.env`)
```env
# AI Services
ANTHROPIC_API_KEY=                 # Claude API key
VOYAGE_API_KEY=                    # VoyageAI embeddings key
CONTEXT7_API_KEY=                  # Context7 documentation API

# MCP
GITHUB_KEY=                        # GitHub personal access token

# Database
SUPABASE_URL=                      # Supabase project URL
SUPABASE_SERVICE_KEY=              # Service role key (server-side)

# Payments (Optional)
STRIPE_SECRET_KEY=                 # Stripe secret key
STRIPE_WEBHOOK_SECRET=             # Webhook signing secret
```

---

## 🧪 Development

### Running Tests
```bash
# Frontend
cd kler
npm run lint
npm run build

# Backend
cd kler/backend
pytest
```

### Development Commands

**Frontend**:
```bash
npm run dev          # Dev server with turbopack
npm run build        # Production build
npm start            # Start production server
npm run lint         # ESLint
```

**Backend**:
```bash
uvicorn app.main:app --reload        # Dev server with hot reload
python app/main.py                   # Direct execution
```

### Docker Setup (GitHub MCP)

The GitHub MCP server runs automatically via Docker when the backend starts:
```bash
docker run -i --rm \
  -e GITHUB_PERSONAL_ACCESS_TOKEN \
  ghcr.io/github/github-mcp-server
```

---

## 📊 Performance Characteristics

| Metric | Value |
|--------|-------|
| Token Efficiency | ~60% reduction via dual-track memory |
| Max Query Cost | ~25 credits |
| Turn Limit | 15 (prevents infinite loops) |
| API Timeouts | 30s (Context7), 120s (chat) |
| Streaming | SSE (Server-Sent Events) |
| Concurrency | Parallel tool execution within turns |

---

## 🎯 Architecture Highlights

### ID-Based Reference System
Every message, response, and tool result gets a unique ID:
```
Queries:      q1, q2, q3, ...
Responses:    q1-r, q2-r, ...
Tool Results: q1-t1, q1-t2, ...
Summaries:    q1-r-sum (references q1-r)
```

This enables:
- Precise retrieval by reference
- Clear audit trail
- Efficient context reconstruction

### Hybrid Search Pipeline
1. **BM25 Index**: Keyword matching (TF-IDF)
2. **Vector Index**: Semantic similarity (VoyageAI embeddings)
3. **Reciprocal Rank Fusion**: Merge result sets
4. **Claude Reranking**: Intelligent relevance scoring

**Why it works**: Catches both exact terminology and conceptually similar content

### Tool Categories
1. **retrieve_full_context**: Internal memory lookup (free)
2. **retrieve_documentation**: RAG with Context7 + hybrid search (+10 credits)
3. **GitHub MCP**: Dynamic repository tools (+3 credits each)

---

## 📁 Project Structure

```
klerAI/
├── kler/                          # Frontend (Next.js)
│   ├── src/
│   │   ├── app/
│   │   │   ├── (landing)/         # Public pages
│   │   │   ├── login/             # Auth
│   │   │   ├── signup/
│   │   │   └── dashboard/         # Protected area
│   │   │       ├── page.tsx       # Main chat interface
│   │   │       ├── chat/
│   │   │       ├── history/
│   │   │       └── settings/
│   │   ├── components/
│   │   │   ├── landing/           # Marketing components
│   │   │   ├── dashboard/         # Chat UI
│   │   │   └── ui/                # Reusable components
│   │   └── lib/
│   │       ├── supabase/          # Auth setup
│   │       ├── api.ts             # Backend calls
│   │       └── types.ts           # TypeScript types
│   └── package.json
│
├── kler/backend/                  # Backend (FastAPI)
│   ├── app/
│   │   ├── main.py               # FastAPI application
│   │   ├── chat_service.py       # Turn loop orchestration
│   │   ├── rag_pipeline.py       # RAG components
│   │   ├── credit_service.py     # Credit management
│   │   └── stripe_service.py     # Stripe integration
│   ├── requirements.txt
│   └── .env
│
├── TOOL_ORCHESTRATION_FLOW.md    # Architecture diagrams
├── CLAUDE.md                     # Development guide
└── README.md                     # This file
```

---

## 🔐 Security Considerations

- ✅ API keys stored in environment variables
- ✅ Supabase Row Level Security (RLS) enabled
- ✅ Stripe webhook signature verification
- ✅ User authentication on all protected routes
- ✅ Credit checks before processing
- ✅ Rate limiting via credit system

---

## 🚧 Roadmap

- [ ] Persistent conversation storage (PostgreSQL)
- [ ] Conversation branching and forking
- [ ] Multi-model support (GPT-4 + Claude)
- [ ] Custom MCP servers for internal APIs
- [ ] Document versioning tracking
- [ ] Citation tracking with source links
- [ ] Enhanced analytics dashboard
- [ ] Team collaboration features

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 Licence

This project is licensed under the MIT Licence - see the [LICENCE](LICENCE) file for details.

---

## 🙏 Acknowledgements

- [Anthropic Claude](https://www.anthropic.com/) - AI reasoning engine
- [VoyageAI](https://www.voyageai.com/) - Vector embeddings
- [Context7](https://context7.com/) - API documentation retrieval
- [Model Context Protocol](https://github.com/modelcontextprotocol) - Tool integration standard
- [Next.js](https://nextjs.org/) - React framework
- [FastAPI](https://fastapi.tiangolo.com/) - Python API framework
- [Supabase](https://supabase.com/) - Backend infrastructure

---

## 📧 Contact

For questions or feedback, please open an issue or contact [your@email.com](mailto:your@email.com).

---

## 🌟 Star this repository

If you find this project useful, please consider giving it a star! ⭐

---

**Built with ❤️ using Claude AI, Next.js, and FastAPI**
