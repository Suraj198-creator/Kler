# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KlerAI is a full-stack AI chat application with RAG (Retrieval-Augmented Generation) capabilities. It combines a Next.js frontend with a FastAPI backend that uses Claude AI, MCP (Model Context Protocol), and VoyageAI for embeddings.

**Key Technologies:**
- **Frontend**: Next.js 15 with TypeScript, Tailwind CSS v4, Supabase for auth/database
- **Backend**: FastAPI with Python 3.11, Claude AI (Anthropic), VoyageAI embeddings, MCP client for GitHub integration

## Development Commands

### Frontend (Next.js)
```bash
cd kler
npm run dev      # Start dev server with turbopack (http://localhost:3000)
npm run build    # Build for production with turbopack
npm start        # Start production server
npm run lint     # Run ESLint
```

### Backend (FastAPI)
```bash
cd kler/backend

# Setup (first time)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Run server
uvicorn app.main:app --reload  # Starts on http://localhost:8000

# Or run directly
python app/main.py
```

### Environment Setup
- **Frontend**: Copy `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_BACKEND_API_URL`
- **Backend**: Copy `backend/.env` with `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `GITHUB_KEY`, `CONTEXT7_API_KEY`

## Architecture

### Frontend Structure (`kler/src/`)
```
app/
├── (landing)/              # Public landing pages
│   └── page.tsx            # Homepage with hero, features, pricing
├── login/                  # Authentication pages
├── signup/
└── dashboard/              # Protected dashboard area
    ├── layout.tsx          # Sidebar + header wrapper
    ├── page.tsx            # Main chat interface
    ├── chat/               # Alternative chat view
    ├── history/            # Conversation history
    └── settings/           # User settings

components/
├── landing/                # Marketing components
├── dashboard/              # Chat UI components
│   ├── chat-input.tsx      # Message input with markdown
│   ├── chat-message.tsx    # Message display with syntax highlighting
│   ├── header.tsx          # Top navigation bar
│   └── sidebar.tsx         # Conversation list
└── ui/                     # Reusable UI components (buttons, inputs, badges)

lib/
├── supabase/               # Supabase client setup
├── api.ts                  # Backend API calls
├── api-client.ts           # HTTP client helpers
├── chat-db.ts              # Local conversation management
└── types.ts                # TypeScript interfaces
```

**Frontend Key Patterns:**
- Uses Supabase SSR for authentication with `@supabase/ssr`
- Path aliases: `@/*` maps to `src/*`
- Client components use `'use client'` directive
- Chat messages support markdown rendering with `marked` and syntax highlighting with `highlight.js`

### Backend Structure (`kler/backend/app/`)
```
app/
├── main.py                 # FastAPI app with /api/chat endpoint
├── chat_service.py         # Core chat orchestration with turn loop
├── rag_pipeline.py         # RAG components (VectorIndex, BM25Index, Retriever, MCPClient)
└── models.py               # Empty - models defined inline
```

**Backend Key Patterns:**

1. **Chat Service Architecture** (`chat_service.py`):
   - Maintains per-user conversation histories with two tracks:
     - `full`: Complete message history with tool results
     - `summarized`: Compressed history with summaries (saves tokens)
   - Each message/tool call gets a unique ID (e.g., `q1`, `q1-r`, `q1-t1`)
   - Turn-based loop (max 15 turns) handles Claude API calls and tool execution
   - Supports three tool types:
     - `retrieve_full_context`: Retrieves full message by ID when summary insufficient
     - `retrieve_documentation`: RAG search via Context7 API + custom retrieval
     - GitHub MCP tools: Dynamic tools from GitHub MCP server (Docker-based)

2. **RAG Pipeline** (`rag_pipeline.py`):
   - **VectorIndex**: Cosine/euclidean distance search with VoyageAI embeddings
   - **BM25Index**: Keyword-based search with TF-IDF scoring
   - **Retriever**: Hybrid search combining both indexes with RRF (Reciprocal Rank Fusion)
   - **Reranking**: Uses Claude to rerank top-k results
   - **Documentation Retrieval**: Context7 API for external API docs, chunked by section

3. **MCP Integration**:
   - Uses `mcp` Python package to connect to GitHub MCP server via Docker
   - Async client with `ClientSession` for tool listing and execution
   - Tool results are summarized and stored in history

### Data Flow

1. **User sends message** → Frontend (`api.ts`) → Backend `/api/chat`
2. **Backend** (`main.py`):
   - Extracts user_id, message, conversation_id
   - Calls `ChatService.process_message()`
3. **Chat Service** (`chat_service.py`):
   - Builds working messages from summarized history
   - Enters turn loop: Claude API → Tool calls → Tool execution → Repeat
   - Tool results get summarized and stored
   - Final response gets summarized
4. **Response** → Frontend receives full response + summary + message_id

### State Management

- **Frontend**: React state for messages, Supabase for user profiles and conversation metadata
- **Backend**: In-memory dictionaries for user histories (not persisted across restarts)
- **No shared state**: Frontend and backend communicate via HTTP only

### Authentication Flow

1. User signs up/logs in via Supabase auth
2. Frontend creates/retrieves profile from `profiles` table
3. User ID passed with every chat request for history tracking

## Common Development Tasks

### Adding a New Tool to Chat Service
1. Add tool definition to `self.anthropic_tools` in `ChatService.initialize()`
2. Handle tool execution in `ChatService._handle_tool_call()`
3. Follow pattern: execute → format result → save to full history → summarize → save to summarized history

### Modifying RAG Retrieval
- Edit `retrieve_doc()` in `rag_pipeline.py` to change Context7 integration
- Adjust `reranker_fn()` to modify reranking logic
- Change `chunk_by_section()` to alter document chunking strategy

### Adding Frontend Components
- Place in appropriate directory: `components/landing/`, `components/dashboard/`, or `components/ui/`
- Use TypeScript interfaces from `lib/types.ts`
- Import from `@/` path alias

### Updating API Endpoints
- Backend: Add route in `main.py` with proper request/response models
- Frontend: Add function in `lib/api.ts` with TypeScript types

## Important Notes

- **Backend State is Ephemeral**: User histories cleared on restart. Implement persistence if needed.
- **MCP Requires Docker**: GitHub MCP server runs in Docker container
- **Supabase Tables Expected**: `profiles`, `conversations`, `messages` tables must exist
- **API Keys Required**: ANTHROPIC_API_KEY, VOYAGE_API_KEY, GITHUB_KEY, CONTEXT7_API_KEY
- **Turbopack**: Next.js uses turbopack for faster builds (`--turbopack` flag)
- **Client Components**: Most dashboard components are client components due to interactivity