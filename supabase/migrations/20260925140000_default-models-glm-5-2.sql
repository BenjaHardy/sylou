-- Default models for NEW profiles: Z.ai GLM 5.2 (via the Mistral API) for
-- both chat and FLOW, replacing Mistral Medium 3.5 (20260615220324).
--
-- Maintainer decision 2026-09-25 after the field tests of August/September:
-- GLM 5.2 is one of the two models recommended for FLOW (with Claude Sonnet
-- 4.6, not ranked against each other) and was judged "fast + higher quality"
-- for chat. Existing profiles are NOT changed: a stored preference is
-- indistinguishable from a choice, and Settings lets anyone switch.
--
-- Kept in step with src/lib/models.ts (DEFAULT_CHAT_MODEL / DEFAULT_FLOW_MODEL)
-- and the edge functions' fallback for a NULL preference (chat, analysis,
-- context-prompt, editor-action, extract-text). Order vs. the function
-- deploy does not matter: the column default only fills new rows, and the
-- code fallback only applies when the preference is NULL.

ALTER TABLE public.profiles ALTER COLUMN preferred_chat_model SET DEFAULT 'zai-glm-5-2';
ALTER TABLE public.profiles ALTER COLUMN preferred_flow_model SET DEFAULT 'zai-glm-5-2';
