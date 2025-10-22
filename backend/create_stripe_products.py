"""
Script to create Stripe products and prices for KlerAI
Run this once to set up your Stripe products, then update stripe_service.py with the Price IDs
"""
import os
import stripe
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

def create_products():
    print("Creating Stripe products and prices...\n")

    # Create Pro Plan
    print("1. Creating Pro Plan ($19/month)...")
    pro_product = stripe.Product.create(
        name="Pro Plan",
        description="2,500 credits per month with priority support and advanced features"
    )
    pro_price = stripe.Price.create(
        product=pro_product.id,
        unit_amount=1900,  # $19.00 in cents
        currency="usd",
        recurring={"interval": "month"}
    )
    print(f"   Product ID: {pro_product.id}")
    print(f"   Price ID: {pro_price.id}\n")

    # Create Business Plan
    print("2. Creating Business Plan ($39/month)...")
    business_product = stripe.Product.create(
        name="Business Plan",
        description="6,000 credits per month with priority support and all Pro features"
    )
    business_price = stripe.Price.create(
        product=business_product.id,
        unit_amount=3900,  # $39.00 in cents
        currency="usd",
        recurring={"interval": "month"}
    )
    print(f"   Product ID: {business_product.id}")
    print(f"   Price ID: {business_price.id}\n")

    # Create Small Credit Pack
    print("3. Creating Small Credit Pack (500 credits for $5)...")
    small_product = stripe.Product.create(
        name="500 Credits",
        description="One-time purchase of 500 credits"
    )
    small_price = stripe.Price.create(
        product=small_product.id,
        unit_amount=500,  # $5.00 in cents
        currency="usd"
    )
    print(f"   Product ID: {small_product.id}")
    print(f"   Price ID: {small_price.id}\n")

    # Create Medium Credit Pack
    print("4. Creating Medium Credit Pack (2,000 credits for $15)...")
    medium_product = stripe.Product.create(
        name="2,000 Credits",
        description="One-time purchase of 2,000 credits"
    )
    medium_price = stripe.Price.create(
        product=medium_product.id,
        unit_amount=1500,  # $15.00 in cents
        currency="usd"
    )
    print(f"   Product ID: {medium_product.id}")
    print(f"   Price ID: {medium_price.id}\n")

    # Create Large Credit Pack
    print("5. Creating Large Credit Pack (5,000 credits for $35)...")
    large_product = stripe.Product.create(
        name="5,000 Credits",
        description="One-time purchase of 5,000 credits"
    )
    large_price = stripe.Price.create(
        product=large_product.id,
        unit_amount=3500,  # $35.00 in cents
        currency="usd"
    )
    print(f"   Product ID: {large_product.id}")
    print(f"   Price ID: {large_price.id}\n")

    # Print summary
    print("=" * 60)
    print("SUMMARY - Copy these Price IDs to stripe_service.py:")
    print("=" * 60)
    print(f"\nPro Plan: {pro_price.id}")
    print(f"Business Plan: {business_price.id}")
    print(f"Small Pack: {small_price.id}")
    print(f"Medium Pack: {medium_price.id}")
    print(f"Large Pack: {large_price.id}")
    print("\n" + "=" * 60)

    return {
        "pro": pro_price.id,
        "business": business_price.id,
        "small": small_price.id,
        "medium": medium_price.id,
        "large": large_price.id
    }

if __name__ == "__main__":
    try:
        price_ids = create_products()
        print("\n✓ Successfully created all products and prices!")
        print("  These are TEST MODE products (sk_test_ key)")
        print("  View them at: https://dashboard.stripe.com/test/products")
    except Exception as e:
        print(f"\n✗ Error: {e}")
        print("  Make sure your STRIPE_SECRET_KEY is set in .env")
