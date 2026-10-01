-- Z.ai GLM 5.3 replaces GLM 5.2 (both via the Mistral API) as the default
-- chat and FLOW model for NEW profiles (column defaults set to GLM 5.2 by
-- 20260925140000), and existing GLM 5.2 preferences move to GLM 5.3: Mistral
-- deprecated zai-glm-5-2 on 2026-09-29 and retires it on 2026-10-31, after
-- which a stored 5.2 preference would fail at every model call. Same price
-- and context window; see src/lib/models.ts for the registry entry.
--
-- Historical rows (flow_reports.model_used, chat_messages.model_used,
-- chat_thread_summaries.model_used, token_usage.model_used) are NOT
-- rewritten: they disclose the model that actually ran. The frontend keeps a
-- label for the retired id (MODEL_LABELS in src/lib/models.ts).
--
-- Kept in step with src/lib/models.ts (DEFAULT_CHAT_MODEL / DEFAULT_FLOW_MODEL)
-- and the edge functions' fallback for a NULL preference (chat, analysis,
-- context-prompt, editor-action, extract-text). Deploy the functions before
-- applying this, so their per-model tables already know the new id when the
-- preferences flip; either order works while 5.2 is still served.

ALTER TABLE public.profiles ALTER COLUMN preferred_chat_model SET DEFAULT 'zai-glm-5-3';
ALTER TABLE public.profiles ALTER COLUMN preferred_flow_model SET DEFAULT 'zai-glm-5-3';

UPDATE public.profiles SET preferred_chat_model = 'zai-glm-5-3' WHERE preferred_chat_model = 'zai-glm-5-2';
UPDATE public.profiles SET preferred_flow_model = 'zai-glm-5-3' WHERE preferred_flow_model = 'zai-glm-5-2';
