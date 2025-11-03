-- UPDATE SCRIPT: Update existing credit system to new Pro/Business pricing
-- Run this in your Supabase SQL Editor
-- This updates the existing schema without dropping tables

-- Step 1: Update existing users to new pricing structure
UPDATE public.profiles
SET
  credit_balance = CASE
    WHEN is_master THEN 999999
    WHEN plan_type = 'free' THEN 100
    WHEN plan_type = 'pro' THEN 2500
    WHEN plan_type = 'business' THEN 6000
    WHEN plan_type = 'enterprise' THEN 999999
    ELSE 100
  END,
  monthly_credit_allowance = CASE
    WHEN is_master THEN 999999
    WHEN plan_type = 'free' THEN 100  -- Free users get 100 credits/day
    WHEN plan_type = 'pro' THEN 2500  -- Pro: $19/month → 2,500 credits
    WHEN plan_type = 'business' THEN 6000  -- Business: $39/month → 6,000 credits
    WHEN plan_type = 'enterprise' THEN 999999
    ELSE 100
  END;

-- Step 2: Create or replace function to get credit allowance based on plan
CREATE OR REPLACE FUNCTION get_monthly_credits(plan TEXT, is_master_user BOOLEAN)
RETURNS INTEGER AS $$
BEGIN
  IF is_master_user THEN
    RETURN 999999; -- Unlimited for master users
  END IF;

  CASE plan
    WHEN 'free' THEN RETURN 100;  -- Free: 100 credits/day
    WHEN 'pro' THEN RETURN 2500;  -- Pro: $19/month → 2,500 credits
    WHEN 'business' THEN RETURN 6000;  -- Business: $39/month → 6,000 credits
    WHEN 'enterprise' THEN RETURN 999999;
    ELSE RETURN 100;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create or replace function to calculate credit cost based on tools used
CREATE OR REPLACE FUNCTION calculate_query_cost(
  has_documentation BOOLEAN DEFAULT FALSE,
  has_github_tools BOOLEAN DEFAULT FALSE,
  tool_count INTEGER DEFAULT 0
)
RETURNS INTEGER AS $$
DECLARE
  base_cost INTEGER := 5;
  total_cost INTEGER := base_cost;
BEGIN
  -- Add documentation retrieval cost
  IF has_documentation THEN
    total_cost := total_cost + 5;
  END IF;

  -- Add GitHub MCP tools cost
  IF has_github_tools THEN
    total_cost := total_cost + 10;
  END IF;

  -- Add cost for additional tools
  IF tool_count > 1 THEN
    total_cost := total_cost + ((tool_count - 1) * 3);
  END IF;

  RETURN total_cost;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create or replace function to check and deduct credits
CREATE OR REPLACE FUNCTION check_and_deduct_credits(
  p_user_id UUID,
  p_cost INTEGER,
  p_conversation_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT 'Query execution',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(allowed BOOLEAN, new_balance INTEGER, credits_needed INTEGER) AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Get current credit balance
  SELECT credit_balance INTO v_current_balance
  FROM profiles
  WHERE id = p_user_id;

  -- Check if user has enough credits
  IF v_current_balance < p_cost THEN
    RETURN QUERY SELECT FALSE, v_current_balance, (p_cost - v_current_balance);
    RETURN;
  END IF;

  -- Deduct credits
  v_new_balance := v_current_balance - p_cost;

  UPDATE profiles
  SET credit_balance = v_new_balance
  WHERE id = p_user_id;

  -- Log the transaction
  INSERT INTO credit_transactions (user_id, conversation_id, transaction_type, amount, balance_after, description, metadata)
  VALUES (p_user_id, p_conversation_id, 'debit', -p_cost, v_new_balance, p_description, p_metadata);

  RETURN QUERY SELECT TRUE, v_new_balance, 0::INTEGER;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create or replace function to add credits
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_transaction_type TEXT DEFAULT 'purchase',
  p_description TEXT DEFAULT 'Credit purchase',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Get current balance
  SELECT credit_balance INTO v_current_balance
  FROM profiles
  WHERE id = p_user_id;

  -- Add credits
  v_new_balance := v_current_balance + p_amount;

  UPDATE profiles
  SET credit_balance = v_new_balance
  WHERE id = p_user_id;

  -- Log the transaction
  INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, description, metadata)
  VALUES (p_user_id, p_transaction_type, p_amount, v_new_balance, p_description, p_metadata);

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Create or replace function to reset credits (daily for free, monthly for paid)
CREATE OR REPLACE FUNCTION reset_daily_credits()
RETURNS void AS $$
BEGIN
  -- Reset credits for FREE users daily
  UPDATE profiles
  SET
    credit_balance = monthly_credit_allowance,  -- Reset to 100 credits
    last_credit_reset = CURRENT_DATE
  WHERE
    plan_type = 'free'
    AND last_credit_reset < CURRENT_DATE;

  -- Log daily renewal transactions for free users
  INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, description)
  SELECT
    id,
    'subscription_renewal',
    monthly_credit_allowance,
    credit_balance,
    'Daily credit renewal for free plan (100 credits)'
  FROM profiles
  WHERE
    plan_type = 'free'
    AND last_credit_reset = CURRENT_DATE;

  -- Reset credits for PAID users whose subscription period has renewed
  UPDATE profiles
  SET
    credit_balance = credit_balance + monthly_credit_allowance,
    last_credit_reset = CURRENT_DATE
  WHERE
    subscription_status = 'active'
    AND plan_type IN ('pro', 'business', 'enterprise')
    AND last_credit_reset < CURRENT_DATE
    AND current_period_end IS NOT NULL
    AND current_period_end <= NOW();

  -- Log monthly renewal transactions for paid users
  INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, description)
  SELECT
    id,
    'subscription_renewal',
    monthly_credit_allowance,
    credit_balance,
    'Monthly credit renewal for ' || plan_type || ' plan'
  FROM profiles
  WHERE
    subscription_status = 'active'
    AND plan_type IN ('pro', 'business', 'enterprise')
    AND last_credit_reset = CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(transaction_type);

-- Step 8: Enable Row Level Security if not already enabled
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- Step 9: Drop existing policies if they exist and recreate
DROP POLICY IF EXISTS "Users can view their own credit transactions" ON credit_transactions;
DROP POLICY IF EXISTS "System can insert credit transactions" ON credit_transactions;

-- Recreate RLS policies
CREATE POLICY "Users can view their own credit transactions"
  ON credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert credit transactions"
  ON credit_transactions FOR INSERT
  WITH CHECK (true);

-- Step 10: Add initial transaction for users who don't have any
INSERT INTO credit_transactions (user_id, transaction_type, amount, balance_after, description)
SELECT
  id,
  'credit',
  credit_balance,
  credit_balance,
  'Credit balance after pricing update'
FROM profiles
WHERE id NOT IN (SELECT DISTINCT user_id FROM credit_transactions WHERE user_id IS NOT NULL)
  AND credit_balance > 0;

-- Update complete!
-- New pricing structure applied:
-- - Free: 100 credits/day (resets daily)
-- - Pro: $19/month → 2,500 credits
-- - Business: $39/month → 6,000 credits
