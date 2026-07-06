-- Token-gated access to shared FLOW reports (step 1 of 2).
--
-- Background: reading the sanitized `flow_reports_public` view required only
-- the anon API key and no token, so anyone could enumerate every shared
-- report on an instance (project names, full writing snapshots, every
-- share_token) by paging the view. The unguessable 122-bit share_token was
-- therefore not actually load-bearing.
--
-- This SECURITY DEFINER function returns a shared report ONLY when the caller
-- supplies the exact share_token. It reads THROUGH the existing
-- flow_reports_public view, so the sanitized column set and the
-- share_enabled/public filter stay defined in exactly one place (no column
-- drift). It returns an empty set — an indistinguishable null to the client —
-- for a missing, sharing-disabled, non-public, or wrong token, so there is no
-- enumeration path and no existence oracle.
--
-- The parameter is named `_token` (leading underscore) to avoid ambiguity
-- with the `share_token` column inside the WHERE clause. share_token is text.
--
-- APPLY ORDER: apply this migration BEFORE deploying the frontend that calls
-- get_shared_report(); apply the companion REVOKE (20260704000100) only AFTER
-- the new frontend is live, so already-open shared links never break during
-- the transition.

CREATE OR REPLACE FUNCTION public.get_shared_report(_token text)
RETURNS SETOF public.flow_reports_public
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.flow_reports_public WHERE share_token = _token;
$$;

-- Supabase grants EXECUTE on new functions to PUBLIC (and directly to the
-- anon/authenticated API roles) by default; lock that down, then re-grant
-- only to the roles that serve the public report page.
REVOKE ALL ON FUNCTION public.get_shared_report(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_report(text) TO anon, authenticated;
