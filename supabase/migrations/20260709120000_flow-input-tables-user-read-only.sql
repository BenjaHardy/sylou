-- Write-surface lockdown: the three FLOW-input tables become user-READ-only.
--
-- chat_messages, writing_summary_log and ai_editor_actions are the records
-- the FLOW analysis reads as evidence. Their user-role write policies allowed
-- any authenticated user to fabricate those records for their own projects
-- via direct PostgREST calls (e.g. INSERT a fake assistant message flagged
-- not_assessed, or rewrite the summary log) — creating FLOW signals that do
-- not correspond to anything that actually happened. All legitimate writes
-- already go through the edge functions, which use the service-role client
-- (bypasses RLS) behind upfront ownership checks; the last user-context edge
-- writes were switched to the admin client in the same PR as this migration.
--
-- SELECT policies are untouched — what users can read does not change.
-- Deletion cascades are unaffected: FK ON DELETE CASCADE runs inside
-- Postgres and does not consult RLS policies (verified: chat_messages →
-- chat_threads → projects, ai_editor_actions → projects,
-- writing_summary_log → projects are all CASCADE), so deleting a thread or
-- project still cleans up as before.
--
-- Apply AFTER deploying the updated chat, editor-action and context-prompt
-- functions (older deployments still write some of these rows as the user
-- role and would start failing silently). Idempotent; apply via the Supabase
-- SQL editor (see CLAUDE.md on migration-history drift).

-- chat_messages: keep "Users access own chat_messages" (SELECT).
-- No UPDATE policy ever existed (messages were already immutable).
DROP POLICY IF EXISTS "Users insert own chat_messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users delete own chat_messages" ON public.chat_messages;

-- writing_summary_log: keep "Users can select own writing_summary_log".
DROP POLICY IF EXISTS "Users can insert own writing_summary_log" ON public.writing_summary_log;
DROP POLICY IF EXISTS "Users can update own writing_summary_log" ON public.writing_summary_log;
DROP POLICY IF EXISTS "Users can delete own writing_summary_log" ON public.writing_summary_log;

-- ai_editor_actions: keep "Users can select own ai_editor_actions".
-- The client's last direct write (the updateOutcome fallback) was removed
-- with the P2-7 CONFIRM redesign; outcomes are recorded by the pending-gated
-- CONFIRM endpoint via the service role.
DROP POLICY IF EXISTS "Users can insert own ai_editor_actions" ON public.ai_editor_actions;
DROP POLICY IF EXISTS "Users can update own ai_editor_actions" ON public.ai_editor_actions;
DROP POLICY IF EXISTS "Users can delete own ai_editor_actions" ON public.ai_editor_actions;
