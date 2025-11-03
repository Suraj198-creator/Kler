import os
import sys
import asyncio
import json
import re
import math
import random
import string
import httpx
from typing import Optional, Any, Dict, List, Tuple, Protocol, Callable
from contextlib import AsyncExitStack
from collections import Counter
from mcp import ClientSession, StdioServerParameters, types
from mcp.client.stdio import stdio_client
from dotenv import load_dotenv
from anthropic import Anthropic
import voyageai

load_dotenv()


# ============================================================================
# RAG PIPELINE COMPONENTS
# ============================================================================

class VectorIndex:
    def __init__(self, distance_metric: str = "cosine", embedding_fn=None):
        self.vectors: List[List[float]] = []
        self.documents: List[Dict[str, Any]] = []
        self._vector_dim: Optional[int] = None
        if distance_metric not in ["cosine", "euclidean"]:
            raise ValueError("distance_metric must be 'cosine' or 'euclidean'")
        self._distance_metric = distance_metric
        self._embedding_fn = embedding_fn

    def add_document(self, document: Dict[str, Any]):
        if not self._embedding_fn:
            raise ValueError("Embedding function not provided during initialization.")
        if not isinstance(document, dict):
            raise TypeError("Document must be a dictionary.")
        if "content" not in document:
            raise ValueError("Document dictionary must contain a 'content' key.")
        content = document["content"]
        if not isinstance(content, str):
            raise TypeError("Document 'content' must be a string.")
        vector = self._embedding_fn(content)
        self.add_vector(vector=vector, document=document)

    def add_documents(self, documents: List[Dict[str, Any]]):
        if not self._embedding_fn:
            raise ValueError("Embedding function not provided during initialization.")
        if not isinstance(documents, list):
            raise TypeError("Documents must be a list of dictionaries.")
        if not documents:
            return
        contents = []
        for i, doc in enumerate(documents):
            if not isinstance(doc, dict):
                raise TypeError(f"Document at index {i} must be a dictionary.")
            if "content" not in doc:
                raise ValueError(f"Document at index {i} must contain a 'content' key.")
            if not isinstance(doc["content"], str):
                raise TypeError(f"Document 'content' at index {i} must be a string.")
            contents.append(doc["content"])
        vectors = self._embedding_fn(contents)
        for vector, document in zip(vectors, documents):
            self.add_vector(vector=vector, document=document)

    def search(self, query: Any, k: int = 1) -> List[Tuple[Dict[str, Any], float]]:
        if not self.vectors:
            return []
        if isinstance(query, str):
            if not self._embedding_fn:
                raise ValueError("Embedding function not provided for string query.")
            query_vector = self._embedding_fn(query)
        elif isinstance(query, list) and all(isinstance(x, (int, float)) for x in query):
            query_vector = query
        else:
            raise TypeError("Query must be either a string or a list of numbers.")
        if self._vector_dim is None:
            return []
        if len(query_vector) != self._vector_dim:
            raise ValueError(f"Query vector dimension mismatch. Expected {self._vector_dim}, got {len(query_vector)}")
        if k <= 0:
            raise ValueError("k must be a positive integer.")
        if self._distance_metric == "cosine":
            dist_func = self._cosine_distance
        else:
            dist_func = self._euclidean_distance
        distances = []
        for i, stored_vector in enumerate(self.vectors):
            distance = dist_func(query_vector, stored_vector)
            distances.append((distance, self.documents[i]))
        distances.sort(key=lambda item: item[0])
        return [(doc, dist) for dist, doc in distances[:k]]

    def add_vector(self, vector, document: Dict[str, Any]):
        if not isinstance(vector, list) or not all(isinstance(x, (int, float)) for x in vector):
            raise TypeError("Vector must be a list of numbers.")
        if not isinstance(document, dict):
            raise TypeError("Document must be a dictionary.")
        if "content" not in document:
            raise ValueError("Document dictionary must contain a 'content' key.")
        if not self.vectors:
            self._vector_dim = len(vector)
        elif len(vector) != self._vector_dim:
            raise ValueError(f"Inconsistent vector dimension. Expected {self._vector_dim}, got {len(vector)}")
        self.vectors.append(list(vector))
        self.documents.append(document)

    def _euclidean_distance(self, vec1: List[float], vec2: List[float]) -> float:
        if len(vec1) != len(vec2):
            raise ValueError("Vectors must have the same dimension")
        return math.sqrt(sum((p - q) ** 2 for p, q in zip(vec1, vec2)))

    def _dot_product(self, vec1: List[float], vec2: List[float]) -> float:
        if len(vec1) != len(vec2):
            raise ValueError("Vectors must have the same dimension")
        return sum(p * q for p, q in zip(vec1, vec2))

    def _magnitude(self, vec: List[float]) -> float:
        return math.sqrt(sum(x * x for x in vec))

    def _cosine_distance(self, vec1: List[float], vec2: List[float]) -> float:
        if len(vec1) != len(vec2):
            raise ValueError("Vectors must have the same dimension")
        mag1 = self._magnitude(vec1)
        mag2 = self._magnitude(vec2)
        if mag1 == 0 and mag2 == 0:
            return 0.0
        elif mag1 == 0 or mag2 == 0:
            return 1.0
        dot_prod = self._dot_product(vec1, vec2)
        cosine_similarity = dot_prod / (mag1 * mag2)
        cosine_similarity = max(-1.0, min(1.0, cosine_similarity))
        return 1.0 - cosine_similarity


class BM25Index:
    def __init__(self, k1: float = 1.5, b: float = 0.75, tokenizer: Optional[Callable[[str], List[str]]] = None):
        self.documents: List[Dict[str, Any]] = []
        self._corpus_tokens: List[List[str]] = []
        self._doc_len: List[int] = []
        self._doc_freqs: Dict[str, int] = {}
        self._avg_doc_len: float = 0.0
        self._idf: Dict[str, float] = {}
        self._index_built: bool = False
        self.k1 = k1
        self.b = b
        self._tokenizer = tokenizer if tokenizer else self._default_tokenizer

    def _default_tokenizer(self, text: str) -> List[str]:
        text = text.lower()
        tokens = re.split(r"\W+", text)
        return [token for token in tokens if token]

    def _update_stats_add(self, doc_tokens: List[str]):
        self._doc_len.append(len(doc_tokens))
        seen_in_doc = set()
        for token in doc_tokens:
            if token not in seen_in_doc:
                self._doc_freqs[token] = self._doc_freqs.get(token, 0) + 1
                seen_in_doc.add(token)
        self._index_built = False

    def _calculate_idf(self):
        N = len(self.documents)
        self._idf = {}
        for term, freq in self._doc_freqs.items():
            idf_score = math.log(((N - freq + 0.5) / (freq + 0.5)) + 1)
            self._idf[term] = idf_score

    def _build_index(self):
        if not self.documents:
            self._avg_doc_len = 0.0
            self._idf = {}
            self._index_built = True
            return
        self._avg_doc_len = sum(self._doc_len) / len(self.documents)
        self._calculate_idf()
        self._index_built = True

    def add_document(self, document: Dict[str, Any]):
        if not isinstance(document, dict):
            raise TypeError("Document must be a dictionary.")
        if "content" not in document:
            raise ValueError("Document dictionary must contain a 'content' key.")
        content = document.get("content", "")
        if not isinstance(content, str):
            raise TypeError("Document 'content' must be a string.")
        doc_tokens = self._tokenizer(content)
        self.documents.append(document)
        self._corpus_tokens.append(doc_tokens)
        self._update_stats_add(doc_tokens)

    def add_documents(self, documents: List[Dict[str, Any]]):
        if not isinstance(documents, list):
            raise TypeError("Documents must be a list of dictionaries.")
        if not documents:
            return
        for i, doc in enumerate(documents):
            if not isinstance(doc, dict):
                raise TypeError(f"Document at index {i} must be a dictionary.")
            if "content" not in doc:
                raise ValueError(f"Document at index {i} must contain a 'content' key.")
            if not isinstance(doc["content"], str):
                raise TypeError(f"Document 'content' at index {i} must be a string.")
            content = doc["content"]
            doc_tokens = self._tokenizer(content)
            self.documents.append(doc)
            self._corpus_tokens.append(doc_tokens)
            self._update_stats_add(doc_tokens)
        self._index_built = False

    def _compute_bm25_score(self, query_tokens: List[str], doc_index: int) -> float:
        score = 0.0
        doc_term_counts = Counter(self._corpus_tokens[doc_index])
        doc_length = self._doc_len[doc_index]
        for token in query_tokens:
            if token not in self._idf:
                continue
            idf = self._idf[token]
            term_freq = doc_term_counts.get(token, 0)
            numerator = idf * term_freq * (self.k1 + 1)
            denominator = term_freq + self.k1 * (1 - self.b + self.b * (doc_length / self._avg_doc_len))
            score += numerator / (denominator + 1e-9)
        return score

    def search(self, query: Any, k: int = 1, score_normalization_factor: float = 0.1) -> List[
        Tuple[Dict[str, Any], float]]:
        if not self.documents:
            return []
        if isinstance(query, str):
            query_text = query
        else:
            raise TypeError("Query must be a string for BM25Index.")
        if k <= 0:
            raise ValueError("k must be a positive integer.")
        if not self._index_built:
            self._build_index()
        if self._avg_doc_len == 0:
            return []
        query_tokens = self._tokenizer(query_text)
        if not query_tokens:
            return []
        raw_scores = []
        for i in range(len(self.documents)):
            raw_score = self._compute_bm25_score(query_tokens, i)
            if raw_score > 1e-9:
                raw_scores.append((raw_score, self.documents[i]))
        raw_scores.sort(key=lambda item: item[0], reverse=True)
        normalized_results = []
        for raw_score, doc in raw_scores[:k]:
            normalized_score = math.exp(-score_normalization_factor * raw_score)
            normalized_results.append((doc, normalized_score))
        normalized_results.sort(key=lambda item: item[1])
        return normalized_results


class SearchIndex(Protocol):
    def add_document(self, document: Dict[str, Any]) -> None: ...

    def add_documents(self, documents: List[Dict[str, Any]]) -> None: ...

    def search(self, query: Any, k: int = 1) -> List[Tuple[Dict[str, Any], float]]: ...


class Retriever:
    def __init__(self, *indexes: SearchIndex,
                 reranker_fn: Optional[Callable[[List[Dict[str, Any]], str, int], List[str]]] = None):
        if len(indexes) == 0:
            raise ValueError("At least one index must be provided")
        self._indexes = list(indexes)
        self._reranker_fn = reranker_fn

    def add_document(self, document: Dict[str, Any]):
        if "id" not in document:
            document["id"] = "".join(random.choices(string.ascii_letters + string.digits, k=4))
        for index in self._indexes:
            index.add_document(document)

    def add_documents(self, documents: List[Dict[str, Any]]):
        for index in self._indexes:
            index.add_documents(documents)

    def search(self, query_text: str, k: int = 1, k_rrf: int = 60) -> List[Tuple[Dict[str, Any], float]]:
        if not isinstance(query_text, str):
            raise TypeError("Query text must be a string.")
        if k <= 0:
            raise ValueError("k must be a positive integer.")
        if k_rrf < 0:
            raise ValueError("k_rrf must be non-negative.")
        all_results = [index.search(query_text, k=k * 5) for index in self._indexes]
        doc_ranks = {}
        for idx, results in enumerate(all_results):
            for rank, (doc, _) in enumerate(results):
                doc_id = id(doc)
                if doc_id not in doc_ranks:
                    doc_ranks[doc_id] = {"doc_obj": doc, "ranks": [float("inf")] * len(self._indexes)}
                doc_ranks[doc_id]["ranks"][idx] = rank + 1

        def calc_rrf_score(ranks: List[float]) -> float:
            return sum(1.0 / (k_rrf + r) for r in ranks if r != float("inf"))

        scored_docs: List[Tuple[Dict[str, Any], float]] = [
            (ranks["doc_obj"], calc_rrf_score(ranks["ranks"])) for ranks in doc_ranks.values()
        ]
        filtered_docs = [(doc, score) for doc, score in scored_docs if score > 0]
        filtered_docs.sort(key=lambda x: x[1], reverse=True)
        result = filtered_docs[:k]
        if self._reranker_fn is not None:
            docs_only = [doc for doc, _ in result]
            for doc in docs_only:
                if "id" not in doc:
                    doc["id"] = "".join(random.choices(string.ascii_letters + string.digits, k=4))
            doc_lookup = {doc["id"]: doc for doc in docs_only}
            reranked_ids = self._reranker_fn(docs_only, query_text, k)
            new_result = []
            original_scores = {id(doc): score for doc, score in result}
            for doc_id in reranked_ids:
                if doc_id in doc_lookup:
                    doc = doc_lookup[doc_id]
                    score = original_scores.get(id(doc), 0.0)
                    new_result.append((doc, score))
            result = new_result
        return result


# ============================================================================
# RAG HELPER FUNCTIONS
# ============================================================================

def generate_embedding(chunks, model="voyage-3-large", input_type="query"):
    """Generate embeddings using VoyageAI"""
    voyage_client = voyageai.Client(api_key=os.getenv("VOYAGE_API_KEY"))
    is_list = isinstance(chunks, list)
    input_data = chunks if is_list else [chunks]
    result = voyage_client.embed(input_data, model=model, input_type=input_type)
    return result.embeddings if is_list else result.embeddings[0]


def chunk_by_section(document_text):
    """Chunk document by section delimiter"""
    pattern = r"\n--------------------------------"
    return re.split(pattern, document_text)


async def retrieve_doc(query, anthropic_client):
    """Retrieve documentation from Context7 API (async)"""
    REQUEST_TIMEOUT = 30  # 30 seconds timeout for API requests
    url = "https://context7.com/api/v1/search"
    headers = {"Authorization": f"Bearer {os.getenv('CONTEXT7_API_KEY')}"}

    try:
        print(f"Starting documentation retrieval for query: {query}")

        # Step 1: Get doc_name and topic from Claude
        print("Step 1: Asking Claude to parse query...")
        claude_response1 = anthropic_client.messages.create(
            model="claude-3-5-haiku-latest",
            system="You are an expert at looking at prompts and giving the api doc name to be searched on context7 for the api documentation. You will also give the topic of what needs to be searched. Always respond with valid JSON only.",
            max_tokens=1000,
            messages=[{
                "role": "user",
                "content": f"""give me the api documentation name and the topic i will need to search for using context7: {query}

IMPORTANT GUIDELINES:
- For Telegram-related queries: Use "Telegram Bot API" or "Telegram API" as the doc_name
- For OpenAI-related queries: Use "OpenAI API" as the doc_name
- For Twitter/X-related queries: ALWAYS use "X API" as the doc_name (Twitter is now X, prefer official X API over third-party libraries like Tweepy)
- For authentication queries: Use "OAuth" or "authentication" in the topic
- For other APIs: Use the official API name (e.g., "Stripe API", "LinkedIn API")
- Prefer official APIs over third-party SDKs

Examples:
<prompt> Can you provide the Oauth setup for twitter X ads api.</prompt>
<answer> {{"doc_name": "X API", "topic": "OAuth setup"}} </answer>

<prompt> How to post a tweet using Python</prompt>
<answer> {{"doc_name": "X API", "topic": "post tweet v2"}} </answer>

<prompt> How to send messages with Telegram bot</prompt>
<answer> {{"doc_name": "Telegram Bot API", "topic": "send message"}} </answer>

<prompt> OpenAI chat completions</prompt>
<answer> {{"doc_name": "OpenAI API", "topic": "chat completions"}} </answer>

Remember to just give back valid JSON, no explanation, just the JSON object."""
            }]
        )

        claude_json_response = claude_response1.content[0].text if claude_response1.content else ""
        print(f"Claude response: {claude_json_response}")

        try:
            parsed_response = json.loads(claude_json_response)
            doc_name = parsed_response.get("doc_name", "")
            topic = parsed_response.get("topic", "")
            print(f"Parsed - doc_name: {doc_name}, topic: {topic}")
        except json.JSONDecodeError as e:
            print(f"Failed to parse Claude response as JSON: {e}. Using query as doc_name.")
            doc_name = query
            topic = ""

        # Step 2: Search Context7 for matching documentation (ASYNC)
        print(f"Step 2: Searching Context7 for '{doc_name}'...")
        params = {"query": doc_name}

        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.get(url, headers=headers, params=params)

        print(f"Context7 search response status: {response.status_code}")

        if response.status_code != 200:
            print(f"Context7 search failed with status {response.status_code}: {response.text}")
            return f"Error: Context7 API search failed with status {response.status_code}"

        response_data = response.json()
        print(f"Context7 search returned {len(response_data) if isinstance(response_data, list) else 'unknown'} results")

        if not response_data:
            print("No documentation found in Context7 search")
            return f"No documentation found for '{doc_name}' in Context7"

        # Step 3: Ask Claude to pick the best document
        print("Step 3: Asking Claude to select best document...")
        claude_response = anthropic_client.messages.create(
            model="claude-3-5-haiku-latest",
            system="You are an expert at looking at prompts and picking a API doc for their issue",
            max_tokens=1500,
            messages=[{
                "role": "user",
                "content": f"""I need you to pick the best document to look at depending on the query the user has entered.

Query: {query}

Response data from Context7 on different docs:
<docs>{response_data}</docs>

Output structure: The id for the api documentation to use from the <docs> data. Just give the id no need for any explanations etc."""
            }]
        )

        selected_doc_id = claude_response.content[0].text.strip() if claude_response.content else ""
        print(f"Selected document ID: {selected_doc_id}")

        if not selected_doc_id:
            print("Claude failed to select a document ID")
            return "Error: Failed to select documentation"

        clean_doc_id = selected_doc_id.lstrip('/')
        url2 = f"https://context7.com/api/v1/{clean_doc_id}"

        # Step 4: Retrieve the actual documentation (ASYNC)
        print(f"Step 4: Retrieving documentation from {url2}...")
        params2 = {"type": "text", "topic": topic, "tokens": 50000}

        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response2 = await client.get(url2, headers=headers, params=params2)

        print(f"Documentation retrieval response status: {response2.status_code}")

        if response2.status_code == 200:
            doc_text = response2.text
            print(f"Successfully retrieved documentation ({len(doc_text)} characters)")
            return doc_text
        else:
            print(f"Failed to retrieve documentation: status {response2.status_code}")
            return f"Error: Failed to retrieve documentation (status {response2.status_code})"

    except httpx.TimeoutException as e:
        error_msg = f"Timeout while retrieving documentation: {str(e)}"
        print(error_msg)
        return error_msg
    except httpx.HTTPError as e:
        error_msg = f"Network error while retrieving documentation: {str(e)}"
        print(error_msg)
        return error_msg
    except Exception as e:
        error_msg = f"Unexpected error in retrieve_doc: {str(e)}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        return error_msg


def reranker_fn(docs, query_text, k, anthropic_client):
    """Rerank documents using Claude"""
    joined_docs = "\n".join([
        f"""<document>
<document_id>{doc["id"]}</document_id>
<document_content>{doc["content"]}</document_content>
</document>"""
        for doc in docs
    ])

    prompt = f"""You are about to be given a set of documents, along with an id of each.
Your task is to select the {k} most relevant documents to answer the user's question.

Here is the user's question:
<question>
{query_text}
</question>

Here are the documents to select from:
<documents>
{joined_docs}
</documents>

Respond in the following format:
```json
{{
    "document_ids": str[] # List document ids, {k} elements long, sorted in order of decreasing relevance to the user's query.
}}
```
"""

    result = anthropic_client.messages.create(
        model="claude-3-5-haiku-latest",
        max_tokens=1000,
        messages=[
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": "```json"}
        ],
        stop_sequences=["```"]
    )

    response_text = "\n".join([block.text for block in result.content if block.type == "text"])
    return json.loads(response_text)["document_ids"]


# ============================================================================
# SUMMARIZATION FUNCTIONS
# ============================================================================

def summarize_tool_result(tool_name: str, tool_input: dict, tool_output: str, anthropic_client: Anthropic) -> str:
    """Summarize what a tool call did and what it returned"""
    truncated_output = tool_output[:1000] + "..." if len(tool_output) > 1000 else tool_output

    prompt = f"""Summarise this tool call in 1-2 sentences:

Tool: {tool_name}
Input: {json.dumps(tool_input, indent=2)}
Output preview: {truncated_output}

Format: "Called [tool] with [key params], retrieved/returned [brief result]" """

    try:
        response = anthropic_client.messages.create(
            model="claude-3-5-haiku-latest",
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text.strip()
    except Exception as e:
        return f"Called {tool_name} with {list(tool_input.keys())}"


def summarize_response(response_text: str, anthropic_client: Anthropic) -> str:
    """Summarize the final assistant response"""
    prompt = f"""Summarize this assistant response in 2-3 sentences, preserving key facts:

{response_text}

Focus on what was explained/provided, not how."""

    try:
        response = anthropic_client.messages.create(
            model="claude-3-5-haiku-latest",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text.strip()
    except Exception as e:
        return response_text[:200] + "..."


# ============================================================================
# MCP CLIENT
# ============================================================================
class MCPClient:
    def __init__(self, command: str, args: list[str], env: Optional[dict] = None, name: str = "unnamed"):
        self._command = command
        self._args = args
        self._env = env
        self._name = name
        self._session: Optional[ClientSession] = None
        self._exit_stack: AsyncExitStack = AsyncExitStack()

    async def connect(self):
        server_params = StdioServerParameters(command=self._command, args=self._args, env=self._env)
        stdio_transport = await self._exit_stack.enter_async_context(stdio_client(server_params))
        _stdio, _write = stdio_transport
        self._session = await self._exit_stack.enter_async_context(ClientSession(_stdio, _write))
        await self._session.initialize()

    def session(self) -> ClientSession:
        if self._session is None:
            raise ConnectionError(f"Client session for {self._name} not initialized. Call connect first.")
        return self._session

    @property
    def name(self) -> str:
        return self._name

    async def list_tools(self) -> list[types.Tool]:
        result = await self.session().list_tools()
        return result.tools

    async def call_tool(self, tool_name: str, tool_input: dict) -> types.CallToolResult | None:
        result = await self.session().call_tool(tool_name, tool_input)
        return result

    async def cleanup(self):
        try:
            if self._exit_stack:
                await self._exit_stack.aclose()
        except Exception as e:
            print(f"Warning during {self._name} cleanup: {e}")
        finally:
            self._session = None

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.cleanup()

# ============================================================================
# INTERACTIVE MODE WITH TOOL-BASED APPROACH
# ===========================================================================