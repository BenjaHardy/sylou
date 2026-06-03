-- Drop the existing freeze policy first because it references columns we're about to drop
-- (subscription_tier, billing_period_start, stripe_customer_id, stripe_subscription_id).
DROP POLICY IF EXISTS "Users can update own profile non-billing" ON public.profiles;

-- Change default to NULL so newly-created profiles start with no budget cap.
-- Existing rows are NOT touched (ALTER ... DEFAULT only affects future inserts).
ALTER TABLE public.profiles
  ALTER COLUMN monthly_token_budget DROP NOT NULL,
  ALTER COLUMN monthly_token_budget SET DEFAULT NULL;

-- Drop SaaS-only columns. The open-source release has no tier or billing concept.
ALTER TABLE public.profiles
  DROP COLUMN subscription_tier,
  DROP COLUMN stripe_customer_id,
  DROP COLUMN stripe_subscription_id,
  DROP COLUMN billing_period_start;

-- Recreate the freeze policy under a clearer name. "non-billing" no longer applies
-- because billing fields were dropped above; the freeze now covers only the two
-- usage/budget columns. Users still cannot bump their own budget — only operators
-- (direct SQL) and service-role callers (edge functions) can adjust these values.
CREATE POLICY "Users can update own profile non-budget"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND monthly_token_budget IS NOT DISTINCT FROM (
    SELECT p.monthly_token_budget FROM public.profiles p WHERE p.id = auth.uid()
  )
  AND tokens_used_this_period = (
    SELECT p.tokens_used_this_period FROM public.profiles p WHERE p.id = auth.uid()
  )
);