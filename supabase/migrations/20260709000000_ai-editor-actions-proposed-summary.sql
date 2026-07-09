-- P2-7: store LLM #1's summary delta server-side on the action row, keyed by
-- action_id — parallel to ai_response_full (20260320165652). Written by
-- context-prompt when it persists the Ask/Propose action; read back by the
-- CONFIRM endpoint inside the same pending-gate UPDATE, so CONFIRM no longer
-- trusts client-echoed summary content (the client-supplied summary_update
-- could previously seed arbitrary text into a `not_assessed` chat message and
-- the writing_summary_log — a FLOW-gaming surface).
--
-- Nullable: rows created before this migration carry no stored summary and
-- CONFIRM simply logs no summary message for them (safe degradation).
--
-- Apply BEFORE deploying the updated context-prompt function (the new code
-- writes this column; old code is unaffected by its presence). Idempotent;
-- apply via the Supabase SQL editor (see CLAUDE.md on migration-history drift).
ALTER TABLE public.ai_editor_actions
  ADD COLUMN IF NOT EXISTS proposed_summary text;
