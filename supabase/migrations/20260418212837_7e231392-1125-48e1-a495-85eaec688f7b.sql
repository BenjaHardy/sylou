-- 1. Fix project_creative_data: restrict to authenticated role
DROP POLICY IF EXISTS "Users access own creative data" ON public.project_creative_data;

CREATE POLICY "Users access own creative data"
  ON public.project_creative_data
  FOR ALL
  TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

-- 2. Lock down billing-sensitive columns on profiles
-- Remove broad UPDATE policy and replace with one that prevents changes to billing columns
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile non-billing"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Prevent self-modification of billing-sensitive columns by checking they match existing values
    AND subscription_tier = (SELECT subscription_tier FROM public.profiles WHERE id = auth.uid())
    AND monthly_token_budget = (SELECT monthly_token_budget FROM public.profiles WHERE id = auth.uid())
    AND tokens_used_this_period = (SELECT tokens_used_this_period FROM public.profiles WHERE id = auth.uid())
    AND billing_period_start IS NOT DISTINCT FROM (SELECT billing_period_start FROM public.profiles WHERE id = auth.uid())
    AND stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM public.profiles WHERE id = auth.uid())
    AND stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM public.profiles WHERE id = auth.uid())
  );

-- 3. Fix increment_tokens_used to enforce caller identity
CREATE OR REPLACE FUNCTION public.increment_tokens_used(user_uuid uuid, amount bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only allow the service role to increment any user; authenticated users can only increment their own
  IF auth.role() = 'authenticated' AND auth.uid() <> user_uuid THEN
    RAISE EXCEPTION 'Forbidden: cannot modify another user''s token usage';
  END IF;

  -- Reject negative amounts to prevent self-resetting the counter
  IF amount < 0 THEN
    RAISE EXCEPTION 'Amount must be non-negative';
  END IF;

  UPDATE public.profiles
  SET tokens_used_this_period = tokens_used_this_period + amount
  WHERE id = user_uuid;
END;
$$;

-- 4. Enable leaked password protection (handled at auth config level, requires dashboard toggle - documented in summary)
