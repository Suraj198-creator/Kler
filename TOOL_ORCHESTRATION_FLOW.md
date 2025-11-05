# Tool Orchestration Flow Diagram

## System Architecture: Dual-Track Memory with Multi-Turn Reasoning

This system manages retrieval-augmented reasoning, multi-turn tool usage, and dual-track memory for efficient AI agent orchestration.

---

## High-Level Flow Diagram

```mermaid
graph TB
    Start([User sends message]) --> API[FastAPI /api/chat]
    API --> CreditCheck{Check Credits}
    CreditCheck -->|Insufficient| Error402[Return 402 Error]
    CreditCheck -->|Sufficient| ExtractParams[Extract user_id, message, conversation_id]

    ExtractParams --> LoadHistory[Load or Create User History]
    LoadHistory --> BuildMessages[Build Working Messages from Summarised History]

    BuildMessages --> TurnLoop{Turn Loop: turn < 15?}

    TurnLoop -->|Yes| ClaudeAPI[Call Claude API with Tools]
    ClaudeAPI --> CheckTools{Has Tool Calls?}

    CheckTools -->|No| Complete[Break - Response Complete]
    CheckTools -->|Yes| ExecuteTools[Execute All Tool Calls in Parallel]

    ExecuteTools --> ToolType{Tool Type?}

    ToolType -->|retrieve_full_context| RetrieveFull[Lookup ID in Full History]
    ToolType -->|retrieve_documentation| RAGPipeline[RAG Pipeline]
    ToolType -->|GitHub MCP| MCPCall[MCP Client Call]

    RAGPipeline --> Context7[Query Context7 API]
    Context7 --> SelectDoc[Claude Selects Best Doc]
    SelectDoc --> ChunkDoc[Chunk by Section]
    ChunkDoc --> HybridSearch[Hybrid Search: BM25 + Vector]
    HybridSearch --> Rerank[Claude Reranking]
    Rerank --> FormatResult[Format Documentation Result]

    MCPCall --> MCPDocker[Docker GitHub MCP Server]
    MCPDocker --> MCPFormat[Format MCP Result]
    MCPFormat --> SaveFull[Save to Full History with ID]
    SaveFull --> Summarise[Summarise Tool Result]
    Summarise --> SaveSummarised[Save to Summarised History]

    RetrieveFull --> ToolResult1[Return Tool Result]
    FormatResult --> ToolResult2[Return Tool Result]
    SaveSummarised --> ToolResult3[Return Tool Result]

    ToolResult1 --> AddToMessages[Add Tool Results to Working Messages]
    ToolResult2 --> AddToMessages
    ToolResult3 --> AddToMessages

    AddToMessages --> TurnLoop

    TurnLoop -->|No: Max turns reached| Complete
    Complete --> SaveResponse[Save Response to Both Histories]
    SaveResponse --> SummariseResponse[Summarise Final Response]
    SummariseResponse --> DeductCredits[Calculate & Deduct Credits]
    DeductCredits --> Return[Return Response + Summary + Message ID]

    style TurnLoop fill:#ff9999
    style ClaudeAPI fill:#99ccff
    style RAGPipeline fill:#99ff99
    style MCPCall fill:#ffcc99
    style Complete fill:#cc99ff
```

---

## Detailed Turn Loop Architecture

```mermaid
sequenceDiagram
    participant U as User
    participant API as FastAPI
    participant CS as ChatService
    participant H as History Manager
    participant C as Claude API
    participant T as Tool Handler
    participant MCP as GitHub MCP
    participant RAG as RAG Pipeline

    U->>API: POST /api/chat {message, user_id}
    API->>CS: process_message()

    CS->>H: Get user history
    H-->>CS: {full: [], summarised: [], query_counter: N}

    CS->>CS: Increment query_counter (q{N+1})
    CS->>CS: Build working_messages from summarised history

    Note over CS: Working messages have ID prefixes:<br/>[ID:q1], [ID:q1-r-sum, ref:q1-r]

    loop Turn Loop (max 15 turns)
        CS->>C: messages.create(tools=all_tools, messages=working_messages)
        C-->>CS: Response with content blocks

        alt No Tool Calls
            CS->>CS: Break loop - response complete
        else Has Tool Calls
            CS->>T: Execute tool calls

            alt Tool: retrieve_full_context
                T->>H: Lookup ID in full history
                H-->>T: Full message content
                T-->>CS: Tool result
            else Tool: retrieve_documentation
                T->>RAG: retrieve_doc(query)
                RAG->>RAG: Query Context7 for doc_name
                RAG->>RAG: Claude selects best document
                RAG->>RAG: Chunk by section
                RAG->>RAG: Hybrid search (BM25 + Vector)
                RAG->>RAG: Claude reranking
                RAG-->>T: Formatted documentation
                T-->>CS: Tool result
            else Tool: GitHub MCP
                T->>MCP: call_tool(name, input)
                MCP-->>T: MCP result
                T->>H: Save to full history [ID:q{N}-t{M}]
                T->>C: Summarise tool result
                C-->>T: Summary
                T->>H: Save to summarised history [ID:q{N}-t{M}-sum, ref:q{N}-t{M}]
                T-->>CS: Tool result
            end

            CS->>CS: Add tool results to working_messages
            Note over CS: Continue to next turn
        end
    end

    CS->>H: Save query to full history [ID:q{N}]
    CS->>H: Save response to full history [ID:q{N}-r]
    CS->>C: Summarise response
    C-->>CS: Summary
    CS->>H: Save to summarised history [ID:q{N}-r-sum, ref:q{N}-r]

    CS-->>API: {response, summary, message_id}
    API->>API: Calculate credits & deduct
    API-->>U: {response, summary, conversation_id, message_id}
```

---

## Dual-Track Memory System

```mermaid
graph LR
    subgraph "User History Structure"
        direction TB
        History[User History Dict]
        Full["full: []<br/>Complete messages<br/>NOT sent to Claude"]
        Summarised["summarised: []<br/>Compressed messages<br/>SENT to Claude"]
        Counter[query_counter: N]

        History --> Full
        History --> Summarised
        History --> Counter
    end

    subgraph "Full Track - Complete"
        direction TB
        F1["[ID:q1]<br/>role: user<br/>content: 'How to setup OAuth?'"]
        F2["[ID:q1-t1]<br/>type: tool_result<br/>tool: search_repositories<br/>content: (full 5000 char result)"]
        F3["[ID:q1-r]<br/>role: assistant<br/>content: (full 3000 char response)"]

        F1 --> F2 --> F3
    end

    subgraph "Summarised Track (~60% reduction)"
        direction TB
        S1["[ID:q1]<br/>role: user<br/>content: 'How to setup OAuth?'"]
        S2["[ID:q1-t1-sum, ref:q1-t1]<br/>type: tool_summary<br/>content: 'Searched GitHub, found 3 repos with OAuth setup'"]
        S3["[ID:q1-r-sum, ref:q1-r]<br/>role: assistant<br/>content: 'Explained OAuth2 flow with code examples'"]

        S1 --> S2 --> S3
    end

    Full -.-> F1
    Summarised -.-> S1

    style Full fill:#ffcccc
    style Summarised fill:#ccffcc
    style History fill:#e6e6ff
```

---

## ID System & Smart Retrieval

```mermaid
graph TB
    subgraph "ID Naming Convention"
        Query["Query IDs:<br/>q1, q2, q3, ..."]
        Response["Response IDs:<br/>q1-r, q2-r, ..."]
        Tool["Tool Result IDs:<br/>q1-t1, q1-t2, ..."]
        Summary["Summary IDs:<br/>q1-r-sum (ref:q1-r)<br/>q1-t1-sum (ref:q1-t1)"]
    end

    subgraph "Smart Retrieval Flow"
        User2[User: 'Show me the full code from earlier']
        Claude2{Claude analyzes<br/>summarised history}
        Claude2 -->|Summary insufficient| CallTool[Call retrieve_full_context tool]
        CallTool --> ProvideID[Provide ID: 'q1-r']
        ProvideID --> Lookup[Lookup in full history]
        Lookup --> Return[Return complete content]
        Return --> Claude3[Claude uses full context<br/>to provide detailed answer]
    end

    Query -.-> User2
    Response -.-> ProvideID

    style CallTool fill:#ffee99
    style Lookup fill:#99eeff
```

---

## RAG Pipeline Details

```mermaid
graph TB
    Start[User Query: 'Twitter OAuth setup']

    Start --> Step1[Step 1: Claude parses query]
    Step1 --> Extract[Extract: doc_name='X API'<br/>topic='OAuth setup']

    Extract --> Step2[Step 2: Search Context7]
    Step2 --> C7Search[GET context7.com/api/v1/search?query='X API']
    C7Search --> Docs[Returns list of matching docs]

    Docs --> Step3[Step 3: Claude selects best doc]
    Step3 --> SelectID[Selects doc ID: '/docs/x-api-123']

    SelectID --> Step4[Step 4: Retrieve full documentation]
    Step4 --> C7Get[GET context7.com/api/v1/docs/x-api-123<br/>?topic='OAuth setup'&tokens=50000]
    C7Get --> FullDoc[Full documentation text]

    FullDoc --> Step5[Step 5: Chunk by section]
    Step5 --> Chunks[Split on '\\n--------------------------------']

    Chunks --> Step6[Step 6: Hybrid Search]
    Step6 --> BM25[BM25 Index<br/>Keyword-based<br/>TF-IDF scoring]
    Step6 --> Vector[Vector Index<br/>VoyageAI embeddings<br/>Cosine distance]

    BM25 --> RRF[Reciprocal Rank Fusion]
    Vector --> RRF

    RRF --> Top30[Top 30 results]

    Top30 --> Step7[Step 7: Claude reranking]
    Step7 --> Rerank[Claude evaluates relevance<br/>to original query]
    Rerank --> Top6[Top 6 most relevant chunks]

    Top6 --> Format[Format as documentation context]
    Format --> Return[Return to tool execution]

    style Step1 fill:#ffcccc
    style Step3 fill:#ffcccc
    style Step7 fill:#ffcccc
    style BM25 fill:#ccffcc
    style Vector fill:#ccffcc
    style RRF fill:#ccccff
```

---

## Tool Execution Handler

```mermaid
graph TB
    ToolCall[Tool Call Detected]

    ToolCall --> CheckName{Tool Name?}

    CheckName -->|retrieve_full_context| RF[Retrieve Full Context Handler]
    CheckName -->|retrieve_documentation| RD[Retrieve Documentation Handler]
    CheckName -->|Other| GH[GitHub MCP Handler]

    RF --> Input1["Input: id='q1-r'"]
    Input1 --> Search1[Search full history for ID]
    Search1 --> Found1{Found?}
    Found1 -->|Yes| Return1[Return full content]
    Found1 -->|No| Error1[Return 'ID not found']

    RD --> Input2["Input: query='Twitter OAuth'"]
    Input2 --> Context7Call[Call Context7 API]
    Context7Call --> ChunkDoc[Chunk documentation]
    ChunkDoc --> CreateIndexes[Create BM25 + Vector indexes]
    CreateIndexes --> AddDocs[Add chunks to indexes]
    AddDocs --> HybridSearch[Hybrid search k=6]
    HybridSearch --> RerankerFn[Claude reranking]
    RerankerFn --> FormatDocs[Format as markdown]
    FormatDocs --> Return2[Return formatted docs]

    GH --> Input3[Input: Tool-specific params]
    Input3 --> MCPCall[Call MCP client.call_tool]
    MCPCall --> MCPResult[MCP server result]
    MCPResult --> FormatMCP[Format result content]
    FormatMCP --> GenerateID["Generate tool ID: qN-tM"]
    GenerateID --> SaveFull[Save to full history]
    SaveFull --> SummariseTool[Call summarise_tool_result]
    SummariseTool --> ClaudeSummarise[Claude creates 1-2 sentence summary]
    ClaudeSummarise --> SaveSummarised[Save summary with ref to full ID]
    SaveSummarised --> Return3[Return tool result]

    Return1 --> Done[Tool Result]
    Return2 --> Done
    Return3 --> Done

    style RF fill:#ffcccc
    style RD fill:#ccffcc
    style GH fill:#ccccff
```

---

## Credit System Integration

```mermaid
graph TB
    Request[User Query Request]

    Request --> Check1[Check Credits Before Processing]
    Check1 --> Balance{Balance >= 5?}

    Balance -->|No| Error402[Return 402 Error<br/>with upgrade message]
    Balance -->|Yes| Process[Process Query]

    Process --> TrackTools[Track Tool Usage]
    TrackTools --> T1{retrieve_documentation<br/>used?}
    TrackTools --> T2{GitHub MCP tools<br/>used?}
    TrackTools --> T3[Count total tools]

    T1 -->|Yes| Flag1[has_documentation = true]
    T1 -->|No| Flag1[has_documentation = false]

    T2 -->|Yes| Flag2[has_github_tools = true]
    T2 -->|No| Flag2[has_github_tools = false]

    T3 --> Count[tool_count = N]

    Flag1 --> Calculate[Calculate Cost]
    Flag2 --> Calculate
    Count --> Calculate

    Calculate --> Formula["Base: 5 credits<br/>+ documentation: 10<br/>+ each GitHub tool: 3<br/>+ each other tool: 2"]

    Formula --> TotalCost[Total Cost]

    TotalCost --> Deduct[Deduct Credits]
    Deduct --> CheckBalance{Deduction<br/>successful?}

    CheckBalance -->|No| Error402b[Return 402 Error<br/>mid-stream]
    CheckBalance -->|Yes| UpdateBalance[Update Balance]
    UpdateBalance --> ReturnResult[Return Response<br/>with credits_used & credits_remaining]

    style Check1 fill:#ffcc99
    style Calculate fill:#cc99ff
    style Deduct fill:#ff9999
```

---

## Key Features

### 1. Multi-Turn Reasoning
- Enables complex workflows: Search GitHub → Retrieve SDK → Fetch API docs → Generate code
- Max 15 turns with automatic loop termination when response is complete

### 2. Dual-Track Memory (~60% Token Reduction)
- **Full Track**: Complete messages stored but NOT sent to Claude
- **Summarised Track**: Compressed versions sent to Claude for efficiency
- Smart retrieval when summaries are insufficient

### 3. ID-Based Reference System
- Unique IDs for every message, response, and tool result
- Enables precise retrieval and context reconstruction
- References link summaries to full content

### 4. Three Tool Categories
1. **retrieve_full_context**: Internal history lookup
2. **retrieve_documentation**: RAG with Context7 API + hybrid search
3. **GitHub MCP**: Dynamic tools from Docker-based MCP server

### 5. RAG Pipeline
- Context7 API for external documentation
- Hybrid search: BM25 (keyword) + Vector (semantic)
- Reciprocal Rank Fusion for result merging
- Claude-powered reranking for optimal relevance

### 6. Automatic Summarisation
- Tool results summarised by Claude
- Final responses summarised for next conversation
- Maintains context while reducing token usage

---

## Technical Stack

### Backend Components
- **FastAPI**: API server with streaming support
- **Anthropic Claude**: Primary reasoning engine (claude-haiku-4-5-20251001)
- **VoyageAI**: Embeddings for vector search (voyage-3-large)
- **Context7**: External API documentation retrieval
- **MCP (Model Context Protocol)**: GitHub tool integration via Docker
- **Docker**: GitHub MCP server runtime

### Search & Retrieval
- **BM25Index**: TF-IDF keyword search with configurable k1/b parameters
- **VectorIndex**: Cosine/Euclidean distance with VoyageAI embeddings
- **Retriever**: RRF fusion with optional Claude reranking
- **httpx**: Async HTTP client for Context7 API

### Memory Management
- In-memory dictionaries per user (ephemeral, not persisted)
- Dual-track histories (full + summarised)
- Automatic query counter for ID generation

---

## Example Conversation Flow

**Query 1**: "How do I set up OAuth for Twitter ads?"

1. **Turn 1**: Claude calls `retrieve_documentation` tool
   - Context7 API fetches X API documentation
   - RAG pipeline retrieves relevant OAuth sections
   - Tool result saved: `[ID:q1-t1]` (full), `[ID:q1-t1-sum, ref:q1-t1]` (summarised)

2. **Turn 2**: Claude calls `search_repositories` (GitHub MCP)
   - Searches for Twitter ads examples
   - Result saved: `[ID:q1-t2]` (full), `[ID:q1-t2-sum, ref:q1-t2]` (summarised)

3. **Turn 3**: Claude provides final response
   - Explains OAuth flow with code examples
   - Response saved: `[ID:q1-r]` (full), `[ID:q1-r-sum, ref:q1-r]` (summarised)

**Query 2**: "Show me the full code from earlier"

1. **Turn 1**: Claude analyzes summarised history, realizes summary insufficient
   - Calls `retrieve_full_context` with `{id: "q1-r"}`
   - Receives complete code from full history

2. **Turn 2**: Claude provides detailed code explanation
   - Uses retrieved full context

---

## Performance Characteristics

- **Token Efficiency**: ~60% reduction through dual-track memory
- **Max Query Cost**: Base 5 + documentation 10 + tools (2-3 each) = ~25 credits
- **API Timeouts**: 30s for Context7, 120s for chat
- **Streaming**: SSE (Server-Sent Events) for real-time updates
- **Turn Limit**: 15 turns to prevent infinite loops
- **Concurrency**: Parallel tool execution within single turn

---

## Credit Pricing Model

### Base Costs
- **Minimum Query**: 5 credits
- **With Documentation**: +10 credits (retrieve_documentation tool)
- **Per GitHub Tool**: +3 credits each
- **Per Other Tool**: +2 credits each

### Plans
- **Free**: 50 credits/day (resets daily)
- **Pro**: $19/month for 150 credits/day (max 3,000/month)
- **Credit Packs**: Starting at $20 for 500 credits (one-time purchase)

### Example Costs
- Simple query: 5 credits
- Query + documentation: 15 credits
- Query + docs + 2 GitHub tools: 21 credits
- Complex query with multiple tools: ~25 credits

---

## Architecture Benefits

1. **Stateful Reasoning**: Multi-turn loops enable complex problem solving
2. **Cost Efficient**: Dual-track memory reduces token usage by ~60%
3. **Explainable**: ID system provides clear audit trail
4. **Extensible**: Easy to add new tools via MCP protocol
5. **Hybrid Search**: Combines keyword and semantic search for best results
6. **Smart Caching**: Context7 API results cached for repeated queries
7. **Credit Control**: Fine-grained cost tracking per tool usage

---

*Generated for KlerAI - Full-stack AI chat application with RAG capabilities*
