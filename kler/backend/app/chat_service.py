import os
import json
import re
import uuid
from typing import Optional, Dict, List, Any
from anthropic import Anthropic
import voyageai

# Import your RAG components
from app.rag_pipeline import (
    VectorIndex,
    BM25Index,
    Retriever,
    MCPClient,
    generate_embedding,
    chunk_by_section,
    retrieve_doc,
    reranker_fn,
    summarize_tool_result,
    summarize_response
)


class ChatService:
    def __init__(self):
        self.anthropic_client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        self.github_client: Optional[MCPClient] = None
        self.anthropic_tools: List[Dict] = []

        # Store conversation histories per user
        self.user_histories: Dict[str, Dict] = {}
        self.conversation_ids: Dict[str, str] = {}

    async def initialize(self):
        """Initialize GitHub MCP client and tools"""
        self.github_client = MCPClient(
            command="docker",
            args=["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
                  "ghcr.io/github/github-mcp-server"],
            env={"GITHUB_PERSONAL_ACCESS_TOKEN": os.getenv("GITHUB_KEY")},
            name="github"
        )

        print("Connecting to GitHub MCP server...")
        try:
            await self.github_client.connect()
            print("Connected to GitHub MCP")

            # Get GitHub tools - filter to only include read/search operations
            github_tools = await self.github_client.list_tools()

            # Allowed GitHub tools - only read/search operations, no create/delete/update
            allowed_github_tools = {
                'search_repositories',
                'get_file_contents',
                'search_code',
                'list_commits',
                'get_commit',
                'list_issues',
                'search_issues'
            }

            # Start with custom tools first (higher priority)
            self.anthropic_tools = []

            # 1. Documentation retrieval - for official API docs
            self.anthropic_tools.append({
                "name": "retrieve_documentation",
                "description": "Retrieve official API documentation (e.g., Telegram Bot API, Stripe API, Twitter API, GitHub API docs). Use this FIRST when the user asks about APIs, SDKs, webhooks, authentication, or needs setup guides. This fetches official documentation from API providers.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "API/SDK name and topic (e.g., 'Telegram Bot API webhooks', 'GitHub webhooks API', 'Stripe payment intents')"
                        }
                    },
                    "required": ["query"]
                }
            })

            # 2. Full context retrieval - for conversation history
            self.anthropic_tools.append({
                "name": "retrieve_full_context",
                "description": "Retrieve full details from previous conversation when summary is insufficient.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "ID from previous messages"
                        }
                    },
                    "required": ["id"]
                }
            })

            # 3. Add filtered GitHub tools (read-only)
            github_tool_list = [{
                "name": tool.name,
                "description": f"GitHub: {tool.description}" if not tool.description.startswith("GitHub") else tool.description,
                "input_schema": tool.inputSchema
            } for tool in github_tools if tool.name in allowed_github_tools]

            self.anthropic_tools.extend(github_tool_list)

            print(f"Tools initialized: {len(self.anthropic_tools)} total")

        except Exception as e:
            print(f"Failed to initialize GitHub MCP: {e}")
            raise

    async def cleanup(self):
        """Cleanup resources"""
        if self.github_client:
            await self.github_client.cleanup()

    def _get_user_history(self, user_id: str) -> Dict:
        """Get or create user history"""
        if user_id not in self.user_histories:
            self.user_histories[user_id] = {
                "full": [],
                "summarized": [],
                "query_counter": 0
            }
        return self.user_histories[user_id]

    def get_conversation_id(self, user_id: str) -> str:
        """Get or create conversation ID for user"""
        if user_id not in self.conversation_ids:
            self.conversation_ids[user_id] = str(uuid.uuid4())
        return self.conversation_ids[user_id]

    def load_conversation_from_db(
            self,
            user_id: str,
            conversation_id: str,
            messages: List[Dict[str, Any]]
    ):
        """
        Load conversation history from database messages.
        Reconstructs both full and summarized histories.

        Args:
            user_id: User ID
            conversation_id: Conversation ID
            messages: List of message dicts with fields:
                - role: 'user' | 'assistant'
                - content: Full message content
                - summary: Summary (optional, for assistant messages)
                - message_id: Backend message ID (optional)
        """
        # Set conversation ID
        self.conversation_ids[user_id] = conversation_id

        # Get or create user history
        history = self._get_user_history(user_id)

        # Clear existing history
        history["full"] = []
        history["summarized"] = []
        history["query_counter"] = 0

        # Rebuild histories from messages
        for i, msg in enumerate(messages):
            role = msg.get("role")
            content = msg.get("content", "")
            summary = msg.get("summary")
            message_id = msg.get("message_id")

            if role == "user":
                # Increment counter for each user message
                history["query_counter"] += 1
                query_id = f"q{history['query_counter']}"

                # Add to full history
                history["full"].append({
                    "id": query_id,
                    "role": "user",
                    "content": content
                })

                # Add to summarized history
                history["summarized"].append({
                    "id": query_id,
                    "role": "user",
                    "content": content
                })

            elif role == "assistant":
                # Use existing message_id or generate response_id
                if message_id:
                    response_id = message_id
                else:
                    response_id = f"q{history['query_counter']}-r"

                # Add to full history
                history["full"].append({
                    "id": response_id,
                    "role": "assistant",
                    "content": content
                })

                # Add to summarized history
                # Use summary if available, otherwise use full content
                summary_content = summary if summary else content
                history["summarized"].append({
                    "id": f"{response_id}-sum",
                    "ref": response_id,
                    "role": "assistant",
                    "content": summary_content
                })

        print(f"Loaded conversation {conversation_id} for user {user_id}: {len(messages)} messages, query_counter={history['query_counter']}")

    async def process_message(
            self,
            message: str,
            user_id: str,
            conversation_id: Optional[str] = None
    ) -> str:
        """
        Process a single message and return the response.
        This is the main entry point from the API.
        """

        # Get user history
        history = self._get_user_history(user_id)
        history["query_counter"] += 1
        query_id = f"q{history['query_counter']}"

        # Set conversation ID
        if conversation_id:
            self.conversation_ids[user_id] = conversation_id
        else:
            conversation_id = self.get_conversation_id(user_id)

        # Build working messages with IDs embedded
        working_messages = []
        for item in history["summarized"]:
            if item.get("role") in ["user", "assistant"]:
                item_id = item.get("id", "")
                ref = item.get("ref", "")
                content = item["content"]

                if ref:
                    prefix = f"[ID:{item_id}, ref:{ref}] "
                else:
                    prefix = f"[ID:{item_id}] "

                working_messages.append({
                    "role": item["role"],
                    "content": prefix + content
                })
            elif item.get("type") == "tool_summary":
                working_messages.append({
                    "role": "user",
                    "content": f"[ID:{item['id']}, ref:{item['ref']}] {item['content']}"
                })

        # Add current query
        working_messages.append({"role": "user", "content": message})

        # TURN LOOP
        max_turns = 15
        turn = 0
        tool_counter = 0
        final_response_text = ""

        while turn < max_turns:
            turn += 1
            print(f"Turn {turn}")

            try:
                response = self.anthropic_client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=3000,
                    system="""You are an expert AI coding assistant. Write clean, efficient, and well-optimized code. Prioritize performance and efficiency in all solutions.

When exploring GitHub repositories:
1. ALWAYS start by reading the README file (README.md, README.rst, etc.) to understand setup and usage
2. Use search_code to find relevant implementations (e.g., search for "authentication", "oauth", "streaming")
3. Read actual file contents from examples/ directories and relevant SDK files
4. Make multiple get_file_contents calls to explore the codebase - don't stop at directory listings
5. Look for setup.py, requirements.txt, or package.json to understand dependencies

If get_file_contents returns a directory listing, follow up by reading specific files from that listing.""",
                    tools=self.anthropic_tools,
                    messages=working_messages,
                    temperature=0.0
                )
            except Exception as api_error:
                print(f"API Error: {api_error}")
                raise

            assistant_content = []
            has_tool_calls = False

            for content in response.content:
                assistant_content.append(content)
                if content.type == "text":
                    final_response_text += content.text
                elif content.type == "tool_use":
                    has_tool_calls = True
                    print(f"Tool call: {content.name}")

            working_messages.append({"role": "assistant", "content": assistant_content})

            if not has_tool_calls:
                print(f"Completed in {turn} turns")
                break

            # PROCESS TOOL CALLS
            tool_results = []
            for content in response.content:
                if content.type == "tool_use":
                    tool_result = await self._handle_tool_call(
                        content,
                        history,
                        query_id,
                        tool_counter
                    )
                    tool_results.append(tool_result)
                    if content.name not in ["retrieve_full_context", "retrieve_documentation"]:
                        tool_counter += 1

            if tool_results:
                working_messages.append({"role": "user", "content": tool_results})

        if turn >= max_turns:
            print("Max turns reached")

        # SAVE TO HISTORIES
        response_id = f"{query_id}-r"

        # Full history
        history["full"].append({
            "id": query_id,
            "role": "user",
            "content": message
        })
        history["full"].append({
            "id": response_id,
            "role": "assistant",
            "content": final_response_text
        })

        # Summarize response
        response_summary = summarize_response(final_response_text, self.anthropic_client)

        # Summarized history
        history["summarized"].append({
            "id": query_id,
            "role": "user",
            "content": message
        })
        history["summarized"].append({
            "id": f"{response_id}-sum",
            "ref": response_id,
            "role": "assistant",
            "content": response_summary
        })

        return final_response_text

    async def process_message_stream(
            self,
            message: str,
            user_id: str,
            conversation_id: Optional[str] = None,
            doc_context: Optional[str] = None
    ):
        """
        Process a message and yield streaming events.
        Yields events for tool calls and response text.
        """
        # Get user history
        history = self._get_user_history(user_id)
        history["query_counter"] += 1
        query_id = f"q{history['query_counter']}"

        # Set conversation ID
        if conversation_id:
            self.conversation_ids[user_id] = conversation_id
        else:
            conversation_id = self.get_conversation_id(user_id)

        # Build working messages with IDs embedded
        working_messages = []
        for item in history["summarized"]:
            if item.get("role") in ["user", "assistant"]:
                item_id = item.get("id", "")
                ref = item.get("ref", "")
                content = item["content"]

                if ref:
                    prefix = f"[ID:{item_id}, ref:{ref}] "
                else:
                    prefix = f"[ID:{item_id}] "

                working_messages.append({
                    "role": item["role"],
                    "content": prefix + content
                })
            elif item.get("type") == "tool_summary":
                working_messages.append({
                    "role": "user",
                    "content": f"[ID:{item['id']}, ref:{item['ref']}] {item['content']}"
                })

        # Add current query
        working_messages.append({"role": "user", "content": message})

        # TURN LOOP
        max_turns = 15
        turn = 0
        tool_counter = 0
        final_response_text = ""

        while turn < max_turns:
            turn += 1
            print(f"Turn {turn}")

            # Yield turn start event
            yield {
                "type": "turn_start",
                "turn": turn,
                "max_turns": max_turns
            }

            try:
                # Use streaming API
                stream = self.anthropic_client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=32000,  # Increased from 8000 to prevent truncation
                    system="""You are an expert AI coding assistant. Write clean, efficient, and well-optimized code. Prioritize performance and efficiency in all solutions.

When exploring GitHub repositories:
1. ALWAYS start by reading the README file (README.md, README.rst, etc.) to understand setup and usage
2. Use search_code to find relevant implementations (e.g., search for "authentication", "oauth", "streaming")
3. Read actual file contents from examples/ directories and relevant SDK files
4. Make multiple get_file_contents calls to explore the codebase - don't stop at directory listings
5. Look for setup.py, requirements.txt, or package.json to understand dependencies

If get_file_contents returns a directory listing, follow up by reading specific files from that listing.""",
                    tools=self.anthropic_tools,
                    messages=working_messages,
                    temperature=0.0,
                    stream=True
                )
            except Exception as api_error:
                print(f"API Error: {api_error}")
                yield {"type": "error", "content": str(api_error)}
                return

            assistant_content = []
            has_tool_calls = False
            current_tool = None
            current_text = ""
            current_block_type = None

            # Stream the response
            for event in stream:
                if event.type == "content_block_start":
                    if event.content_block.type == "tool_use":
                        current_block_type = "tool_use"
                        current_tool = {
                            "id": event.content_block.id,
                            "name": event.content_block.name,
                            "input": ""
                        }
                        # Yield tool start event
                        yield {
                            "type": "tool_start",
                            "tool_name": event.content_block.name,
                            "tool_id": event.content_block.id
                        }
                    elif event.content_block.type == "text":
                        current_block_type = "text"
                        current_text = ""

                elif event.type == "content_block_delta":
                    if event.delta.type == "text_delta":
                        # Accumulate text for this content block
                        current_text += event.delta.text
                        final_response_text += event.delta.text
                        # Stream it immediately to frontend
                        yield {
                            "type": "text_delta",
                            "content": event.delta.text
                        }
                    elif event.delta.type == "input_json_delta":
                        if current_tool:
                            current_tool["input"] += event.delta.partial_json

                elif event.type == "content_block_stop":
                    if current_block_type == "tool_use" and current_tool:
                        has_tool_calls = True
                        # Complete the tool input
                        try:
                            tool_input = json.loads(current_tool["input"])
                        except:
                            tool_input = {}

                        # Create tool use dict (JSON serializable)
                        tool_use_dict = {
                            "id": current_tool["id"],
                            "name": current_tool["name"],
                            "input": tool_input,
                            "type": "tool_use"
                        }
                        assistant_content.append(tool_use_dict)

                        # Create simple object for tool execution
                        class ToolUse:
                            def __init__(self, id, name, input):
                                self.id = id
                                self.name = name
                                self.input = input
                                self.type = "tool_use"

                        tool_use = ToolUse(current_tool["id"], current_tool["name"], tool_input)

                        # Execute tool
                        tool_result = await self._handle_tool_call(
                            tool_use,
                            history,
                            query_id,
                            tool_counter
                        )

                        # Yield tool completion event with result
                        yield {
                            "type": "tool_complete",
                            "tool_name": current_tool["name"],
                            "tool_id": current_tool["id"],
                            "tool_result": tool_result.get("content", "")
                        }

                        if current_tool["name"] not in ["retrieve_full_context", "retrieve_documentation"]:
                            tool_counter += 1

                        # Add to tool results for next turn
                        if not hasattr(self, '_current_tool_results'):
                            self._current_tool_results = []
                        self._current_tool_results.append(tool_result)

                        current_tool = None
                    elif current_block_type == "text" and current_text:
                        # Add accumulated text as a text content block
                        assistant_content.append({
                            "type": "text",
                            "text": current_text
                        })
                        current_text = ""

                    current_block_type = None

            # Add assistant message to working messages
            working_messages.append({"role": "assistant", "content": assistant_content})

            # If no tool calls, we're done
            if not has_tool_calls:
                print(f"Completed in {turn} turns")
                # Yield turn complete event
                yield {
                    "type": "turn_complete",
                    "turn": turn,
                    "completed": True
                }
                # Text was already streamed as it arrived
                break

            # Yield turn complete event (with more turns coming)
            yield {
                "type": "turn_complete",
                "turn": turn,
                "completed": False,
                "tools_used": len(self._current_tool_results) if hasattr(self, '_current_tool_results') else 0
            }

            # Add tool results for next turn
            if hasattr(self, '_current_tool_results') and self._current_tool_results:
                working_messages.append({"role": "user", "content": self._current_tool_results})
                self._current_tool_results = []

        if turn >= max_turns:
            print("Max turns reached")

        # SAVE TO HISTORIES
        response_id = f"{query_id}-r"

        # Full history
        history["full"].append({
            "id": query_id,
            "role": "user",
            "content": message
        })
        history["full"].append({
            "id": response_id,
            "role": "assistant",
            "content": final_response_text
        })

        # Summarize response
        response_summary = summarize_response(final_response_text, self.anthropic_client)

        # Summarized history
        history["summarized"].append({
            "id": query_id,
            "role": "user",
            "content": message
        })
        history["summarized"].append({
            "id": f"{response_id}-sum",
            "ref": response_id,
            "role": "assistant",
            "content": response_summary
        })

        # Yield completion event
        yield {
            "type": "done",
            "message_id": response_id,
            "summary": response_summary,
            "full_response": final_response_text
        }

    async def _handle_tool_call(
            self,
            content,
            history: Dict,
            query_id: str,
            tool_counter: int
    ) -> Dict:
        """Handle a single tool call"""

        if content.name == "retrieve_full_context":
            # Custom retrieval tool
            requested_id = content.input.get("id", "")
            print(f"Retrieving full context: {requested_id}")

            full_item = next(
                (item for item in history["full"] if item.get("id") == requested_id),
                None
            )

            if full_item:
                retrieved_content = full_item.get("content", "Not found")
            else:
                retrieved_content = f"Error: ID '{requested_id}' not found"

            return {
                "type": "tool_result",
                "tool_use_id": content.id,
                "content": retrieved_content
            }

        elif content.name == "retrieve_documentation":
            # RAG documentation retrieval
            doc_query = content.input.get("query", "")
            print(f"Retrieving documentation: {doc_query}")

            try:
                doc_result = await retrieve_doc(doc_query, self.anthropic_client)

                # Handle different return types (dict on success, string on error)
                if isinstance(doc_result, dict) and "text" in doc_result:
                    doc_text = doc_result["text"]
                    doc_name = doc_result.get("doc_name", doc_query)

                    chunks = chunk_by_section(doc_text)
                    print(f"Found {len(chunks)} documentation chunks")

                    # Step 1: Decompose user query into multiple focused sub-queries
                    print("Decomposing query into sub-queries...")
                    decompose_response = self.anthropic_client.messages.create(
                        model="claude-3-5-haiku-latest",
                        system="You are an expert at breaking down complex queries into focused sub-queries for documentation search. Always respond with valid JSON only.",
                        max_tokens=500,
                        messages=[{
                            "role": "user",
                            "content": f"""Break down this query into 4-5 focused sub-queries that would help retrieve comprehensive documentation.

Original query: {doc_query}

Examples:
<query>How to setup Telegram Bot API with webhooks</query>
<answer>{{"sub_queries": ["Telegram Bot API authentication and setup", "Telegram Bot webhook configuration", "Telegram Bot webhook security", "Telegram Bot error handling", "Telegram Bot best practices"]}}</answer>

<query>Twitter OAuth setup</query>
<answer>{{"sub_queries": ["Twitter OAuth authentication flow", "Twitter API credentials and tokens", "Twitter OAuth callback handling", "Twitter API rate limits"]}}</answer>

<query>Stripe payment integration</query>
<answer>{{"sub_queries": ["Stripe payment intents API", "Stripe webhook events", "Stripe API authentication", "Stripe error handling", "Stripe checkout flow"]}}</answer>

Return ONLY valid JSON with a "sub_queries" array. No explanation."""
                        }]
                    )

                    try:
                        decompose_json = decompose_response.content[0].text if decompose_response.content else ""
                        sub_queries_data = json.loads(decompose_json)
                        sub_queries = sub_queries_data.get("sub_queries", [doc_query])
                        print(f"Decomposed into {len(sub_queries)} sub-queries: {sub_queries}")
                    except (json.JSONDecodeError, Exception) as e:
                        print(f"Failed to decompose query: {e}. Using original query.")
                        sub_queries = [doc_query]

                    # Step 2: Search each sub-query and get top 3 results
                    vector_index = VectorIndex(embedding_fn=generate_embedding)
                    bm25_index = BM25Index()
                    retriever = Retriever(
                        bm25_index,
                        vector_index,
                        reranker_fn=lambda docs, q, k: reranker_fn(
                            docs, q, k, self.anthropic_client
                        )
                    )

                    retriever.add_documents([{"content": chunk} for chunk in chunks])

                    all_results = []
                    for sub_query in sub_queries:
                        print(f"Searching documentation for: {sub_query}")
                        sub_results = retriever.search(sub_query, k=3)
                        all_results.append({
                            "query": sub_query,
                            "results": sub_results
                        })

                    # Step 3: Format results grouped by sub-query
                    formatted_sections = []
                    doc_counter = 1
                    for query_result in all_results:
                        results = query_result["results"]

                        for doc, _ in results:
                            formatted_sections.append(f"[Doc {doc_counter}]\n{doc['content']}")
                            doc_counter += 1

                    rag_context = "\n\n".join(formatted_sections)

                    # Format sub-queries section
                    sub_queries_text = "\n".join([f"  - {sq}" for sq in sub_queries])

                    # Use doc_name instead of doc_query for display, include sub-queries
                    formatted_content = f"Documentation for '{doc_name}':\n\nSearch queries used:\n{sub_queries_text}\n\n{rag_context}"
                else:
                    # Error case - doc_result is a string error message
                    formatted_content = str(doc_result) if doc_result else f"No documentation found for '{doc_query}'"

                print("Documentation retrieved successfully")
                return {
                    "type": "tool_result",
                    "tool_use_id": content.id,
                    "content": formatted_content
                }

            except Exception as e:
                print(f"Documentation retrieval error: {e}")
                return {
                    "type": "tool_result",
                    "tool_use_id": content.id,
                    "content": f"Error retrieving documentation: {e}",
                    "is_error": True
                }

        else:
            # MCP GitHub tool
            try:
                tool_result = await self.github_client.call_tool(content.name, content.input)

                # Format result
                if isinstance(tool_result.content, list):
                    formatted_parts = []
                    for item in tool_result.content:
                        if hasattr(item, 'type') and hasattr(item, 'text') and item.type == 'text':
                            formatted_parts.append(item.text)
                        elif isinstance(item, str):
                            formatted_parts.append(item)
                        else:
                            formatted_parts.append(str(item))
                    formatted_content = "\n".join(formatted_parts) if formatted_parts else "No content"
                else:
                    formatted_content = str(tool_result.content)

                # Save to full history with ID
                tool_id = f"{query_id}-t{tool_counter + 1}"
                history["full"].append({
                    "id": tool_id,
                    "type": "tool_result",
                    "tool": content.name,
                    "input": content.input,
                    "content": formatted_content
                })

                # Summarize and add to summarized history
                tool_summary = summarize_tool_result(
                    content.name,
                    content.input,
                    formatted_content,
                    self.anthropic_client
                )
                history["summarized"].append({
                    "id": f"{tool_id}-sum",
                    "ref": tool_id,
                    "type": "tool_summary",
                    "content": tool_summary
                })

                print(f"Tool completed: {content.name}")
                return {
                    "type": "tool_result",
                    "tool_use_id": content.id,
                    "content": formatted_content
                }

            except Exception as e:
                print(f"Tool error: {e}")
                return {
                    "type": "tool_result",
                    "tool_use_id": content.id,
                    "content": f"Error: {e}",
                    "is_error": True
                }
