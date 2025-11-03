-- Update Pro tier to new pricing: $19/month for 150 credits/day, max 3,000/month
-- Run this in your Supabase SQL editor

-- Step 1: Add new columns for daily limits and monthly caps
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS daily_credit_allowance INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS monthly_credit_cap INTEGER DEFAULT 0;

-- Step 2: Update Free users to use new column structure
UPDATE public.profiles
SET
  daily_credit_allowance = 50,
  monthly_credit_allowance = 50,
  monthly_credit_cap = 0
WHERE plan_type = 'free'
  AND is_master = false;

-- Step 3: Update Pro users to new 150 credits/day, 3,000/month cap model
UPDATE public.profiles
SET
  credit_balance = 150,
  daily_credit_allowance = 150,
  monthly_credit_allowance = 3000,
  monthly_credit_cap = 3000
WHERE plan_type = 'pro'
  AND is_master = false;

-- Step 4: Migrate Business users to Enterprise (pay-as-you-go)
UPDATE public.profiles
SET
  plan_type = 'enterprise',
  daily_credit_allowance = 0,
  monthly_credit_allowance = 0,
  monthly_credit_cap = 0
WHERE plan_type = 'business'
  AND is_master = false;

-- Step 5: Update master users to have unlimited on new columns
UPDATE public.profiles
SET
  daily_credit_allowance = 999999,
  monthly_credit_cap = 999999
WHERE is_master = true;

-- Verify the changes
SELECT
  plan_type,
  COUNT(*) as user_count,
  AVG(credit_balance) as avg_balance,
  AVG(daily_credit_allowance) as avg_daily,
  AVG(monthly_credit_allowance) as avg_monthly_allowance,
  AVG(monthly_credit_cap) as avg_monthly_cap
FROM public.profiles
WHERE is_master = false
GROUP BY plan_type
ORDER BY plan_type;

