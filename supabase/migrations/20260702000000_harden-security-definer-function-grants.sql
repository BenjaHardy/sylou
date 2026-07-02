-- =============================================================================
-- Harden SECURITY DEFINER functions flagged by the Supabase security advisor
-- (0028/0029: "Public Can Execute SECURITY DEFINER Function").
--
-- SECURITY DEFINER functions default to `GRANT EXECUTE TO PUBLIC`, so `anon`
-- (and any future role) can invoke them via /rest/v1/rpc/*. This revokes the
-- default PUBLIC grant, re-grants EXECUTE only to the roles that legitimately
-- call each function, and tightens the two budget functions' caller guard so
-- it fails closed for any non-service-role caller (NULL-safe, covering `anon`).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Budget functions.
--    Called by the edge functions as the authenticated user (user-scoped
--    client) or via service_role (admin client) -- never by anon. They already
--    self-guarded, but the guard checked `auth.role() = 'authenticated'`, so
--    anon skipped it. Flip to `<> 'service_role'` + IS DISTINCT FROM (NULL-safe,
--    so anon -- whose auth.uid() is NULL -- is blocked), and revoke PUBLIC/anon.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_tokens_used(user_uuid uuid, amount bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only service_role may touch another user's counter; everyone else is
  -- restricted to their own row. IS DISTINCT FROM is NULL-safe, so anon
  -- (auth.uid() = NULL) is blocked rather than slipping through `<>`.
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM user_uuid THEN
    RAISE EXCEPTION 'Forbidden: cannot modify another user''s token usage';
  END IF;

  -- Reject negative amounts to prevent self-resetting the counter.
  IF amount < 0 THEN
    RAISE EXCEPTION 'Amount must be non-negative';
  END IF;

  UPDATE public.profiles
  SET tokens_used_this_period = tokens_used_this_period + amount
  WHERE id = user_uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_tokens_used(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_tokens_used(uuid, bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reset_tokens_if_stale(user_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM user_uuid THEN
    RAISE EXCEPTION 'Forbidden: cannot modify another user''s token period';
  END IF;

  UPDATE public.profiles
  SET tokens_used_this_period = 0,
      token_period_start = date_trunc('month', now())
  WHERE id = user_uuid
    AND date_trunc('month', token_period_start) < date_trunc('month', now());
END;
$$;

REVOKE ALL ON FUNCTION public.reset_tokens_if_stale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_tokens_if_stale(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Trigger functions. AFTER INSERT trigger bodies only -- invoked by the
--    trigger machinery as the table owner, never as an RPC. Dropping PUBLIC
--    (which covers anon + authenticated) does NOT disable the triggers; no role
--    needs a direct grant.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_project() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. RLS ownership helpers. Referenced only inside RLS policies scoped TO
--    authenticated; policy evaluation runs with the SECURITY DEFINER owner's
--    privileges. Drop the default PUBLIC grant so anon can't RPC-probe
--    ownership of arbitrary project/thread UUIDs (a boolean oracle); keep
--    authenticated.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.owns_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_project(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.owns_thread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_thread(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. rls_auto_enable: the hosted-only Lovable event-trigger safety net (runs as
--    superuser via the event-trigger machinery; never an RPC caller). Guard the
--    REVOKE so this migration is a no-op on a fresh DB that lacks the function.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'rls_auto_enable'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC';
  END IF;
END $$;

-- Note: the `flow_reports_public` SECURITY DEFINER *view* (advisor 0010) is
-- INTENTIONAL and deliberately left as-is -- it is the sanitized public-share
-- surface that replaced a permissive anon policy on the flow_reports base table
-- (columns curated, filtered to share_enabled + public). Switching it to
-- security_invoker would require re-adding that wider base-table policy, which
-- is strictly worse. Dismiss that advisor finding rather than "fixing" it.
