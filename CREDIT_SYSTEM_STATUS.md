# Credit-Based Payment System - Implementation Status

## ✅ Completed

### 1. Database Migration
- ✅ Migrated from query-based to credit-based system
- ✅ Created `credit_transactions` table
- ✅ Added credit fields to `profiles` table
- ✅ Created PostgreSQL functions:
  - `calculate_query_cost()` - Calculate credits based on tools used
  - `check_and_deduct_credits()` - Validate and deduct credits
  - `add_credits()` - Add credits to user account
  - `reset_monthly_credits()` - Auto-renew monthly credits
  - `get_monthly_credits()` - Get plan allowances

### 2. Backend Services

#### Credit Service (`backend/app/credit_service.py`) ✅
- Check user credit balance
- Deduct credits with validation
- Add credits (purchases/renewals)
- Get credit transaction history
- Calculate usage statistics

#### Stripe Service (`backend/app/stripe_service.py`) ✅
- Subscription checkout (Starter: 1,000 credits/month, Pro: 5,000 credits/month)
- Credit pack purchases (500, 2,000, 5,000 credits)
- Webhook handling for:
  - Subscription sign-ups (grants monthly credits)
  - Credit pack purchases (instant credit addition)
  - Subscription renewals
  - Cancellations
  - Payment failures
- Customer portal integration

### 3. Credit Pricing Structure ✅

**Monthly Subscriptions:**
- Free: 100 credits/month (renewable)
- Starter: $9/month → 1,000 credits/month
- Pro: $29/month → 5,000 credits/month
- Enterprise: Contact for custom

**One-Time Credit Packs:**
- Small: $5 → 500 credits
- Medium: $15 → 2,000 credits
- Large: $35 → 5,000 credits

**Credit Costs Per Query:**
- Base query (no tools): 5 credits
- + Documentation retrieval: +5 credits (10 total)
- + GitHub MCP tools: +10 credits (15 total)
- + Additional tools: +3 credits each

## 🚧 To Do Next

### 4. FastAPI Endpoints (Pending)

Need to add to `backend/app/main.py`:

```python
# Credit endpoints
GET  /api/credits/balance         # Get user's credit balance
GET  /api/credits/history          # Get credit transaction history
GET  /api/credits/usage-stats      # Get usage statistics

# Stripe endpoints
POST /api/stripe/create-subscription-checkout    # Start subscription
POST /api/stripe/create-credit-checkout          # Buy credit pack
POST /api/stripe/webhook                         # Handle Stripe events
POST /api/stripe/portal                          # Manage subscription
POST /api/stripe/cancel                          # Cancel subscription
```

### 5. Chat Integration (Pending)

Modify `/api/chat/stream` endpoint to:
1. Calculate query cost before processing
2. Check if user has sufficient credits
3. Deduct credits after successful completion
4. Return credit balance in response

### 6. Frontend (Pending)

#### Pricing Page (`src/app/pricing/page.tsx`)
- Display subscription plans with credit allowances
- Show credit pack options
- Stripe checkout buttons
- Enterprise contact form

#### Billing Dashboard (`src/app/dashboard/billing/page.tsx`)
- Current plan and credit balance
- Usage statistics and graphs
- Transaction history
- Manage subscription button
- Buy credit packs button

#### Usage Indicator Component
- Show credits remaining
- Progress bar
- Low balance warning
- Quick link to buy credits

## Environment Setup Required

Add to `backend/.env`:
```bash
# Get these from Stripe Dashboard
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Get from Supabase Dashboard
SUPABASE_URL=https://...supabase.co
SUPABASE_KEY=your_service_role_key
```

## Stripe Product Setup

Create in Stripe Dashboard:
1. **Subscription Products:**
   - Starter Plan: $9/month recurring
   - Pro Plan: $29/month recurring

2. **Credit Pack Products:**
   - 500 Credits: $5 one-time
   - 2,000 Credits: $15 one-time
   - 5,000 Credits: $35 one-time

3. Copy Price IDs to `stripe_service.py`

## Testing Checklist

- [ ] Database migration successful
- [ ] Credit deduction works correctly
- [ ] Subscription checkout flow
- [ ] Credit pack purchase flow
- [ ] Webhook events processed
- [ ] Monthly credit renewal
- [ ] Usage stats accurate
- [ ] Insufficient credits handled gracefully

## Next Steps

What would you like me to implement next?
1. Add the API endpoints to FastAPI?
2. Integrate credit checking into the chat endpoint?
3. Create the frontend pricing page?
4. Build the usage dashboard?

Let me know and I'll continue!
