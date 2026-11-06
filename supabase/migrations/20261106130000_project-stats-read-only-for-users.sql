-- project_stats is read-only for users.
--
-- The rows come from the handle_new_project trigger, activity time from
-- record_activity (20261106120000) and prompt counts from the edge
-- functions' service-role client, so the signed-in role keeps SELECT only,
-- as for the other records behind a FLOW report (20260709120000,
-- 20260924120000). Policies and grants stay mirrored (20260925120000).
--
-- Deploy order: apply once the app that calls record_activity is live; an
-- app from before it can no longer record activity. Idempotent.

DROP POLICY IF EXISTS "Users can insert own project_stats" ON public.project_stats;
DROP POLICY IF EXISTS "Users can update own project_stats" ON public.project_stats;
REVOKE INSERT, UPDATE, DELETE ON public.project_stats FROM authenticated;
