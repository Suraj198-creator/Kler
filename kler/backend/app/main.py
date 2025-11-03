# Update main.py to return summary along with response

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict, List, Any
import os
import json
import requests
from dotenv import load_dotenv
from contextlib import asynccontextmanager
import anthropic

from app.chat_service import ChatService
from app import credit_service, stripe_service

load_dotenv()

# Global service instances
chat_service: Optional[ChatService] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    global chat_service

    # Startup
    print("Initializing services...")

    # Initialize chat service
    chat_service = ChatService()
    await chat_service.initialize()
    print("Chat service ready!")

    yield

    # Shutdown
    print("Shutting down services...")
    if chat_service:
        await chat_service.cleanup()
    print("Shutdown complete")


app = FastAPI(title="Kler API", version="1.0.0", lifespan=lifespan)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://your-production-domain.com"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic Models
class ChatRequest(BaseModel):
    message: str
    user_id: str
    conversation_id: Optional[str] = None
    doc_context: Optional[str] = None  # Optional pre-fetched documentation content


class ChatResponse(BaseModel):
    response: str
    summary: str  # ADDED: Summary of the response
    conversation_id: str
    message_id: str  # ADDED: Backend message ID (e.g., "q1-r")
    tokens_used: int = 0


class LoadConversationRequest(BaseModel):
    user_id: str
    conversation_id: str
    messages: List[Dict[str, Any]]  # Messages from database


class LoadConversationResponse(BaseModel):
    success: bool
    message: str
    messages_loaded: int


# Health Check
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "kler-api",
        "version": "1.0.0",
        "chat_service_ready": chat_service is not None
    }


# Chat Endpoint
@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Process a chat message and return AI response with summary
    Note: This is a non-streaming endpoint. For production use, prefer /api/chat/stream
    """
    if chat_service is None:
        raise HTTPException(status_code=503, detail="Chat service not initialized")

    try:
        # Check credits before processing
        balance_info = await credit_service.check_credits(request.user_id)

        # Estimate base cost (will be refined after execution)
        estimated_cost = 5  # Base cost

        # If user has insufficient credits and not a master user, reject
        if balance_info['balance'] < estimated_cost and not balance_info.get('is_master', False):
            plan = balance_info.get('plan', 'free')

            if plan == 'free':
                detail = f"Insufficient credits. You've used your daily credits (50/day). Credits reset tomorrow, or upgrade to Pro ($19/month for 150 credits/day, max 3,000/month) or buy credit packs (starting at $20 for 500 credits)."
            else:
                detail = f"Insufficient credits. You need at least {estimated_cost} credits. Current balance: {balance_info['balance']}. Please purchase a credit pack or upgrade your plan."

            raise HTTPException(
                status_code=402,  # Payment Required
                detail=detail
            )

        # Get user history to access summary
        history = chat_service._get_user_history(request.user_id)

        # Process message (returns full response)
        response_text = await chat_service.process_message(
            message=request.message,
            user_id=request.user_id,
            conversation_id=request.conversation_id
        )

        # Get the summary from the history
        # The last item in summarized history should be the response summary
        last_summary_item = history["summarized"][-1] if history["summarized"] else None
        response_summary = last_summary_item.get("content", "") if last_summary_item else ""

        # Get message ID from history
        last_full_item = history["full"][-1] if history["full"] else None
        message_id = last_full_item.get("id", "") if last_full_item else ""

        # Use provided conversation_id or the one from service
        conv_id = request.conversation_id or chat_service.get_conversation_id(request.user_id)

        # For non-streaming endpoint, we can't track tools precisely
        # Use base cost for now (streaming endpoint has accurate tracking)
        cost = estimated_cost

        # Deduct credits
        allowed, new_balance, credits_needed = await credit_service.check_and_deduct_credits(
            user_id=request.user_id,
            cost=cost,
            conversation_id=conv_id,
            description=f"Query execution ({cost} credits)",
            metadata={"message_id": message_id}
        )

        return ChatResponse(
            response=response_text,
            summary=response_summary,
            conversation_id=conv_id,
            message_id=message_id,
            tokens_used=cost  # Return credits used instead of tokens
        )

    except HTTPException:
        # Re-raise HTTP exceptions (like 402 for insufficient credits)
        raise
    except Exception as e:
        print(f"Error processing chat: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Error processing message: {str(e)}"
        )


@app.post("/api/load_conversation", response_model=LoadConversationResponse)
async def load_conversation(request: LoadConversationRequest):
    """
    Load conversation history from database into backend memory.
    Call this when user clicks on an existing conversation.
    """
    if chat_service is None:
        raise HTTPException(status_code=503, detail="Chat service not initialized")

    try:
        chat_service.load_conversation_from_db(
            user_id=request.user_id,
            conversation_id=request.conversation_id,
            messages=request.messages
        )

        return LoadConversationResponse(
            success=True,
            message=f"Loaded conversation {request.conversation_id}",
            messages_loaded=len(request.messages)
        )

    except Exception as e:
        print(f"Error loading conversation: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Error loading conversation: {str(e)}"
        )


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    Stream chat responses with tool usage updates.
    Returns Server-Sent Events (SSE) stream.
    """
    if chat_service is None:
        raise HTTPException(status_code=503, detail="Chat service not initialized")

    async def event_generator():
        # Track tool usage for credit calculation
        tools_used = {
            "has_documentation": False,
            "has_github_tools": False,
            "tool_count": 0
        }

        try:
            # Check if user has any credits before starting
            balance_info = await credit_service.check_credits(request.user_id)

            # Yield initial credit balance
            yield f"data: {json.dumps({'type': 'credit_info', 'balance': balance_info['balance'], 'plan': balance_info['plan']})}\n\n"

            # Check if user has enough credits (minimum query cost is 5 credits)
            # We check upfront to avoid wasting resources on queries that will fail
            MIN_QUERY_COST = 5
            if balance_info['balance'] < MIN_QUERY_COST and not balance_info.get('is_master', False):
                plan = balance_info.get('plan', 'free')

                if plan == 'free':
                    message = f"You don't have enough credits. Minimum query cost is {MIN_QUERY_COST} credits, but you have {balance_info['balance']} credits. Your credits will reset tomorrow, or upgrade to Pro ($19/month for 150 credits/day, max 3,000/month) or buy credit packs."
                else:
                    message = f"You don't have enough credits. Minimum query cost is {MIN_QUERY_COST} credits, but you have {balance_info['balance']} credits. Please purchase a credit pack or upgrade your plan to continue."

                error_event = {
                    "type": "error",
                    "content": message,
                    "error_code": "INSUFFICIENT_CREDITS",
                    "plan": plan,
                    "balance": balance_info['balance']
                }
                yield f"data: {json.dumps(error_event)}\n\n"
                return

            import time
            async for event in chat_service.process_message_stream(
                message=request.message,
                user_id=request.user_id,
                conversation_id=request.conversation_id,
                doc_context=request.doc_context
            ):
                # DEBUG: Log event received from chat service
                print(f"[SSE MAIN] {time.time():.3f} - Event received from chat_service: {event.get('type')}")

                # Track tool usage for credit calculation
                if event.get("type") == "tool_start":
                    tool_name = event.get("tool_name", "")
                    print(f"[SSE MAIN] Tool started: {tool_name}")

                    if tool_name == "retrieve_documentation":
                        tools_used["has_documentation"] = True
                        tools_used["tool_count"] += 1
                    elif tool_name not in ["retrieve_full_context", "retrieve_documentation"]:
                        # GitHub or other MCP tools
                        tools_used["has_github_tools"] = True
                        tools_used["tool_count"] += 1

                # If this is the done event, calculate and deduct credits
                if event.get("type") == "done":
                    # Calculate actual cost based on tools used
                    cost = credit_service.calculate_query_cost(
                        has_documentation=tools_used["has_documentation"],
                        has_github_tools=tools_used["has_github_tools"],
                        tool_count=tools_used["tool_count"]
                    )

                    # Deduct credits
                    allowed, new_balance, credits_needed = await credit_service.check_and_deduct_credits(
                        user_id=request.user_id,
                        cost=cost,
                        conversation_id=request.conversation_id,
                        description=f"Query execution ({cost} credits)",
                        metadata={
                            "tools_used": tools_used,
                            "message_id": event.get("message_id", "")
                        }
                    )

                    # Check if deduction was successful
                    if not allowed:
                        # User doesn't have enough credits - this shouldn't happen as we check upfront,
                        # but could happen if credits were used in another tab/session
                        plan = balance_info.get('plan', 'free')
                        error_msg = f"Insufficient credits. This query costs {cost} credits, but you only have {new_balance} credits remaining. You need {credits_needed} more credits."

                        if plan == 'free':
                            error_msg += " Your credits will reset tomorrow, or upgrade to Pro for more credits."
                        else:
                            error_msg += " Please purchase a credit pack to continue."

                        error_event = {
                            "type": "error",
                            "content": error_msg,
                            "error_code": "INSUFFICIENT_CREDITS",
                            "plan": plan,
                            "balance": new_balance,
                            "credits_needed": credits_needed,
                            "cost": cost
                        }
                        yield f"data: {json.dumps(error_event)}\n\n"
                        return

                    # Add credit info to done event
                    event["credits_used"] = cost
                    event["credits_remaining"] = new_balance

                # Format as SSE and yield immediately
                sse_data = f"data: {json.dumps(event)}\n\n"
                print(f"[SSE MAIN] {time.time():.3f} - Yielding SSE event: {event.get('type')}")
                yield sse_data

        except anthropic.APIStatusError as e:
            # Handle Anthropic API specific errors
            print(f"Anthropic API error in stream: {e}")
            import traceback
            traceback.print_exc()

            error_type = e.body.get('error', {}).get('type', 'api_error') if hasattr(e, 'body') and e.body else 'api_error'
            error_message = e.body.get('error', {}).get('message', str(e)) if hasattr(e, 'body') and e.body else str(e)

            # Provide user-friendly error messages based on error type
            if error_type == 'overloaded_error':
                user_message = "Anthropic's API is currently experiencing high load. Please try again in a few moments."
            elif error_type == 'rate_limit_error':
                user_message = "Rate limit reached. Please wait a moment before trying again."
            else:
                user_message = f"An error occurred with the AI service: {error_message}"

            error_event = {
                "type": "error",
                "content": user_message,
                "error_code": "API_ERROR",
                "error_type": error_type
            }
            yield f"data: {json.dumps(error_event)}\n\n"

        except Exception as e:
            print(f"Error in stream: {e}")
            import traceback
            traceback.print_exc()
            error_event = {"type": "error", "content": str(e)}
            yield f"data: {json.dumps(error_event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# ============ DOCUMENTATION SEARCH ENDPOINT ============

class SearchDocsResponse(BaseModel):
    results: List[Dict[str, Any]]


@app.get("/api/search-docs", response_model=SearchDocsResponse)
async def search_docs(query: str):
    """
    Search Context7 for documentation.
    Returns list of documentation results with title, snippet, and URL.
    """
    REQUEST_TIMEOUT = 10
    url = "https://context7.com/api/v1/search"
    headers = {"Authorization": f"Bearer {os.getenv('CONTEXT7_API_KEY')}"}

    try:
        response = requests.get(
            url,
            params={"query": query},
            headers=headers,
            timeout=REQUEST_TIMEOUT
        )
        response.raise_for_status()

        data = response.json()

        # Format results for frontend
        results = []
        for item in data.get('results', [])[:10]: 
            it # Limit to 10 results
            results.append({
                "id": item.get('id', ''),
                "title": item.get('title', ''),
                "snippet": item.get('snippet', ''),
                "url": item.get('url', ''),
                "doc_name": item.get('doc_name', ''),
                "content": item.get('content', '')  # Full content for injection
            })

        return SearchDocsResponse(results=results)

    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Documentation search timed out")
    except requests.exceptions.RequestException as e:
        print(f"Error searching docs: {e}")
        raise HTTPException(status_code=500, detail=f"Error searching documentation: {str(e)}")
    except Exception as e:
        print(f"Unexpected error searching docs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ CREDIT ENDPOINTS ============

@app.get("/api/credits/balance")
async def get_credit_balance(user_id: str):
    """Get user's current credit balance and plan info"""
    try:
        balance_info = await credit_service.check_credits(user_id)
        return balance_info
    except Exception as e:
        print(f"Error fetching credit balance: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/credits/history")
async def get_credit_history(user_id: str, limit: int = 50, offset: int = 0):
    """Get user's credit transaction history"""
    try:
        history = await credit_service.get_credit_history(user_id, limit, offset)
        return {"transactions": history}
    except Exception as e:
        print(f"Error fetching credit history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/credits/usage-stats")
async def get_usage_stats(user_id: str):
    """Get user's credit usage statistics"""
    try:
        stats = await credit_service.get_usage_stats(user_id)
        return stats
    except Exception as e:
        print(f"Error fetching usage stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ STRIPE ENDPOINTS ============

class CreateCheckoutRequest(BaseModel):
    user_id: str
    plan: str  # 'starter' or 'pro'
    success_url: str
    cancel_url: str


class CreateCreditPackRequest(BaseModel):
    user_id: str
    pack_size: str  # 'small', 'medium', or 'large'
    success_url: str
    cancel_url: str


class CreatePortalRequest(BaseModel):
    user_id: str
    return_url: str


@app.post("/api/stripe/create-subscription-checkout")
async def create_subscription_checkout(request: CreateCheckoutRequest):
    """Create Stripe checkout session for subscription"""
    try:
        session = await stripe_service.create_checkout_session(
            user_id=request.user_id,
            plan=request.plan,
            success_url=request.success_url,
            cancel_url=request.cancel_url
        )
        return session
    except Exception as e:
        print(f"Error creating subscription checkout: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stripe/create-credit-checkout")
async def create_credit_pack_checkout(request: CreateCreditPackRequest):
    """Create Stripe checkout session for one-time credit pack purchase"""
    try:
        session = await stripe_service.create_credit_pack_checkout(
            user_id=request.user_id,
            pack_size=request.pack_size,
            success_url=request.success_url,
            cancel_url=request.cancel_url
        )
        return session
    except Exception as e:
        print(f"Error creating credit pack checkout: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stripe/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events"""
    try:
        payload = await request.body()
        # Stripe CLI uses lowercase, real Stripe uses Stripe-Signature
        signature = request.headers.get("stripe-signature") or request.headers.get("Stripe-Signature")

        if not signature:
            print(f"Headers received: {dict(request.headers)}")
            raise HTTPException(status_code=400, detail="Missing stripe-signature header")

        result = await stripe_service.handle_webhook_event(payload, signature)
        return result
    except Exception as e:
        print(f"Error handling webhook: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/stripe/portal")
async def create_portal_session(request: CreatePortalRequest):
    """Create Stripe customer portal session"""
    try:
        session = await stripe_service.create_customer_portal_session(
            user_id=request.user_id,
            return_url=request.return_url
        )
        return session
    except Exception as e:
        print(f"Error creating portal session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stripe/cancel-subscription")
async def cancel_subscription(user_id: str):
    """Cancel user's subscription"""
    try:
        result = await stripe_service.cancel_subscription(user_id)
        return result
    except Exception as e:
        print(f"Error canceling subscription: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
