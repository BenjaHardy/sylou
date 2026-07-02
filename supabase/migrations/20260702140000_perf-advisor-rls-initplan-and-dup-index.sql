-- Supabase performance advisor, WARN-level findings.
--
-- 1. auth_rls_initplan (0003, x9): each flagged policy calls auth.uid()
--    unwrapped, so Postgres re-evaluates it once PER ROW. Wrapping it as a
--    scalar subquery `(select auth.uid())` turns it into an InitPlan the planner
--    evaluates once per statement. This is a pure re-timing: every USING /
--    WITH CHECK expression below is identical to the current policy apart from
--    the (select ...) wrap -- no change to who may read or write which rows.
--    ALTER POLICY is used (not DROP+CREATE) so the table is never, even briefly,
--    left without the policy.
--
-- 2. duplicate_index (0009, x1): flow_reports carries two identical UNIQUE
--    constraints on certificate_id.
--
-- Column/policy expressions verified against the latest migration that defines
-- each policy. Apply in the dashboard SQL editor (db push is broken on this
-- Lovable project); re-runnable (ALTER POLICY re-sets the same expression,
-- DROP CONSTRAINT is IF EXISTS).

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
ALTER POLICY "Users can view own profile" ON public.profiles
  USING (id = (select auth.uid()));

ALTER POLICY "Users can update own profile non-budget" ON public.profiles
  USING (id = (select auth.uid()))
  WITH CHECK (
    id = (select auth.uid())
    AND monthly_token_budget IS NOT DISTINCT FROM (
      SELECT p.monthly_token_budget FROM public.profiles p WHERE p.id = (select auth.uid())
    )
    AND tokens_used_this_period = (
      SELECT p.tokens_used_this_period FROM public.profiles p WHERE p.id = (select auth.uid())
    )
    AND token_period_start IS NOT DISTINCT FROM (
      SELECT p.token_period_start FROM public.profiles p WHERE p.id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
ALTER POLICY "Users can select own projects" ON public.projects
  USING (user_id = (select auth.uid()));

ALTER POLICY "Users can insert own projects" ON public.projects
  WITH CHECK (user_id = (select auth.uid()));

ALTER POLICY "Users can update own projects" ON public.projects
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

ALTER POLICY "Users can delete own projects" ON public.projects
  USING (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- token_usage
-- ---------------------------------------------------------------------------
ALTER POLICY "Users can select own token_usage" ON public.token_usage
  USING (user_id = (select auth.uid()));

ALTER POLICY "Users can insert own token_usage" ON public.token_usage
  WITH CHECK (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- project_creative_data
-- ---------------------------------------------------------------------------
ALTER POLICY "Users access own creative data" ON public.project_creative_data
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = (select auth.uid())))
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- duplicate_index: keep flow_reports_certificate_id_key (backs the inline
-- `certificate_id text UNIQUE` from the CREATE TABLE); drop the redundant
-- flow_reports_certificate_id_unique added later by 20260403215049. Uniqueness
-- stays enforced by the surviving constraint. No code references the constraint
-- by name and no upsert targets certificate_id (the only onConflict is
-- project_creative_data(project_id,tool_type)).
-- ---------------------------------------------------------------------------
ALTER TABLE public.flow_reports DROP CONSTRAINT IF EXISTS flow_reports_certificate_id_unique;
