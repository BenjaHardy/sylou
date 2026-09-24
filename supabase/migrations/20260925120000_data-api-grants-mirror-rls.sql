-- Data API grants: explicit, and mirroring the RLS policies exactly.
--
-- WHY NOW. Supabase stops granting Data API access to new public tables
-- automatically (new projects since 2026-05-30 progressively, every project
-- on 2026-10-30; github.com/orgs/supabase/discussions/45329). Existing
-- tables keep their grants, but a table created by a migration on a fresh
-- project gets none — and Sylou's migrations relied on the automatic
-- grants for all 17 tables. Without this file, a self-hoster's fresh
-- install would fail at the first request with "permission denied".
--
-- WHAT THIS ENCODES. Two layers guard every table: grants (coarse: may this
-- role attempt this operation at all?) and RLS policies (fine: which rows).
-- Sylou keeps every user restriction in RLS, and this migration makes the
-- coarse layer say the same thing: for `authenticated`, exactly the
-- operations that have a policy, nothing more; for `service_role` (the edge
-- functions, which bypass RLS behind their own ownership checks), all
-- privileges; for `anon`, nothing on base tables — its only reads go
-- through the owner-executed view flow_reports_public and the
-- get_shared_report RPC, both granted explicitly by earlier migrations.
-- TRUNCATE, REFERENCES and TRIGGER are revoked from both user roles: RLS
-- does not cover them and no client needs them.
--
-- On an existing project (automatic grants present) the GRANTs are no-ops
-- and the REVOKEs tighten: chat_messages, writing_summary_log,
-- ai_editor_actions and chat_thread_summaries become write-protected at
-- the grant layer too (their write policies were dropped in 20260709120000
-- / 20260720…), chat_threads loses DELETE (20260904120000), flow_reports
-- loses INSERT/DELETE and writing_versions DELETE (20260924120000). The
-- client never performs any of these operations. profiles keeps its
-- column-level UPDATE grant from 20260707000000 untouched (a REVOKE ALL
-- would drop it, so that table gets targeted revokes).
--
-- Kept in step by src/lib/__tests__/migrations-privileges.test.ts, which
-- replays every migration and fails CI when a table's grants and policies
-- disagree, when a table lacks RLS, or when a role holds more than intended.
-- The rule for new tables: CREATE TABLE → ENABLE ROW LEVEL SECURITY →
-- policies → GRANTs (this shape), in the same migration.
--
-- No sequences exist (every id is a uuid default), so no sequence grants.

-- token_usage: the two "deny" policies added in 20260522134600 were
-- permissive policies with USING (false). Permissive policies are OR-ed, so
-- such a policy can neither allow nor block anything: with no UPDATE or
-- DELETE policy at all, RLS denies those operations just the same. They are
-- dropped so the policy set states the intent plainly (select + insert; the
-- user INSERT is load-bearing, see 20260924120000) and the mirror below
-- stays exact.
DROP POLICY "No updates to token_usage" ON public.token_usage;
DROP POLICY "No deletes from token_usage" ON public.token_usage;

-- ai_editor_actions (policies: select)
REVOKE ALL ON public.ai_editor_actions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ai_editor_actions FROM authenticated;
GRANT SELECT ON public.ai_editor_actions TO authenticated;
GRANT ALL ON public.ai_editor_actions TO service_role;

-- chat_bookmarks (full CRUD)
REVOKE ALL ON public.chat_bookmarks FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.chat_bookmarks FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_bookmarks TO authenticated;
GRANT ALL ON public.chat_bookmarks TO service_role;

-- chat_messages (policies: select)
REVOKE ALL ON public.chat_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.chat_messages FROM authenticated;
GRANT SELECT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;

-- chat_thread_summaries (policies: select)
REVOKE ALL ON public.chat_thread_summaries FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.chat_thread_summaries FROM authenticated;
GRANT SELECT ON public.chat_thread_summaries TO authenticated;
GRANT ALL ON public.chat_thread_summaries TO service_role;

-- chat_threads (policies: select, insert, update)
REVOKE ALL ON public.chat_threads FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.chat_threads FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.chat_threads TO authenticated;
GRANT ALL ON public.chat_threads TO service_role;

-- flow_reports (policies: select, update)
REVOKE ALL ON public.flow_reports FROM anon;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.flow_reports FROM authenticated;
GRANT SELECT, UPDATE ON public.flow_reports TO authenticated;
GRANT ALL ON public.flow_reports TO service_role;

-- imported_documents (full CRUD)
REVOKE ALL ON public.imported_documents FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.imported_documents FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.imported_documents TO authenticated;
GRANT ALL ON public.imported_documents TO service_role;

-- post_its (full CRUD)
REVOKE ALL ON public.post_its FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.post_its FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_its TO authenticated;
GRANT ALL ON public.post_its TO service_role;

-- profiles (policies: select, update)
REVOKE ALL ON public.profiles FROM anon;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- project_creative_data (full CRUD)
REVOKE ALL ON public.project_creative_data FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.project_creative_data FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_creative_data TO authenticated;
GRANT ALL ON public.project_creative_data TO service_role;

-- project_stats (policies: select, insert, update)
REVOKE ALL ON public.project_stats FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.project_stats FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.project_stats TO authenticated;
GRANT ALL ON public.project_stats TO service_role;

-- projects (full CRUD)
REVOKE ALL ON public.projects FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.projects FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;

-- provenance_events (full CRUD)
REVOKE ALL ON public.provenance_events FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.provenance_events FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provenance_events TO authenticated;
GRANT ALL ON public.provenance_events TO service_role;

-- token_usage (policies: select, insert)
REVOKE ALL ON public.token_usage FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.token_usage FROM authenticated;
GRANT SELECT, INSERT ON public.token_usage TO authenticated;
GRANT ALL ON public.token_usage TO service_role;

-- writing_content (full CRUD)
REVOKE ALL ON public.writing_content FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.writing_content FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.writing_content TO authenticated;
GRANT ALL ON public.writing_content TO service_role;

-- writing_summary_log (policies: select)
REVOKE ALL ON public.writing_summary_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.writing_summary_log FROM authenticated;
GRANT SELECT ON public.writing_summary_log TO authenticated;
GRANT ALL ON public.writing_summary_log TO service_role;

-- writing_versions (policies: select, insert)
REVOKE ALL ON public.writing_versions FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.writing_versions FROM authenticated;
GRANT SELECT, INSERT ON public.writing_versions TO authenticated;
GRANT ALL ON public.writing_versions TO service_role;

