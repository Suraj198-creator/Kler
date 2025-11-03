-- Update free tier users from 100 to 50 daily credits
-- Run this in your Supabase SQL editor

-- Update monthly_credit_allowance for free users
UPDATE public.profiles
SET monthly_credit_allowance = 50
WHERE plan_type = 'free'
  AND is_master = false
  AND monthly_credit_allowance = 100;

-- Also update their current balance if it's at 100 (so they get adjusted immediately)
UPDATE public.profiles
SET credit_balance = 50
WHERE plan_type = 'free'
  AND is_master = false
  AND credit_balance = 100;
  

-- Verify the changes
SELECT
  plan_type,
  COUNT(*) as user_count,
  AVG(credit_balance) as avg_balance,
  AVG(monthly_credit_allowance) as avg_allowance
FROM public.profiles
WHERE is_master = false
GROUP BY plan_type;
