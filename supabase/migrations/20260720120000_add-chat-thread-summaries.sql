-- conversation-memory (PR 1, backend): rolling per-thread chat summary.
--
-- One row per thread. The chat + context-prompt functions inject
-- summary_text into their prompts alongside the verbatim newest-50 window,
-- and refresh it in their post-stream tails once ~50 messages accumulate
-- past the watermark. Each refresh covers THROUGH the refresh point, so the
-- summary may overlap the verbatim window -- expected, and disclosed in
-- both the summarizer prompt and the injection framing.
--
-- SECURITY -- deliberately NO user write policies (SELECT only): all writes
-- go through the edge functions' service-role clients behind each request's
-- upfront thread-ownership check (the 20260709120000 write-surface-lockdown
-- pattern). A user-writable summary would be a standing prompt-injection
-- amplifier (forged "memory" re-read on every subsequent turn). Do NOT add
-- INSERT/UPDATE/DELETE policies -- their absence is the design.
--
-- FLOW never reads this table: it extends the withheld-writing_summary_log
-- invariant -- summaries are continuity aids, never assessment evidence.
--
-- The UNIQUE on thread_id doubles as the FK covering index (perf advisor
-- 0001_unindexed_foreign_keys) -- no separate index needed.
--
-- Idempotent for the SQL-editor apply flow.

CREATE TABLE IF NOT EXISTS public.chat_thread_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL UNIQUE REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  summary_text text NOT NULL,
  -- Watermark: created_at of the newest chat_messages row this summary
  -- covers. The refresh trigger counts messages strictly newer than this.
  covers_through timestamptz NOT NULL,
  covered_message_count int NOT NULL DEFAULT 0,
  model_used text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_thread_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_thread_summaries" ON public.chat_thread_summaries;
CREATE POLICY "select_own_thread_summaries"
  ON public.chat_thread_summaries FOR SELECT
  TO authenticated
  USING (public.owns_thread(thread_id));
