-- Migration: Update credit system from monthly to daily credits
-- Date: 2025-01-XX

-- Step 1: Rename the column from monthly_credit_allowance to daily_credit_allowance
ALTER TABLE profiles 
RENAME COLUMN monthly_credit_allowance TO daily_credit_allowance;

-- Step 2: Update existing free users to 50 credits/day (from 100)
UPDATE profiles
SET daily_credit_allowance = 50,
    credit_balance = 50
WHERE plan_type = 'free';

-- Step 3: Update existing pro users to 300 credits/day (from 2500/month)
UPDATE profiles
SET daily_credit_allowance = 300,
    credit_balance = 300
WHERE plan_type = 'pro';

-- Step 4: Update existing business users to 750 credits/day (from 6000/month)
UPDATE profiles
SET daily_credit_allowance = 750,
    credit_balance = 750
WHERE plan_type = 'business';

-- Step 5: Ensure last_credit_reset is set to today for all users
UPDATE profiles
SET last_credit_reset = CURRENT_DATE
WHERE last_credit_reset IS NULL;

-- Verification queries
SELECT 
    plan_type,
    COUNT(*) as user_count,
    AVG(daily_credit_allowance) as avg_allowance,
    AVG(credit_balance) as avg_balance
FROM profiles
GROUP BY plan_type;
