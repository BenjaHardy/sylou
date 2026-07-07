-- =============================================================================
-- Replace the self-referencing RLS budget freeze on public.profiles with
-- column privileges, and simplify both profiles policies.
--
-- Why: the "Users can update own profile non-budget" WITH CHECK froze the three
-- budget columns (monthly_token_budget, tokens_used_this_period,
-- token_period_start) via subqueries that read profiles itself. That
-- self-reference is why the auth_rls_initplan `(select auth.uid())` wrap
-- tripped 42P17 "infinite recursion detected in policy" (see 20260703000000)
-- and left 2 accepted advisor WARNs. Column privileges enforce the same freeze
-- declaratively: authenticated keeps UPDATE only on the user-editable
-- preference columns, the policies reduce to plain ownership predicates, and
-- the initplan wrap becomes safe. The freeze also gets STRONGER: the old
-- WITH CHECK rejected budget-column writes at row level; now the columns are
-- not grantable write targets for users at all.
--
-- Unaffected writers: increment_tokens_used and reset_tokens_if_stale are
-- SECURITY DEFINER (run as table owner -> bypass column privileges and RLS);
-- handle_new_user is SECURITY DEFINER and INSERT-only; service_role keeps its
-- table-level grants. Verified: no SECURITY INVOKER function or trigger
-- updates profiles.
--
-- Ordering: deploy the edge functions that route ALL token writes through the
-- increment_tokens_used RPC (same PR: chat, editor-action) BEFORE applying
-- this, so no user-context profiles UPDATE remains in any code path.
-- Idempotent; apply via the Supabase SQL editor (CLI history is out of sync --
-- see CLAUDE.md).
-- =============================================================================

-- 1. Rename the UPDATE policy back to its original 20260316163828 name: the
--    "non-budget" suffix described the WITH CHECK freeze this migration
--    removes. Guarded on both names so a re-run (old name already gone) or a
--    hand-modified DB (both names present) skips cleanly instead of failing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'Users can update own profile non-budget'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'Users can update own profile'
  ) THEN
    EXECUTE 'ALTER POLICY "Users can update own profile non-budget" ON public.profiles RENAME TO "Users can update own profile"';
  END IF;
END $$;

-- 2. The freeze itself. NOTE: a column-level REVOKE is a silent no-op while
--    the role still holds the table-level UPDATE grant (Supabase default
--    privileges grant ALL on public tables to anon/authenticated), so revoke
--    the table-level grant first, then re-grant UPDATE on the allowlist only:
--    the five columns the Settings UI patches, plus flow_nudges_enabled (a
--    user preference). Excluded: email (set at signup, never updated),
--    id/created_at/updated_at, and the three budget columns (the freeze).
REVOKE UPDATE ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (
  display_name,
  preferred_language,
  preferred_chat_model,
  preferred_flow_model,
  default_concise_mode,
  flow_nudges_enabled
) ON public.profiles TO authenticated;

-- 3. Simplify both policies to plain ownership predicates and wrap auth.uid()
--    as (select auth.uid()): safe now that no profiles policy reads profiles,
--    and clears the last two accepted auth_rls_initplan WARNs (0003).
ALTER POLICY "Users can update own profile" ON public.profiles
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

ALTER POLICY "Users can view own profile" ON public.profiles
  USING (id = (SELECT auth.uid()));
