-- Follow-up to 20260702000000. The security advisor still flagged
-- handle_new_user, handle_new_project, and rls_auto_enable as anon/authenticated
-- executable after that migration. `REVOKE ... FROM PUBLIC` alone was
-- insufficient: Supabase grants EXECUTE to the `anon`/`authenticated` API roles
-- *directly* (via default privileges), not only through PUBLIC, so a
-- PUBLIC-only revoke leaves those direct grants in place. Revoke from the roles
-- explicitly.
--
-- These are trigger / event-trigger functions with no legitimate RPC caller:
-- the trigger machinery invokes them as the table owner regardless of grants,
-- so revoking all API-role EXECUTE does not disable the triggers.

REVOKE ALL ON FUNCTION public.handle_new_user()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_project() FROM PUBLIC, anon, authenticated;

-- rls_auto_enable is the hosted-only Lovable safety net; guard so this is a
-- no-op on a fresh DB that lacks it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'rls_auto_enable' AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END $$;
