"""
Multi-Stage Code Generator - Task decomposition with focused RAG.

Architecture:
STAGE 1: Task Decomposition (deterministic)
  → Break complex requests into subtasks
  → Identify which APIs are needed for what

STAGE 2: Per-Subtask Research (semi-agentic, bounded)
  → For EACH subtask independently:
    - Focused RAG queries (auth + operation-specific)
    - SDK discovery (optional)
    - Extract requirements
  → Max 5 turns per subtask (prevents runaway)

STAGE 3: Combine Requirements (deterministic)
  → Merge all credentials
  → Merge all dependencies
  → Build unified implementation plan

STAGE 4: Generate Integrated Code (deterministic)
  → Single cohesive script handling all subtasks
  → Data passing between subtasks if needed

Key improvements:
- No hallucinations: Each subtask has focused context
- Better RAG: Specific queries → better chunks
- Handles multi-API scenarios naturally
- Bounded per subtask (not globally)
"""

import os
import json
import asyncio
from typing import Dict, List, Optional, Any
from anthropic import Anthropic
from app.rag_pipeline import retrieve_doc, MCPClient, chunk_by_section, VectorIndex, BM25Index, Retriever, generate_embedding, reranker_fn


class AgenticCodeGenerator:
    """
    Agentic code generator that uses tool calling to research before generating code.

    The LLM has access to:
    - retrieve_documentation: Get API docs from Context7
    - search_github: Find SDKs and examples
    - get_file_contents: Read SDK authentication examples
    - search_code: Find specific code patterns in repos
    """

    def __init__(self, anthropic_client: Anthropic, github_client: MCPClient):
        self.anthropic_client = anthropic_client
        self.github_client = github_client
        self.research_tools = []
        self.conversation_history = []
        self.doc_cache = {}  # Cache documentation retrievals
        self.rate_limit_delay = 3.0  # Delay between API calls in seconds (increased to avoid rate limits)

    async def initialize_tools(self):
        """Build tool definitions for the LLM"""
        # Get GitHub MCP tools
        github_tools = await self.github_client.list_tools()

        # Add retrieve_documentation tool
        self.research_tools = [{
            "name": tool.name,
            "description": tool.description,
            "input_schema": tool.inputSchema
        } for tool in github_tools]

        # Add custom documentation retrieval tool
        self.research_tools.append({
            "name": "retrieve_documentation",
            "description": """Retrieve API documentation from Context7.

IMPORTANT SEARCH GUIDELINES:
- For X/Twitter API, search for "X API" or "Twitter API v2" (Twitter is now X)
- For authentication docs, include "OAuth" or "authentication" in topic
- For data retrieval, include the specific endpoint or data type
- Search multiple times for different aspects (auth + data access)
- Be specific about API versions (v2, v3, etc)

Examples:
- For Twitter posting: search "X API" with topic "post tweet v2"
- For Twitter auth: search "X API" with topic "OAuth authentication"
- For LinkedIn data: search "LinkedIn API" with topic "profile data retrieval"
- For Stripe webhooks: search "Stripe API" with topic "webhook signature verification"
""",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "What you're trying to accomplish (e.g., 'post tweet', 'get LinkedIn profile')"
                    }
                },
                "required": ["query"]
            }
        })

    async def generate_code_with_research(
        self,
        user_query: str,
        max_research_turns: int = 5,  # Per subtask
        max_debug_turns: int = 3
    ) -> Dict[str, Any]:
        """
        Multi-stage workflow with task decomposition.

        Returns:
            {
                "success": bool,
                "error": str (if failed),
                "credentials_needed": [...],
                "dependencies": [...],
                "research_summary": str
            }
        """

        # STAGE 1: Decompose task
        print("\n=== STAGE 1: Task Decomposition ===")
        subtasks = await self._decompose_task(user_query)

        if not subtasks or len(subtasks) == 0:
            return {
                "success": False,
                "error": "CANNOT_UNDERSTAND_TASK",
                "research_summary": "Could not understand what you're trying to build. Please be more specific.",
                "credentials_needed": [],
                "dependencies": []
            }

        print(f"Identified {len(subtasks)} subtask(s)")
        for i, task in enumerate(subtasks, 1):
            print(f"  {i}. {task['description']} ({task['api_service']})")

        # Limit complexity
        if len(subtasks) > 4:
            return {
                "success": False,
                "error": "TOO_COMPLEX",
                "research_summary": f"This task requires {len(subtasks)} different API integrations, which is too complex. Please break it down into smaller tasks.",
                "credentials_needed": [],
                "dependencies": []
            }

        # STAGE 2: Research each subtask independently
        print("\n=== STAGE 2: Per-Subtask Research ===")
        subtask_research = []

        for i, task in enumerate(subtasks, 1):
            print(f"\n--- Researching Subtask {i}/{len(subtasks)}: {task['api_service']} ---")

            research = await self._research_subtask(
                task,
                max_turns=max_research_turns
            )

            if not research["success"]:
                return {
                    "success": False,
                    "error": "NOT_ENOUGH_CONTEXT",
                    "research_summary": f"Could not find sufficient documentation for: {task['api_service']}. {research.get('reason', '')}",
                    "credentials_needed": [],
                    "dependencies": []
                }

            subtask_research.append(research)
            print(f"✓ Subtask {i} research complete")

        # STAGE 3: Combine requirements
        print("\n=== STAGE 3: Combining Requirements ===")
        combined = self._combine_requirements(subtasks, subtask_research)

        print(f"Total credentials: {len(combined['credentials_needed'])}")
        print(f"Total dependencies: {len(combined['dependencies'])}")

        return {
            "success": True,
            "credentials_needed": combined["credentials_needed"],
            "dependencies": combined["dependencies"],
            "research_summary": combined["implementation_notes"]
        }

    async def _decompose_task(self, user_query: str) -> List[Dict[str, Any]]:
        """
        STAGE 1: Decompose user query into subtasks.
        Each subtask = one API integration.
        """

        prompt = f"""Analyze this coding request and break it into subtasks:

User Query: {user_query}

Identify each API/service needed and what operation to perform.

Respond with JSON:
{{
  "subtasks": [
    {{
      "id": 1,
      "api_service": "API name (e.g., 'Twitter API', 'Slack API')",
      "operation": "What to do (e.g., 'post tweet', 'send message')",
      "description": "Brief description"
    }}
  ]
}}

Examples:
- "Post a tweet" → 1 subtask (Twitter API)
- "Get GitHub stars and post to Slack" → 2 subtasks (GitHub API, Slack API)
- "Fetch weather data" → 1 subtask (Weather API)

Respond with ONLY valid JSON."""

        try:
            response = self.anthropic_client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=800,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0
            )

            response_text = response.content[0].text
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1

            if json_start != -1 and json_end > json_start:
                result = json.loads(response_text[json_start:json_end])
                return result.get("subtasks", [])

        except Exception as e:
            print(f"Task decomposition failed: {e}")

        return []

    async def _research_subtask(
        self,
        subtask: Dict[str, Any],
        max_turns: int = 5
    ) -> Dict[str, Any]:
        """
        STAGE 2: Research a single subtask with focused RAG queries.

        For subtask "post tweet to Twitter":
          → Query 1: "Twitter API v2 OAuth authentication"
          → Query 2: "Twitter API v2 create tweet POST endpoint"
          → SDK search (optional)
        """

        api_service = subtask["api_service"]
        operation = subtask["operation"]

        system_prompt = f"""You are researching how to: {operation} using {api_service}

FOCUSED RESEARCH STRATEGY:
1. retrieve_documentation for AUTHENTICATION (be specific: OAuth, API keys, etc.)
2. retrieve_documentation for OPERATION (be specific: endpoint, method, parameters)
3. (OPTIONAL) search_repositories for Python SDK
4. (OPTIONAL) Read SDK README if found

IMPORTANT:
- Keep queries SPECIFIC to this one operation
- Stop if no documentation found
- SDK is OPTIONAL - requests library works too
- Maximum {max_turns} tool calls

WHEN DONE:
Respond with JSON:
{{
  "credentials_needed": [{{
    "name": "ENV_VAR_NAME",
    "label": "Human name",
    "type": "secret" or "text",
    "description": "Where to find",
    "required": true
  }}],
  "dependencies": ["package>=version"],
  "authentication_method": "How auth works",
  "operation_details": "How to perform: {operation}",
  "has_sdk": true/false,
  "ready": true
}}

If no docs: {{"ready": false, "reason": "no documentation"}}"""

        messages = [{
            "role": "user",
            "content": f"""Research how to: {operation}

API/Service: {api_service}

Use tools to find:
1. Authentication documentation
2. Operation-specific documentation
3. Python SDK (optional)

Be efficient - max {max_turns} tool calls."""
        }]

        turn = 0
        while turn < max_turns:
            turn += 1
            print(f"  Research turn {turn}/{max_turns}")

            # Rate limit protection
            if turn > 1:
                await asyncio.sleep(self.rate_limit_delay)

            try:
                response = self.anthropic_client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=2000,
                    system=system_prompt,
                    tools=self.research_tools,
                    messages=messages,
                    temperature=0.0
                )
            except Exception as e:
                print(f"  API Error: {e}")
                return {"success": False, "reason": str(e)}

            # Process response
            assistant_content = []
            has_tool_calls = False
            text_content = ""

            for content_block in response.content:
                assistant_content.append(content_block)

                if content_block.type == "text":
                    text_content += content_block.text

                elif content_block.type == "tool_use":
                    has_tool_calls = True
                    print(f"    Tool: {content_block.name}")

            messages.append({"role": "assistant", "content": assistant_content})

            # Check if done
            if not has_tool_calls:
                try:
                    json_start = text_content.find('{')
                    json_end = text_content.rfind('}') + 1

                    if json_start != -1 and json_end > json_start:
                        result = json.loads(text_content[json_start:json_end])

                        if not result.get("ready", False):
                            return {
                                "success": False,
                                "reason": result.get("reason", "insufficient documentation")
                            }

                        # Ensure string types
                        impl_notes = result.get("operation_details", "")
                        if isinstance(impl_notes, list):
                            impl_notes = "\n".join(impl_notes)

                        # Add requests if no SDK
                        dependencies = result.get("dependencies", [])
                        has_sdk = result.get("has_sdk", True)

                        if not has_sdk and not any("requests" in dep for dep in dependencies):
                            dependencies.append("requests>=2.31.0")

                        return {
                            "success": True,
                            "credentials": result.get("credentials_needed", []),
                            "dependencies": dependencies,
                            "auth_method": result.get("authentication_method", ""),
                            "operation_details": impl_notes,
                            "has_sdk": has_sdk
                        }

                except Exception as e:
                    print(f"  Parse error: {e}")

                # Ask to try again
                messages.append({
                    "role": "user",
                    "content": "Please provide your research in the JSON format specified."
                })
                continue

            # Execute tools
            tool_results = []
            for content_block in response.content:
                if content_block.type == "tool_use":
                    result = await self._execute_research_tool(content_block)
                    tool_results.append(result)

            if tool_results:
                messages.append({"role": "user", "content": tool_results})

        return {
            "success": False,
            "reason": f"Exceeded {max_turns} research turns"
        }

    def _combine_requirements(
        self,
        subtasks: List[Dict[str, Any]],
        subtask_research: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        STAGE 3: Combine all subtask requirements into one.
        """

        all_credentials = []
        all_dependencies = []
        implementation_parts = []

        seen_creds = set()
        seen_deps = set()

        for i, research in enumerate(subtask_research):
            subtask = subtasks[i]

            # Collect credentials (avoid duplicates)
            for cred in research.get("credentials", []):
                cred_key = cred["name"]
                if cred_key not in seen_creds:
                    all_credentials.append(cred)
                    seen_creds.add(cred_key)

            # Collect dependencies (avoid duplicates)
            for dep in research.get("dependencies", []):
                dep_name = dep.split(">=")[0].split("==")[0]
                if dep_name not in seen_deps:
                    all_dependencies.append(dep)
                    seen_deps.add(dep_name)

            # Build implementation notes
            implementation_parts.append(
                f"Subtask {i+1} ({subtask['api_service']}): {research.get('operation_details', '')}"
            )

        combined_notes = "\n\n".join(implementation_parts)

        return {
            "credentials_needed": all_credentials,
            "dependencies": all_dependencies,
            "implementation_notes": combined_notes
        }

    async def _research_phase(self, user_query: str, max_turns: int) -> Dict[str, Any]:
        """
        Semi-agentic research phase with bounded tool use.

        The LLM can use tools freely but is limited to max_turns.
        It should gather documentation and SDK info, then extract requirements.
        """

        system_prompt = """You are researching how to build API integration code.

TOOLS AVAILABLE:
- retrieve_documentation: Get API docs (use for auth + functionality)
- search_repositories: Find Python SDKs on GitHub (OPTIONAL - may not exist)
- get_file_contents: Read SDK examples (OPTIONAL)
- search_code: Find code patterns (OPTIONAL)

RESEARCH STRATEGY:
1. Identify the API/service needed
2. retrieve_documentation for AUTHENTICATION (OAuth, API keys, etc.)
3. retrieve_documentation for FUNCTIONALITY (the specific task)
4. (OPTIONAL) search_repositories for Python SDK
5. (OPTIONAL) Read SDK README if found

IMPORTANT RULES:
- STOP if no documentation found - respond with "no documentation available"
- SDK is OPTIONAL - it's OK if none exists (use requests library instead)
- Keep GitHub searches specific (e.g., "tweepy python twitter")
- Only read README.md files, not entire repos
- Maximum efficiency - don't over-research

WHEN DONE (or if no docs found):
Respond with JSON:
```json
{
  "credentials_needed": [{
    "name": "ENV_VAR_NAME",
    "label": "Human name",
    "type": "secret" or "text",
    "description": "Where to find",
    "required": true
  }],
  "dependencies": ["package-name>=version"],
  "authentication_method": "How auth works",
  "implementation_notes": "Key implementation points (STRING not array)",
  "has_sdk": true/false,
  "ready_to_code": true
}
```

If insufficient documentation: {"ready_to_code": false, "reason": "no documentation available"}

Do NOT write code. Just identify requirements."""

        # Start research conversation
        messages = [{
            "role": "user",
            "content": f"""Research how to build this in Python:

TASK: {user_query}

Use tools efficiently:
1. Identify the API/service
2. Get authentication documentation
3. Get functionality documentation
4. Optionally find Python SDK
5. Extract requirements

Be efficient - you have max {max_turns} tool calls. Stop early if you find no documentation."""
        }]

        turn = 0
        final_plan = None

        while turn < max_turns:
            turn += 1
            print(f"\nResearch Turn {turn}/{max_turns}")

            # Add delay to avoid rate limits (except first turn)
            if turn > 1:
                await asyncio.sleep(self.rate_limit_delay)

            try:
                response = self.anthropic_client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=2000,  # Reduced from 4000 to use fewer tokens
                    system=system_prompt,
                    tools=self.research_tools,
                    messages=messages,
                    temperature=0.0
                )
            except Exception as e:
                print(f"API Error: {e}")
                # If rate limit, wait longer and retry once
                if "rate_limit" in str(e).lower():
                    print(f"Rate limit hit, waiting 10 seconds before retry...")
                    await asyncio.sleep(10)
                    try:
                        response = self.anthropic_client.messages.create(
                            model="claude-haiku-4-5-20251001",
                            max_tokens=2000,
                            system=system_prompt,
                            tools=self.research_tools,
                            messages=messages,
                            temperature=0.0
                        )
                    except Exception as retry_error:
                        print(f"Retry failed: {retry_error}")
                        return {"success": False, "summary": f"API Error after retry: {retry_error}"}
                else:
                    return {"success": False, "summary": f"API Error: {e}"}

            # Process response
            assistant_content = []
            has_tool_calls = False
            text_content = ""

            for content_block in response.content:
                assistant_content.append(content_block)

                if content_block.type == "text":
                    text_content += content_block.text
                    print(f"LLM: {content_block.text[:200]}...")

                elif content_block.type == "tool_use":
                    has_tool_calls = True
                    print(f"Tool: {content_block.name} with {content_block.input}")

            messages.append({"role": "assistant", "content": assistant_content})

            # Check if LLM is done researching
            if not has_tool_calls:
                # Try to extract JSON plan
                try:
                    # Look for JSON in response
                    json_start = text_content.find('{')
                    json_end = text_content.rfind('}') + 1

                    if json_start != -1 and json_end > json_start:
                        json_text = text_content[json_start:json_end]
                        final_plan = json.loads(json_text)

                        # Check if LLM says not ready due to insufficient docs
                        if not final_plan.get("ready_to_code", False):
                            reason = final_plan.get("reason", "Insufficient documentation")
                            print(f"\n=== Research Failed: {reason} ===")
                            return {
                                "success": False,
                                "summary": f"No documentation available for this API integration."
                            }

                        if final_plan.get("ready_to_code"):
                            print("\n=== Research Complete ===")

                            # Get implementation_notes and ensure it's a string
                            impl_notes = final_plan.get("implementation_notes", "")
                            if isinstance(impl_notes, list):
                                impl_notes = "\n".join(impl_notes)

                            # Ensure dependencies include requests if no SDK
                            dependencies = final_plan.get("dependencies", [])
                            has_sdk = final_plan.get("has_sdk", True)

                            if not has_sdk and not any("requests" in dep for dep in dependencies):
                                dependencies.append("requests>=2.31.0")

                            return {
                                "success": True,
                                "credentials_needed": final_plan.get("credentials_needed", []),
                                "dependencies": dependencies,
                                "summary": impl_notes
                            }
                except Exception as e:
                    print(f"Failed to parse plan: {e}")

                # If no valid plan, ask LLM to try again
                messages.append({
                    "role": "user",
                    "content": "Please provide your research summary in the JSON format specified."
                })
                continue

            # Execute tool calls
            tool_results = []
            for content_block in response.content:
                if content_block.type == "tool_use":
                    tool_result = await self._execute_research_tool(content_block)
                    tool_results.append(tool_result)

            if tool_results:
                messages.append({"role": "user", "content": tool_results})

        return {
            "success": False,
            "summary": f"Research exceeded {max_turns} turns without completing"
        }

    async def _execute_research_tool(self, tool_use) -> Dict[str, Any]:
        """Execute a research tool call"""

        if tool_use.name == "retrieve_documentation":
            query = tool_use.input.get("query", "")

            # Check cache first
            if query in self.doc_cache:
                print(f"  ✓ Using cached docs for: {query}")
                return {
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": self.doc_cache[query]
                }

            print(f"  → Retrieving docs for: {query}")

            try:
                # Retrieve full documentation
                doc_text = retrieve_doc(query, self.anthropic_client)

                if not doc_text:
                    result_text = "No documentation found"
                else:
                    # Chunk the documentation
                    chunks = chunk_by_section(doc_text)
                    print(f"  Found {len(chunks)} documentation chunks")

                    # Use RAG pipeline to get top k=3 chunks
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
                    rag_results = retriever.search(query, k=3)

                    # Format results
                    rag_context = "\n\n".join([
                        f"[Doc {i + 1}]\n{doc['content']}"
                        for i, (doc, _) in enumerate(rag_results)
                    ])

                    result_text = f"Documentation for '{query}':\n\n{rag_context}"
                    print(f"  ✓ Retrieved {len(result_text)} chars (3 top chunks)")

                # Cache the result
                self.doc_cache[query] = result_text

            except Exception as e:
                result_text = f"Error retrieving documentation: {e}"
                print(f"  ✗ Error: {e}")

            return {
                "type": "tool_result",
                "tool_use_id": tool_use.id,
                "content": result_text
            }

        else:
            # GitHub MCP tool
            try:
                print(f"  → Calling GitHub tool: {tool_use.name}")
                result = await self.github_client.call_tool(tool_use.name, tool_use.input)

                # Format result
                if isinstance(result.content, list):
                    formatted_parts = []
                    for item in result.content:
                        if hasattr(item, 'type') and hasattr(item, 'text') and item.type == 'text':
                            formatted_parts.append(item.text)
                        elif isinstance(item, str):
                            formatted_parts.append(item)
                        else:
                            formatted_parts.append(str(item))
                    formatted_content = "\n".join(formatted_parts) if formatted_parts else "No content"
                else:
                    formatted_content = str(result.content)

                # Truncate to reduce token usage
                if len(formatted_content) > 3000:
                    formatted_content = formatted_content[:3000] + "\n... (truncated for brevity)"

                print(f"  ✓ Got {len(formatted_content)} chars")

                return {
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": formatted_content
                }

            except Exception as e:
                print(f"  ✗ Error: {e}")
                return {
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": f"Error: {e}",
                    "is_error": True
                }

    async def generate_code_from_research(
        self,
        research_result: Dict[str, Any],
        user_query: str
    ) -> str:
        """
        Phase 2: Generate code based on research results.

        This phase has NO tool calling - code must be based purely on research.
        """

        system_prompt = """You are an expert Python developer writing code based on research.

CRITICAL RULES:
1. Use ONLY information from the research provided
2. Do NOT make up API calls or methods
3. Load credentials from environment variables using os.environ['VAR_NAME']
4. Include comprehensive error handling
5. Add detailed comments explaining each step
6. Validate all required environment variables at the start

Your code must be production-ready and fully functional."""

        credential_names = [cred['name'] for cred in research_result.get('credentials_needed', [])]

        prompt = f"""Write complete Python code for this task:

TASK: {user_query}

RESEARCH FINDINGS:
{research_result.get('summary', '')}

REQUIRED CREDENTIALS (load from environment):
{json.dumps(credential_names, indent=2)}

REQUIRED DEPENDENCIES:
{json.dumps(research_result.get('dependencies', []), indent=2)}

CODE STRUCTURE:
```python
import os
import sys

# Validate environment variables
required_vars = {json.dumps(credential_names)}
missing_vars = [var for var in required_vars if not os.environ.get(var)]
if missing_vars:
    print("Error: Missing environment variables:", ', '.join(missing_vars))
    sys.exit(1)

# Load credentials
# ... load each credential

# Import required libraries
# ... imports

# Main logic
# ... your code here based on research
```

Write the complete, runnable code based ONLY on the research findings. No explanations."""

        try:
            response = self.anthropic_client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=2000,  # Reduced from 4000 to conserve tokens
                system=system_prompt,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0
            )

            code_text = response.content[0].text

            # Extract code from markdown
            if '```python' in code_text:
                start = code_text.find('```python') + len('```python')
                end = code_text.find('```', start)
                code_text = code_text[start:end].strip()
            elif '```' in code_text:
                start = code_text.find('```') + 3
                end = code_text.find('```', start)
                code_text = code_text[start:end].strip()

            return code_text

        except Exception as e:
            raise Exception(f"Code generation failed: {e}")

    async def debug_with_tools(
        self,
        original_code: str,
        execution_error: Dict[str, Any],
        user_query: str,
        research_summary: str,
        max_turns: int = 3  # Reduced for efficiency
    ) -> Dict[str, Any]:
        """
        Semi-agentic debug phase (bounded to max_turns).

        The LLM can optionally use tools to research the error,
        or just fix it directly if the error is obvious.
        """

        system_prompt = """You are debugging failed Python code.

TOOLS (OPTIONAL):
- retrieve_documentation: Get updated docs
- search_code: Find usage patterns
- get_file_contents: Read SDK code

DEBUG STRATEGY:
1. Analyze the error
2. If obvious fix: provide code immediately
3. If unclear: use 1-2 tools to research, then fix

Respond with fixed code in ```python block when ready.

Be efficient - you have limited tool calls."""

        messages = [{
            "role": "user",
            "content": f"""Fix this failed code:

```python
{original_code}
```

Error: {execution_error.get('error', '')}
Output: {execution_error.get('output', '')[:500]}

Task: {user_query}

Use tools if needed, or fix directly if obvious. Max {max_turns} turns."""
        }]

        turn = 0
        fixed_code = None

        while turn < max_turns:
            turn += 1
            print(f"\nDebug Turn {turn}/{max_turns}")

            # Add delay before debug API call
            if turn > 1:
                await asyncio.sleep(self.rate_limit_delay)

            try:
                response = self.anthropic_client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=2000,  # Reduced from 4000
                    system=system_prompt,
                    tools=self.research_tools,
                    messages=messages,
                    temperature=0.0
                )
            except Exception as e:
                print(f"API Error: {e}")
                return {"success": False, "code": original_code, "error": str(e)}

            # Process response
            assistant_content = []
            has_tool_calls = False
            text_content = ""

            for content_block in response.content:
                assistant_content.append(content_block)

                if content_block.type == "text":
                    text_content += content_block.text

                elif content_block.type == "tool_use":
                    has_tool_calls = True
                    print(f"Debug Tool: {content_block.name}")

            messages.append({"role": "assistant", "content": assistant_content})

            # Check if LLM provided fixed code
            if not has_tool_calls:
                # Extract code
                if '```python' in text_content:
                    start = text_content.find('```python') + len('```python')
                    end = text_content.find('```', start)
                    fixed_code = text_content[start:end].strip()
                elif '```' in text_content:
                    start = text_content.find('```') + 3
                    end = text_content.find('```', start)
                    fixed_code = text_content[start:end].strip()

                if fixed_code:
                    print(f"\n=== Fixed Code Generated ===")
                    return {"success": True, "code": fixed_code}
                else:
                    messages.append({
                        "role": "user",
                        "content": "Please provide the fixed code in a Python code block."
                    })
                    continue

            # Execute tool calls
            tool_results = []
            for content_block in response.content:
                if content_block.type == "tool_use":
                    tool_result = await self._execute_research_tool(content_block)
                    tool_results.append(tool_result)

            if tool_results:
                messages.append({"role": "user", "content": tool_results})

        return {
            "success": False,
            "code": original_code,
            "error": f"Debug exceeded {max_turns} turns"
        }
