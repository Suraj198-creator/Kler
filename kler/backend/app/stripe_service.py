"""
Stripe payment processing service for subscription management
"""
import os
import stripe
from typing import Dict, Optional
from supabase import create_client, Client

# Initialize Stripe
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

# Initialize Supabase
supabase: Client = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

# Plan pricing configuration
# TODO: Replace price_id values with actual Stripe Price IDs from your dashboard
# Get them from: https://dashboard.stripe.com/test/products
PLAN_PRICES = {
    "pro": {
        "price_id": "price_1SKgDnB4otWdZHUzX9QVxHNg",  # ⚠️ TODO: Replace with actual Price ID
        "amount": 19000,  # $19/month
        "currency": "usd",
        "interval": "month",
        "monthly_credits": 1000
    },
    "business": {
        "price_id": "price_1SKgERB4otWdZHUzjNRKZ6fp",  # ⚠️ TODO: Replace with actual Price ID
        "amount": 3900,  # $39/month
        "currency": "usd",
        "interval": "month",
        "monthly_credits": 5000
    }
}

# Credit pack pricing (one-time purchases)
# TODO: Replace price_id values with actual Stripe Price IDs from your dashboard
CREDIT_PACKS = {
    "small": {
        "price_id": "price_1SKhH3B4otWdZHUzVjMZm4g0",  # ⚠️ TODO: Replace with actual Price ID
        "amount": 500,  # $5
        "currency": "usd",
        "credits": 500
    },
    "medium": {
        "price_id": "price_1SKhHnB4otWdZHUzP1DH0jVN",  # ⚠️ TODO: Replace with actual Price ID
        "amount": 1500,  # $15
        "currency": "usd",
        "credits": 2000
    },
    "large": {
        "price_id": "price_1SKhIHB4otWdZHUzH9X0lKUt",  # ⚠️ TODO: Replace with actual Price ID
        "amount": 3500,  # $35
        "currency": "usd",
        "credits": 5000
    }
}


async def create_checkout_session(user_id: str, plan: str, success_url: str, cancel_url: str) -> Dict:
    """
    Create a Stripe Checkout session for subscription purchase

    Args:
        user_id: User's database ID
        plan: Plan type ('starter' or 'pro')
        success_url: URL to redirect after successful payment
        cancel_url: URL to redirect if payment is canceled

    Returns:
        Dict with checkout session URL and session ID
    """
    try:
        # Get or create Stripe customer
        customer_id = await get_or_create_customer(user_id)

        if plan not in PLAN_PRICES:
            raise ValueError(f"Invalid plan: {plan}")

        plan_config = PLAN_PRICES[plan]

        # Create Checkout Session
        session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=['card'],
            line_items=[{
                'price': plan_config["price_id"],
                'quantity': 1,
            }],
            mode='subscription',
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                'user_id': user_id,
                'plan': plan
            }
        )

        return {
            "session_id": session.id,
            "url": session.url
        }

    except Exception as e:
        print(f"Error creating checkout session: {e}")
        raise


async def get_or_create_customer(user_id: str) -> str:
    """
    Get existing Stripe customer ID or create a new customer

    Args:
        user_id: User's database ID

    Returns:
        Stripe customer ID
    """
    # Check if user already has a Stripe customer ID
    response = supabase.table("profiles").select("stripe_customer_id, full_name").eq("id", user_id).single().execute()

    if response.data and response.data.get("stripe_customer_id"):
        return response.data["stripe_customer_id"]

    # Create new Stripe customer
    customer = stripe.Customer.create(
        metadata={'user_id': user_id},
        name=response.data.get("full_name") if response.data else None
    )

    # Save customer ID to database
    supabase.table("profiles").update({
        "stripe_customer_id": customer.id
    }).eq("id", user_id).execute()

    return customer.id


async def handle_webhook_event(payload: bytes, signature: str) -> Dict:
    """
    Handle Stripe webhook events

    Args:
        payload: Raw request body
        signature: Stripe signature header

    Returns:
        Dict with status and message
    """
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")

    try:
        event = stripe.Webhook.construct_event(
            payload, signature, webhook_secret
        )
    except ValueError as e:
        print(f"Invalid payload: {e}")
        raise
    except stripe.error.SignatureVerificationError as e:
        print(f"Invalid signature: {e}")
        raise

    # Handle the event
    event_type = event['type']
    data = event['data']['object']

    if event_type == 'checkout.session.completed':
        # Check if it's a subscription or credit pack purchase
        if data.get('metadata', {}).get('type') == 'credit_pack':
            await handle_credit_pack_purchase(data)
        else:
            await handle_checkout_completed(data)

    elif event_type == 'customer.subscription.updated':
        await handle_subscription_updated(data)

    elif event_type == 'customer.subscription.deleted':
        await handle_subscription_deleted(data)

    elif event_type == 'invoice.payment_failed':
        await handle_payment_failed(data)

    return {"status": "success", "event_type": event_type}


async def handle_checkout_completed(session):
    """Handle successful checkout for subscription"""
    from app.credit_service import add_credits

    user_id = session['metadata'].get('user_id')
    subscription_id = session.get('subscription')

    if not user_id:
        print("No user_id in checkout session metadata")
        return

    # Get subscription details
    subscription = stripe.Subscription.retrieve(subscription_id)
    plan = session['metadata'].get('plan', 'starter')

    # Get plan configuration
    plan_config = PLAN_PRICES.get(plan, PLAN_PRICES["starter"])
    monthly_credits = plan_config["monthly_credits"]

    # Update user's profile
    supabase.table("profiles").update({
        "stripe_subscription_id": subscription_id,
        "plan_type": plan,
        "subscription_status": subscription.status,
        "current_period_end": subscription.current_period_end,
        "monthly_credit_allowance": monthly_credits,
        "last_credit_reset": "CURRENT_DATE"
    }).eq("id", user_id).execute()

    # Grant initial monthly credits
    await add_credits(
        user_id=user_id,
        amount=monthly_credits,
        transaction_type='subscription_renewal',
        description=f'Initial {plan} plan subscription ({monthly_credits} credits)',
        metadata={'subscription_id': subscription_id, 'plan': plan}
    )

    print(f"User {user_id} subscribed to {plan} plan with {monthly_credits} credits")


async def handle_subscription_updated(subscription):
    """Handle subscription updates"""
    customer_id = subscription['customer']

    # Find user by customer ID
    response = supabase.table("profiles").select("id").eq("stripe_customer_id", customer_id).single().execute()

    if not response.data:
        print(f"No user found for customer {customer_id}")
        return

    user_id = response.data['id']

    # Update subscription status
    supabase.table("profiles").update({
        "subscription_status": subscription.status,
        "current_period_end": subscription.current_period_end
    }).eq("id", user_id).execute()

    print(f"Updated subscription for user {user_id}: {subscription.status}")


async def handle_subscription_deleted(subscription):
    """Handle subscription cancellation"""
    customer_id = subscription['customer']

    # Find user by customer ID
    response = supabase.table("profiles").select("id").eq("stripe_customer_id", customer_id).single().execute()

    if not response.data:
        print(f"No user found for customer {customer_id}")
        return

    user_id = response.data['id']

    # Downgrade to free plan
    supabase.table("profiles").update({
        "plan_type": "free",
        "subscription_status": "canceled",
        "stripe_subscription_id": None,
        "queries_today": 0
    }).eq("id", user_id).execute()

    print(f"Subscription canceled for user {user_id}, downgraded to free plan")


async def handle_payment_failed(invoice):
    """Handle failed payment"""
    customer_id = invoice['customer']

    # Find user by customer ID
    response = supabase.table("profiles").select("id").eq("stripe_customer_id", customer_id).single().execute()

    if not response.data:
        print(f"No user found for customer {customer_id}")
        return

    user_id = response.data['id']

    # Update subscription status
    supabase.table("profiles").update({
        "subscription_status": "past_due"
    }).eq("id", user_id).execute()

    print(f"Payment failed for user {user_id}")


async def cancel_subscription(user_id: str) -> Dict:
    """
    Cancel a user's subscription

    Args:
        user_id: User's database ID

    Returns:
        Dict with cancellation status
    """
    # Get user's subscription ID
    response = supabase.table("profiles").select("stripe_subscription_id").eq("id", user_id).single().execute()

    if not response.data or not response.data.get("stripe_subscription_id"):
        raise ValueError("No active subscription found")

    subscription_id = response.data["stripe_subscription_id"]

    # Cancel the subscription at period end
    stripe.Subscription.modify(
        subscription_id,
        cancel_at_period_end=True
    )

    return {
        "status": "success",
        "message": "Subscription will be canceled at the end of the billing period"
    }


async def create_customer_portal_session(user_id: str, return_url: str) -> Dict:
    """
    Create a Stripe Customer Portal session for managing subscription

    Args:
        user_id: User's database ID
        return_url: URL to return to after portal session

    Returns:
        Dict with portal session URL
    """
    customer_id = await get_or_create_customer(user_id)

    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )

    return {"url": session.url}


async def create_credit_pack_checkout(user_id: str, pack_size: str, success_url: str, cancel_url: str) -> Dict:
    """
    Create a Stripe Checkout session for one-time credit pack purchase

    Args:
        user_id: User's database ID
        pack_size: Size of credit pack ('small', 'medium', 'large')
        success_url: URL to redirect after successful payment
        cancel_url: URL to redirect if payment is canceled

    Returns:
        Dict with checkout session URL and session ID
    """
    try:
        # Get or create Stripe customer
        customer_id = await get_or_create_customer(user_id)

        if pack_size not in CREDIT_PACKS:
            raise ValueError(f"Invalid credit pack: {pack_size}")

        pack_config = CREDIT_PACKS[pack_size]

        # Create Checkout Session for one-time payment
        session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=['card'],
            line_items=[{
                'price': pack_config["price_id"],
                'quantity': 1,
            }],
            mode='payment',  # One-time payment
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                'user_id': user_id,
                'pack_size': pack_size,
                'credits': pack_config["credits"],
                'type': 'credit_pack'
            }
        )

        return {
            "session_id": session.id,
            "url": session.url
        }

    except Exception as e:
        print(f"Error creating credit pack checkout session: {e}")
        raise


async def handle_credit_pack_purchase(session):
    """Handle successful credit pack purchase"""
    from app.credit_service import add_credits

    user_id = session['metadata'].get('user_id')
    credits = int(session['metadata'].get('credits', 0))
    pack_size = session['metadata'].get('pack_size', 'unknown')

    if not user_id or credits == 0:
        print("Missing user_id or credits in checkout session metadata")
        return

    # Add credits to user's account
    new_balance = await add_credits(
        user_id=user_id,
        amount=credits,
        transaction_type='purchase',
        description=f'Purchased {pack_size} credit pack ({credits} credits)',
        metadata={'session_id': session['id'], 'pack_size': pack_size}
    )

    print(f"Added {credits} credits to user {user_id}. New balance: {new_balance}")
