-- Enable RLS on all tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_tokens ENABLE ROW LEVEL SECURITY;

-- 1. Organizations Policies
CREATE POLICY "Users can view their own organizations"
ON public.organizations FOR SELECT
USING (auth.uid() = owner_id);

CREATE POLICY "Users can create their own organizations"
ON public.organizations FOR INSERT
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own organizations"
ON public.organizations FOR UPDATE
USING (auth.uid() = owner_id);

-- 2. Subscription Tiers Policies (Public Read)
CREATE POLICY "Subscription tiers are viewable by everyone"
ON public.subscription_tiers FOR SELECT
USING (true);

-- 3. Subscriptions Policies
CREATE POLICY "Users can view their own subscriptions"
ON public.subscriptions FOR SELECT
USING (auth.uid() = user_id);

-- 4. Usage Tracking Policies
CREATE POLICY "Users can view their own usage"
ON public.usage_tracking FOR SELECT
USING (auth.uid() = user_id);

-- 5. User Profiles Policies
CREATE POLICY "Users can view their own profile"
ON public.user_profiles FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON public.user_profiles FOR UPDATE
USING (auth.uid() = id);

-- 6. Xero Tokens Policies
CREATE POLICY "Users can view their own xero tokens"
ON public.xero_tokens FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own xero tokens"
ON public.xero_tokens FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own xero tokens"
ON public.xero_tokens FOR INSERT
WITH CHECK (auth.uid() = user_id);
