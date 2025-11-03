# Pricing Update Summary

## New Pricing Structure

### Plans

**Free Tier**
- 50 credits/day
- Resets daily
- Access to 1000+ API docs
- Unlimited chat history

**Pro Plan** - $19/month
- 150 credits/day
- Maximum 3,000 credits/month
- No daily limits (can accumulate)
- Priority support
- Email support

**Enterprise (Pay-as-you-go)**
- No subscription
- Buy credit packs as needed:
  - **Starter**: $20 for 500 credits (~$0.040/credit)
  - **Pro Pack**: $50 for 1,500 credits (~$0.033/credit)
  - **Enterprise Pack**: $100 for 3,500 credits (~$0.029/credit)

## Changes Made

### 1. Backend (`stripe_service.py`)
- ✅ Updated Pro plan: $19/month for 150 credits/day, max 3,000/month
- ✅ Removed Business subscription
- ✅ Updated credit packs with new pricing

### 2. Frontend (`pricing.tsx`)
- ✅ Updated landing page with new plans
- ✅ Shows Free (50/day), Pro ($19 - 150/day, 3k/month cap), Enterprise (custom packs)

### 3. Database Migration (`migrate_to_credits.sql`)
- ✅ Added `daily_credit_allowance` and `monthly_credit_cap` columns
- ✅ Updated Pro to 150 credits/day with 3,000/month cap
- ✅ Enterprise set to 0 (pay-as-you-go)
- ✅ Removed Business plan references

### 4. Credit Service (`credit_service.py`)
- ✅ Implemented daily reset logic for Pro users
- ✅ Added monthly cap tracking (checks credits used this month)
- ✅ Pro users get 150 credits/day until they hit 3,000/month cap
- ✅ Logs all renewals and tracks remaining monthly credits

### 5. Error Messages (`main.py`)
- ✅ Updated all credit amount references
- ✅ New messaging promotes Pro at $19 (150/day, 3k/month) and credit packs

### 6. SQL Update Scripts
- ✅ `update_free_tier_to_50_credits.sql` - Updates free users to 50 credits
- ✅ `update_pro_to_200_credits.sql` - Migrates Pro users to 150/day, 3k/month cap and Business → Enterprise

## Action Items

### In Stripe Dashboard

You need to create new Stripe products and update the price IDs in `stripe_service.py`:

1. **Pro Subscription** ($19/month)
   - Create recurring price: $19/month
   - Update `PLAN_PRICES["pro"]["price_id"]`

2. **Credit Packs** (one-time purchases)
   - Starter Pack: $20 (500 credits)
   - Pro Pack: $50 (1,500 credits)
   - Enterprise Pack: $100 (3,500 credits)
   - Update `CREDIT_PACKS["starter"]["price_id"]`, etc.

### In Supabase SQL Editor

Run these scripts in order:

1. **First**: `update_free_tier_to_50_credits.sql`
   - Updates free users from 100 → 50 credits/day

2. **Second**: `update_pro_to_200_credits.sql`
   - Adds new columns (`daily_credit_allowance`, `monthly_credit_cap`)
   - Updates Pro users to 150 credits/day, 3,000/month cap
   - Migrates Business users → Enterprise

### Verify Changes

After running SQL scripts, check:
```sql
SELECT
  plan_type,
  COUNT(*) as users,
  AVG(credit_balance) as avg_balance,
  AVG(daily_credit_allowance) as avg_daily,
  AVG(monthly_credit_cap) as avg_monthly_cap
FROM public.profiles
WHERE is_master = false
GROUP BY plan_type;
```

Expected results:
- **free**: avg_daily = 50, avg_monthly_cap = 0
- **pro**: avg_daily = 150, avg_monthly_cap = 3000
- **enterprise**: avg_daily = 0, avg_monthly_cap = 0

## Pricing Economics

**Your Cost**: ~$0.004/credit (£0.004)
**Selling Price**: $0.029 - $0.040/credit (7-10x markup)

### Pro Plan Analysis

**Scenario 1: Light User (50 credits/day average)**
- Usage: 1,500 credits/month
- Cost to you: £6/month
- Revenue: $19/month (~£15)
- Profit: ~£9/month (2.5x)

**Scenario 2: Medium User (100 credits/day average)**
- Usage: 3,000 credits/month (hits cap)
- Cost to you: £12/month
- Revenue: $19/month (~£15)
- Profit: ~£3/month (1.25x)

**Scenario 3: Heavy User (maxes out daily)**
- Usage: 3,000 credits/month (hits cap around day 20)
- Cost to you: £12/month
- Revenue: $19/month (~£15)
- Profit: ~£3/month (1.25x)

**Key Insight**: Even heavy users who max out every day can only use 3,000 credits/month, capping your cost at £12. At $19/month, you're profitable on all user types.

### Credit Pack Economics

**Examples**:
- Starter ($20/500): Cost £2, profit £14 (10x markup)
- Pro Pack ($50/1,500): Cost £6, profit £38 (8x markup)
- Enterprise ($100/3,500): Cost £14, profit £76 (7x markup)

## How Pro Plan Works

### Daily Reset Logic

1. **Every day**, Pro users get 150 credits added to their balance
2. **But** they can only get up to 3,000 credits total per month
3. Credits accumulate (no daily limit on usage)
4. Once they hit 3,000 credits used this month, no more daily credits until next month

### Example Usage Pattern

**Month starts**:
- Day 1: Gets 150 credits, uses 50 → Balance: 100
- Day 2: Gets 150 credits (total given: 300) → Balance: 250, uses 100 → Balance: 150
- Day 3: Gets 150 credits (total given: 450) → Balance: 300
- ...continues...
- Day 20: Has used 3,000 credits total this month
- Day 21-30: No more credits added (monthly cap reached)
- Next month Day 1: Counter resets, gets 150 credits again

## Migration Plan for Existing Users

1. **Free Users**: Automatically adjusted to 50/day on next login (daily reset logic)
2. **Pro Users**:
   - Get 150 credits immediately
   - Start getting 150 credits/day
   - Monthly cap of 3,000 credits applies
3. **Business Users**: Converted to Enterprise, keep current balance, buy packs going forward

## Notes

- Pro users have `daily_credit_allowance = 150` (refreshes daily)
- Pro users have `monthly_credit_cap = 3000` (hard limit per month)
- Enterprise users have `monthly_credit_allowance = 0` (no auto-renewal)
- Free users have `monthly_credit_cap = 0` (no monthly cap, just daily reset)
- All plans except Free have no daily usage limits (only balance matters)
- The system tracks credits used this month to enforce the 3,000 cap

## Technical Implementation

### Database Schema Changes

New columns added to `profiles` table:
```sql
daily_credit_allowance INTEGER    -- How many credits to add each day
monthly_credit_cap INTEGER         -- Maximum credits per month (0 = no cap)
```

### Credit Reset Logic

The `check_credits()` function now:
1. Checks if last reset was before today
2. For Pro users:
   - Queries `credit_transactions` to count credits used this month
   - Calculates remaining monthly allowance
   - Adds min(daily_allowance, remaining_monthly) credits
3. For Free users:
   - Simple reset to 50 credits each day
4. Logs the renewal transaction

### Monthly Tracking

Credits used per month are calculated by:
```python
first_day_of_month = date.today().replace(day=1)
credits_used_this_month = sum(
    abs(transaction.amount)
    for transaction in transactions
    where transaction.type == 'debit'
    and transaction.created_at >= first_day_of_month
)
```
