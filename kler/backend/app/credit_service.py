"""
Credit management service for tracking and deducting credits
"""
import os
from typing import Dict, Optional, Tuple
from supabase import create_client, Client

# Initialize Supabase
supabase: Client = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)


def calculate_query_cost(
    has_documentation: bool = False,
    has_github_tools: bool = False,
    tool_count: int = 0
) -> int:
    """
    Calculate the credit cost of a query based on tools used

    Args:
        has_documentation: Whether documentation retrieval was used
        has_github_tools: Whether GitHub MCP tools were used
        tool_count: Total number of tools used

    Returns:
        Total credit cost
    """
    base_cost = 5
    total_cost = base_cost

    # Add documentation retrieval cost
    if has_documentation:
        total_cost += 5

    # Add GitHub MCP tools cost
    if has_github_tools:
        total_cost += 10

    # Add cost for additional tools
    if tool_count > 1:
        total_cost += (tool_count - 1) * 3

    return total_cost


async def check_credits(user_id: str) -> Dict:
    """
    Check user's current credit balance and plan details.
    Also handles daily credit reset for free users and Pro users.

    Args:
        user_id: User's database ID

    Returns:
        Dict with balance, allowance, and plan info
    """
    try:
        response = supabase.table("profiles").select(
            "credit_balance, monthly_credit_allowance, daily_credit_allowance, monthly_credit_cap, plan_type, is_master, last_credit_reset"
        ).eq("id", user_id).single().execute()

        if not response.data:
            raise ValueError(f"User {user_id} not found")

        from datetime import date
        last_reset = response.data.get("last_credit_reset")
        plan_type = response.data["plan_type"]

        # Check if user needs daily reset (Free or Pro users)
        if plan_type in ["free", "pro"] and last_reset and str(last_reset) < str(date.today()):
            daily_allowance = response.data.get("daily_credit_allowance") or response.data["monthly_credit_allowance"]
            monthly_cap = response.data.get("monthly_credit_cap", 0)
            current_balance = response.data["credit_balance"]

            # For Pro users: check if they're within monthly cap
            if plan_type == "pro" and monthly_cap > 0:
                # Calculate how many credits they've used this month
                # Get first day of current month
                from datetime import datetime
                first_day_of_month = date.today().replace(day=1)

                # Get total credits used this month
                usage_response = supabase.table("credit_transactions").select(
                    "amount"
                ).eq("user_id", user_id).eq(
                    "transaction_type", "debit"
                ).gte(
                    "created_at", first_day_of_month.isoformat()
                ).execute()

                credits_used_this_month = sum(abs(t["amount"]) for t in (usage_response.data or []))

                # Calculate how many credits they can get today
                remaining_monthly = monthly_cap - credits_used_this_month
                credits_to_add = min(daily_allowance, remaining_monthly)

                if credits_to_add > 0:
                    new_balance = current_balance + credits_to_add

                    supabase.table("profiles").update({
                        "credit_balance": new_balance,
                        "last_credit_reset": str(date.today())
                    }).eq("id", user_id).execute()

                    # Log the renewal
                    supabase.table("credit_transactions").insert({
                        "user_id": user_id,
                        "transaction_type": "subscription_renewal",
                        "amount": credits_to_add,
                        "balance_after": new_balance,
                        "description": f"Daily credit renewal for {plan_type} plan ({credits_to_add} credits, {remaining_monthly} remaining this month)"
                    }).execute()

                    response.data["credit_balance"] = new_balance
                else:
                    # Monthly cap reached, just update last reset date
                    supabase.table("profiles").update({
                        "last_credit_reset": str(date.today())
                    }).eq("id", user_id).execute()

            else:
                # Free plan: simple daily reset to allowance
                supabase.table("profiles").update({
                    "credit_balance": daily_allowance,
                    "last_credit_reset": str(date.today())
                }).eq("id", user_id).execute()

                # Log the renewal
                supabase.table("credit_transactions").insert({
                    "user_id": user_id,
                    "transaction_type": "subscription_renewal",
                    "amount": daily_allowance,
                    "balance_after": daily_allowance,
                    "description": f"Daily credit renewal for {plan_type} plan ({daily_allowance} credits)"
                }).execute()

                response.data["credit_balance"] = daily_allowance

        return {
            "balance": response.data["credit_balance"],
            "monthly_allowance": response.data["monthly_credit_allowance"],
            "daily_allowance": response.data.get("daily_credit_allowance", 0),
            "monthly_cap": response.data.get("monthly_credit_cap", 0),
            "plan": response.data["plan_type"],
            "is_master": response.data["is_master"]
        }
    except Exception as e:
        print(f"Error checking credits: {e}")
        raise


async def check_and_deduct_credits(
    user_id: str,
    cost: int,
    conversation_id: Optional[str] = None,
    description: str = "Query execution",
    metadata: Optional[Dict] = None
) -> Tuple[bool, int, int]:
    """
    Check if user has enough credits and deduct them

    Args:
        user_id: User's database ID
        cost: Number of credits to deduct
        conversation_id: Optional conversation ID
        description: Description of the transaction
        metadata: Optional metadata (tools used, etc.)

    Returns:
        Tuple of (allowed, new_balance, credits_needed)
        - allowed: Whether the query is allowed
        - new_balance: New credit balance after deduction
        - credits_needed: Credits needed if insufficient (0 if allowed)
    """
    try:
        # Call the database function
        result = supabase.rpc(
            "check_and_deduct_credits",
            {
                "p_user_id": user_id,
                "p_cost": cost,
                "p_conversation_id": conversation_id,
                "p_description": description,
                "p_metadata": metadata or {}
            }
        ).execute()

        if result.data and len(result.data) > 0:
            row = result.data[0]
            return (
                row["allowed"],
                row["new_balance"],
                row["credits_needed"]
            )

        return (False, 0, cost)

    except Exception as e:
        print(f"Error deducting credits: {e}")
        raise


async def add_credits(
    user_id: str,
    amount: int,
    transaction_type: str = "purchase",
    description: str = "Credit purchase",
    metadata: Optional[Dict] = None
) -> int:
    """
    Add credits to user's account

    Args:
        user_id: User's database ID
        amount: Number of credits to add
        transaction_type: Type of transaction (purchase, refund, etc.)
        description: Description of the transaction
        metadata: Optional metadata

    Returns:
        New credit balance
    """
    try:
        result = supabase.rpc(
            "add_credits",
            {
                "p_user_id": user_id,
                "p_amount": amount,
                "p_transaction_type": transaction_type,
                "p_description": description,
                "p_metadata": metadata or {}
            }
        ).execute()

        return result.data if result.data else 0

    except Exception as e:
        print(f"Error adding credits: {e}")
        raise


async def get_credit_history(
    user_id: str,
    limit: int = 50,
    offset: int = 0
) -> list:
    """
    Get user's credit transaction history

    Args:
        user_id: User's database ID
        limit: Number of transactions to return
        offset: Offset for pagination

    Returns:
        List of credit transactions
    """
    try:
        response = supabase.table("credit_transactions").select(
            "*"
        ).eq("user_id", user_id).order(
            "created_at", desc=True
        ).range(offset, offset + limit - 1).execute()

        return response.data or []

    except Exception as e:
        print(f"Error fetching credit history: {e}")
        raise


async def get_usage_stats(user_id: str) -> Dict:
    """
    Get user's credit usage statistics

    Args:
        user_id: User's database ID

    Returns:
        Dict with usage statistics
    """
    try:
        # Get current balance and plan
        balance_info = await check_credits(user_id)

        # Get total credits used this month
        response = supabase.table("credit_transactions").select(
            "amount"
        ).eq("user_id", user_id).eq(
            "transaction_type", "debit"
        ).gte(
            "created_at", "date_trunc('month', now())"
        ).execute()

        total_used = sum(abs(t["amount"]) for t in (response.data or []))

        # Get total credits added this month
        response = supabase.table("credit_transactions").select(
            "amount"
        ).eq("user_id", user_id).in_(
            "transaction_type", ["credit", "purchase", "subscription_renewal"]
        ).gte(
            "created_at", "date_trunc('month', now())"
        ).execute()

        total_added = sum(t["amount"] for t in (response.data or []))

        return {
            "current_balance": balance_info["balance"],
            "monthly_allowance": balance_info["monthly_allowance"],
            "plan": balance_info["plan"],
            "credits_used_this_month": total_used,
            "credits_added_this_month": total_added,
            "usage_percentage": (total_used / balance_info["monthly_allowance"] * 100) if balance_info["monthly_allowance"] > 0 else 0
        }

    except Exception as e:
        print(f"Error fetching usage stats: {e}")
        raise
