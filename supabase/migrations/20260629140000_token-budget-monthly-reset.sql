-- Make the per-user token budget reset on a CALENDAR-MONTH basis again.
--
-- Background: `profiles.tokens_used_this_period` is only ever incremented, and
-- the period anchor (`billing_period_start`) was dropped in
-- 20260603142519_fb37d994... with no replacement and no scheduled reset
-- (pg_cron is not installed). So a set `monthly_token_budget` behaved as a
-- LIFETIME cap, and a capped user stayed blocked forever.
--
-- Fix (lazy reset, no pg_cron): a `token_period_start` anchor + a
-- `reset_tokens_if_stale()` RPC that zeroes the counter when the stored period
-- is an earlier calendar month. Edge functions call it once at the start of
-- each LLM request (before the budget check), so the reset always runs and an
-- over-budget user is unblocked on their first request of the new month.

-- 1. Period anchor: the calendar month the counter is currently accumulating in.
ALTER TABLE public.profiles
  ADD COLUMN token_period_start timestamptz NOT NULL DEFAULT date_trunc('month', now());

-- 2. Start the monthly cap clean: existing counters are bogus lifetime totals
--    under the new model (real usage history lives in token_usage regardless).
UPDATE public.profiles
  SET tokens_used_this_period = 0,
      token_period_start = date_trunc('month', now());

-- 3. Lazy calendar-month reset. Idempotent (only writes when stale); own-row only.
CREATE OR REPLACE FUNCTION public.reset_tokens_if_stale(user_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role may roll any user; an authenticated caller only their own.
  IF auth.role() = 'authenticated' AND auth.uid() <> user_uuid THEN
    RAISE EXCEPTION 'Forbidden: cannot modify another user''s token period';
  END IF;

  UPDATE public.profiles
  SET tokens_used_this_period = 0,
      token_period_start = date_trunc('month', now())
  WHERE id = user_uuid
    AND date_trunc('month', token_period_start) < date_trunc('month', now());
END;
$$;

-- 4. Extend the budget freeze so a user cannot self-reset the period to dodge
--    the cap. Recreates the existing "non-budget" UPDATE policy with an added
--    token_period_start freeze clause.
DROP POLICY IF EXISTS "Users can update own profile non-budget" ON public.profiles;
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
  AND token_period_start IS NOT DISTINCT FROM (
    SELECT p.token_period_start FROM public.profiles p WHERE p.id = auth.uid()
  )
);
