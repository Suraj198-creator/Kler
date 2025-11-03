-- Query Usage Tracking Table
CREATE TABLE IF NOT EXISTS query_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id UUID,
  query_date DATE NOT NULL DEFAULT CURRENT_DATE,
  query_count INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, query_date)
);

-- Add Stripe fields to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_status TEXT CHECK (subscription_status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete', 'incomplete_expired', 'unpaid')) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS queries_today INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_query_reset DATE DEFAULT CURRENT_DATE;

-- Function to get daily query limit based on plan
CREATE OR REPLACE FUNCTION get_query_limit(plan TEXT, is_master_user BOOLEAN)
RETURNS INTEGER AS $$
BEGIN
  IF is_master_user THEN
    RETURN 999999; -- Unlimited for master users
  END IF;

  CASE plan
    WHEN 'free' THEN RETURN 3;
    WHEN 'starter' THEN RETURN 30;
    WHEN 'pro' THEN RETURN 100;
    WHEN 'enterprise' THEN RETURN 999999;
    ELSE RETURN 3;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to check and increment query count
CREATE OR REPLACE FUNCTION check_and_increment_query(p_user_id UUID)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER, limit_value INTEGER) AS $$
DECLARE
  v_plan TEXT;
  v_is_master BOOLEAN;
  v_queries_today INTEGER;
  v_last_reset DATE;
  v_limit INTEGER;
BEGIN
  -- Get user's plan and query info
  SELECT plan_type, is_master, queries_today, last_query_reset
  INTO v_plan, v_is_master, v_queries_today, v_last_reset
  FROM profiles
  WHERE id = p_user_id;

  -- Get query limit for this plan
  v_limit := get_query_limit(v_plan, v_is_master);

  -- Reset counter if it's a new day
  IF v_last_reset < CURRENT_DATE THEN
    UPDATE profiles
    SET queries_today = 0, last_query_reset = CURRENT_DATE
    WHERE id = p_user_id;
    v_queries_today := 0;
  END IF;

  -- Check if user has queries remaining
  IF v_queries_today >= v_limit THEN
    RETURN QUERY SELECT FALSE, 0::INTEGER, v_limit;
    RETURN;
  END IF;

  -- Increment query count
  UPDATE profiles
  SET queries_today = queries_today + 1
  WHERE id = p_user_id;

  RETURN QUERY SELECT TRUE, (v_limit - v_queries_today - 1)::INTEGER, v_limit;
END;
$$ LANGUAGE plpgsql;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_query_usage_user_date ON query_usage(user_id, query_date);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer ON profiles(stripe_customer_id);

-- Add RLS policies
ALTER TABLE query_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own query usage"
  ON query_usage FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert query usage"
  ON query_usage FOR INSERT
  WITH CHECK (true);
