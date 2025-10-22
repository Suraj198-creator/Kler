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

            # Get GitHub tools
            github_tools = await self.github_client.list_tools()
            self.anthropic_tools = [{
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.inputSchema
            } for tool in github_tools]

            # Add custom tools
            self.anthropic_tools.append({
                "name": "retrieve_documentation",
                "description": "Retrieve external API documentation for setup guides, OAuth/authentication instructions, or technical references not available in the repository. Use this when you need documentation about APIs, SDKs, or technical concepts.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Documentation topic to search for (e.g., 'Twitter OAuth setup', 'LinkedIn Ads API authentication', 'Stripe payment integration')"
                        }
                    },
                    "required": ["query"]
                }
            })

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
                system_prompt = """You are a helpful AI assistant that answers questions about APIs, SDKs, and technical documentation.

TOOL USAGE GUIDELINES:
1. **retrieve_documentation**: ALWAYS use this tool for questions about:
   - API authentication, OAuth, credentials (e.g., "How do I authenticate with Twitter API?")
   - API endpoints, methods, parameters (e.g., "What's the endpoint for LinkedIn Ads API?")
   - SDK usage, setup, or code examples
   - Any technical implementation details about external APIs
   - When the user asks "how do I" or "show me" about any API/SDK

   IMPORTANT: Even if you have general knowledge, ALWAYS use retrieve_documentation for API/SDK questions to provide the most up-to-date and accurate information.

2. **GitHub tools** (search_repositories, get_file_contents, etc.): Use when explicitly asked about GitHub repositories or code:
   - "Show me the code for X in this repo" ✓
   - "Find repositories about Y" ✓

3. **create_repository, create_issue, etc.**: Use ONLY when explicitly asked to create something:
   - "Create a repo for me" ✓
   - "File an issue" ✓

4. **retrieve_full_context**: Use when referring to previous tool results by ID.

DO NOT use tools for:
- General greetings ("Hello", "Hi")
- General knowledge questions not related to specific APIs ("What is Python?", "Explain recursion")
- Simple conversations"""

                response = self.anthropic_client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=3000,
                    tools=self.anthropic_tools,
                    messages=working_messages,
                    system=system_prompt,
                    temperature=0.2
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
            conversation_id: Optional[str] = None
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
        max_turns = 10
        turn = 0
        tool_counter = 0
        final_response_text = ""
        documentation_sources = []  # Track all documentation retrieved

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
                system_prompt = """You are a helpful AI assistant that answers questions about APIs, SDKs, and technical documentation.

TOOL USAGE GUIDELINES:
1. **retrieve_documentation**: ALWAYS use this tool for questions about:
   - API authentication, OAuth, credentials (e.g., "How do I authenticate with Twitter API?")
   - API endpoints, methods, parameters (e.g., "What's the endpoint for LinkedIn Ads API?")
   - SDK usage, setup, or code examples
   - Any technical implementation details about external APIs
   - When the user asks "how do I" or "show me" about any API/SDK

   IMPORTANT: Even if you have general knowledge, ALWAYS use retrieve_documentation for API/SDK questions to provide the most up-to-date and accurate information.

2. **GitHub tools** (search_repositories, get_file_contents, etc.): Use when explicitly asked about GitHub repositories or code:
   - "Show me the code for X in this repo" ✓
   - "Find repositories about Y" ✓

3. **create_repository, create_issue, etc.**: Use ONLY when explicitly asked to create something:
   - "Create a repo for me" ✓
   - "File an issue" ✓

4. **retrieve_full_context**: Use when referring to previous tool results by ID.

DO NOT use tools for:
- General greetings ("Hello", "Hi")
- General knowledge questions not related to specific APIs ("What is Python?", "Explain recursion")
- Simple conversations"""

                print(f"DEBUG: Creating Anthropic stream with {len(working_messages)} messages")
                for i, msg in enumerate(working_messages):
                    print(f"DEBUG: Message {i}: role={msg['role']}, content_type={type(msg['content'])}, content_preview={str(msg['content'])[:200]}")

                stream = self.anthropic_client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=3000,
                    tools=self.anthropic_tools,
                    messages=working_messages,
                    system=system_prompt,
                    temperature=0.2,
                    stream=True
                )
            except Exception as api_error:
                import traceback
                error_details = traceback.format_exc()
                print(f"API Error: {api_error}")
                print(f"Full traceback:\n{error_details}")
                print(f"DEBUG: working_messages at time of error: {working_messages}")
                yield {"type": "error", "content": f"{str(api_error)}\n\nTraceback:\n{error_details}"}
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

                        # Check if documentation was retrieved
                        if current_tool["name"] == "retrieve_documentation" and "doc_metadata" in tool_result:
                            doc_meta = tool_result["doc_metadata"]
                            documentation_sources.append(doc_meta)

                            # Yield documentation event immediately
                            yield {
                                "type": "documentation_retrieved",
                                "query": doc_meta.get("query", ""),
                                "sources": doc_meta.get("sources", []),
                                "num_chunks": doc_meta.get("num_chunks", 0)
                            }

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
            # Convert dict representations back to proper format for Anthropic API
            formatted_assistant_content = []
            for item in assistant_content:
                if isinstance(item, dict):
                    # Already in dict format from our tool_use_dict
                    formatted_assistant_content.append(item)
                else:
                    # It's an Anthropic content block object
                    formatted_assistant_content.append(item)

            working_messages.append({"role": "assistant", "content": formatted_assistant_content})
            print(f"DEBUG: Added assistant message with content type: {type(formatted_assistant_content)}, is_list: {isinstance(formatted_assistant_content, list)}, length: {len(formatted_assistant_content) if isinstance(formatted_assistant_content, list) else 'N/A'}")

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
                print(f"DEBUG: Adding {len(self._current_tool_results)} tool results to working messages")
                print(f"DEBUG: Tool results structure: {self._current_tool_results}")

                # Ensure each tool result is a proper dict with type, tool_use_id, content
                formatted_tool_results = []
                for i, tr in enumerate(self._current_tool_results):
                    print(f"DEBUG: Tool result {i}: type={type(tr)}")
                    if isinstance(tr, dict):
                        print(f"DEBUG: Tool result {i} keys: {tr.keys()}")
                        print(f"DEBUG: Tool result {i} values:")
                        for key, value in tr.items():
                            print(f"  {key}: type={type(value)}, value_preview={str(value)[:100]}")

                        if "type" in tr and "tool_use_id" in tr:
                            # Only include allowed fields for Anthropic API
                            clean_result = {
                                "type": tr["type"],
                                "tool_use_id": tr["tool_use_id"],
                                "content": tr["content"]
                            }
                            # Include is_error if present
                            if "is_error" in tr:
                                clean_result["is_error"] = tr["is_error"]
                            formatted_tool_results.append(clean_result)
                        else:
                            print(f"WARNING: Tool result {i} missing required fields. Has: {tr.keys()}")
                    else:
                        print(f"WARNING: Tool result {i} is not a dict: {tr}")

                print(f"DEBUG: Formatted {len(formatted_tool_results)} valid tool results")

                if formatted_tool_results:
                    working_messages.append({
                        "role": "user",
                        "content": formatted_tool_results
                    })
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
            "full_response": final_response_text,
            "documentation_sources": documentation_sources
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
                doc_text = retrieve_doc(doc_query, self.anthropic_client)
                if doc_text:
                    chunks = chunk_by_section(doc_text)
                    print(f"Found {len(chunks)} documentation chunks")

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
                    rag_results = retriever.search(doc_query, k=6)

                    rag_context = "\n\n".join([
                        f"[Doc {i + 1}]\n{doc['content']}"
                        for i, (doc, _) in enumerate(rag_results)
                    ])

                    formatted_content = f"Documentation for '{doc_query}':\n\n{rag_context}"

                    # Extract source metadata (first few lines of each doc for display)
                    doc_sources = []
                    for i, (doc, score) in enumerate(rag_results):
                        # Get first line or first 100 chars as title
                        doc_content = doc['content']
                        first_line = doc_content.split('\n')[0][:100]
                        doc_sources.append({
                            "title": first_line,
                            "snippet": doc_content[:200] + "..." if len(doc_content) > 200 else doc_content,
                            "score": float(score)
                        })
                else:
                    formatted_content = f"No documentation found for '{doc_query}'"
                    doc_sources = []

                print("Documentation retrieved successfully")
                return {
                    "type": "tool_result",
                    "tool_use_id": content.id,
                    "content": formatted_content,
                    "doc_metadata": {
                        "query": doc_query,
                        "sources": doc_sources,
                        "num_chunks": len(chunks) if doc_text else 0
                    }
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
