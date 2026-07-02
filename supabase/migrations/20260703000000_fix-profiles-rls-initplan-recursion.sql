-- Fixes a regression introduced by 20260702140000. That migration wrapped
-- auth.uid() as (select auth.uid()) in the two profiles policies to satisfy the
-- performance advisor's auth_rls_initplan finding (0003). On profiles, that wrap
-- triggers Postgres error 42P17 "infinite recursion detected in policy for
-- relation profiles": the "Users can update own profile non-budget" WITH CHECK
-- contains subqueries that read profiles itself (the budget freeze), and the
-- (select auth.uid()) form tips the RLS recursion guard that the bare auth.uid()
-- form did not. Symptom: every profiles UPDATE (e.g. changing
-- preferred_chat_model / preferred_flow_model in Settings) fails with 42P17 and
-- the client reverts the change.
--
-- Revert both profiles policies to the bare auth.uid() form (their state prior
-- to 20260702140000). This re-introduces 2 auth_rls_initplan WARNs on profiles,
-- which are ACCEPTED: profiles is one row per user, so the per-row re-evaluation
-- the linter flags is negligible here.
--
-- DO NOT re-wrap these two policies in (select auth.uid()) while the budget-freeze
-- subqueries remain in the WITH CHECK -- it re-introduces the 42P17 recursion.
-- The durable fix (replace the self-referencing freeze with column privileges so
-- the wrap becomes safe) is tracked separately.

ALTER POLICY "Users can view own profile" ON public.profiles
  USING (id = auth.uid());

ALTER POLICY "Users can update own profile non-budget" ON public.profiles
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
