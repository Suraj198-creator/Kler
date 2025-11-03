# Stripe Payment & Query Limits Implementation Guide

This guide outlines the complete implementation of Stripe payments and query limits for KlerAI.

## Overview

**Plan Structure:**
- **Free**: 3 queries/day
- **Starter**: $9/month, 30 queries/day
- **Pro**: $29/month, 100 queries/day
- **Enterprise**: Contact for custom (unlimited queries)

## Setup Steps

### 1. Database Migration

Run the SQL migration to add required tables and columns:

```bash
# Apply the migration in Supabase SQL Editor
# File: supabase_migrations.sql
```

This creates:
- `query_usage` table for tracking daily usage
- Stripe-related columns in `profiles` table
- PostgreSQL functions for query limit checking

### 2. Configure Stripe

1. Create a Stripe account at https://dashboard.stripe.com
2. Create products and prices:
   - **Starter Plan**: $9/month recurring
   - **Pro Plan**: $29/month recurring
3. Get your API keys from https://dashboard.stripe.com/apikeys
4. Update `backend/.env` with:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PUBLISHABLE_KEY`
   - `STRIPE_WEBHOOK_SECRET` (after setting up webhooks)
5. Get Supabase service role key from Supabase dashboard
6. Update Stripe Price IDs in `stripe_service.py`:
   ```python
   PLAN_PRICES = {
       "starter": {
           "price_id": "price_XXXXXXXXXXXXX",  # Your actual Stripe Price ID
           ...
       },
       "pro": {
           "price_id": "price_XXXXXXXXXXXXX",  # Your actual Stripe Price ID
           ...
       }
   }
   ```

### 3. Set Up Webhook

1. In Stripe Dashboard, go to Developers > Webhooks
2. Add endpoint: `https://yourdomain.com/api/stripe/webhook`
3. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the webhook signing secret to `.env` as `STRIPE_WEBHOOK_SECRET`

## Backend Implementation

### Files Created/Modified:

1. **backend/app/stripe_service.py** ✅ Created
   - Handles Stripe checkout sessions
   - Manages customer creation
   - Processes webhook events
   - Handles subscription lifecycle

2. **backend/app/query_limits.py** (Need to create)
   - Check query limits before processing
   - Increment usage counter
   - Return remaining queries

3. **backend/app/main.py** (Need to modify)
   - Add Stripe endpoints:
     - `POST /api/stripe/create-checkout-session`
     - `POST /api/stripe/webhook`
     - `POST /api/stripe/create-portal-session`
     - `GET /api/stripe/cancel-subscription`
   - Add query checking endpoints:
     - `GET /api/usage/status`
   - Integrate query limit checking in chat endpoint

4. **backend/requirements.txt** ✅ Updated
   - Added `stripe==11.3.0`
   - Added `supabase==2.10.0`

## Frontend Implementation

### Files to Create/Modify:

1. **src/app/pricing/page.tsx** (Create new)
   - Display plan comparison
   - Stripe checkout buttons
   - Enterprise contact form

2. **src/app/dashboard/billing/page.tsx** (Create new)
   - Current plan display
   - Usage statistics
   - Manage subscription button
   - Cancel subscription option

3. **src/components/dashboard/usage-indicator.tsx** (Create new)
   - Show queries remaining
   - Progress bar
   - Upgrade CTA when limit reached

4. **src/lib/types.ts** (Modify)
   - Add usage tracking types
   - Add Stripe session types

5. **src/lib/api.ts** (Modify)
   - Add Stripe API calls
   - Add usage checking calls

## Testing Checklist

- [ ] Run database migration
- [ ] Configure Stripe test keys
- [ ] Create test products/prices in Stripe
- [ ] Test checkout flow
- [ ] Test webhook reception
- [ ] Test query limit enforcement
- [ ] Test subscription cancellation
- [ ] Test plan upgrades/downgrades
- [ ] Test payment failures

## Production Deployment

1. Replace test Stripe keys with live keys
2. Update webhook endpoint to production URL
3. Set up proper error monitoring
4. Configure email notifications for payment issues
5. Test thoroughly with real payment methods

## Next Steps

Would you like me to:
1. Complete the backend implementation (add remaining endpoints to main.py)?
2. Create the frontend pricing and billing pages?
3. Add the usage indicator component to the dashboard?
4. Set up the Stripe products and provide the Price IDs?

Let me know which part you'd like me to tackle next!
