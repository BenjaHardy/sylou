-- Enable Row Level Security on five tables that were created WITH policies but
-- never had RLS turned on, in migration
-- 20260317132440_71c9b51d-12f1-4382-835e-42bb39e98eb4.sql:
--   flow_reports, ai_editor_actions, writing_summary_log,
--   provenance_events, token_usage.
--
-- That migration defined full per-operation RLS policies on each table but
-- omitted `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. In Postgres, policies on
-- an RLS-disabled table are inert (not enforced), and Supabase grants the
-- anon/authenticated roles default table access -- so every row on these tables
-- was cross-tenant readable and writable by any caller using the anon key.
--
-- Why the hosted instance never broke: it carries an out-of-band
-- `rls_auto_enable` event trigger (fires on CREATE TABLE in `public` and runs
-- ENABLE RLS automatically). That trigger is NOT part of these migrations, so a
-- fresh self-host applying the migrations top-to-bottom has no such safety net
-- and IS exposed. This migration makes the repo self-sufficient.
--
-- The existing policies are already correct and match the app's own-data access
-- patterns; this simply activates them, exactly as the other 11 tables already
-- do. Service-role callers (edge functions) bypass RLS regardless, so
-- server-side behavior is unchanged. ENABLE is idempotent, so this is a safe
-- no-op on the hosted instance where the trigger already enabled RLS.

ALTER TABLE public.flow_reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_editor_actions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.writing_summary_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provenance_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_usage         ENABLE ROW LEVEL SECURITY;
