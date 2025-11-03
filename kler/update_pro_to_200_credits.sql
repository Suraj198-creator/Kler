-- Update Pro tier to new pricing: $19/month for 150 credits/day, max 3,000/month
-- Also migrate Business users to Enterprise (pay-as-you-go)
-- Run this in your Supabase SQL editor

-- First, add new columns for daily limits (if they don't exist)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS daily_credit_allowance INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS monthly_credit_cap INTEGER DEFAULT 0;

-- Update Pro users to new 150 credits/day, 3,000/month cap model
UPDATE public.profiles
SET
  credit_balance = 150,
  daily_credit_allowance = 150,
  monthly_credit_allowance = 3000
  monthly_credit_cap = 3000
WHERE plan_type = 'pro'
  AND is_master = false;

-- Migrate Business users to Enterprise (pay-as-you-go)
-- They keep their current balance but future credits come from packs
UPDATE public.profiles
SET
  plan_type = 'enterprise',
  monthly_credit_allowance = 0  -- Pay-as-you-go, no monthly allowance
WHERE plan_type = 'business'
  AND is_master = false;

-- Verify the changes
SELECT
  plan_type,
  COUNT(*) as user_count,
  AVG(credit_balance) as avg_balance,
  AVG(monthly_credit_allowance) as avg_allowance
FROM public.profiles
WHERE is_master = false
GROUP BY plan_type
ORDER BY plan_type;

-- Check specific users if needed
SELECT
  id,
  email,
  plan_type,
  credit_balance,
  monthly_credit_allowance,
  last_credit_reset
FROM public.profiles
WHERE plan_type IN ('pro', 'enterprise')
  AND is_master = false
ORDER BY plan_type, email
LIMIT 20;
