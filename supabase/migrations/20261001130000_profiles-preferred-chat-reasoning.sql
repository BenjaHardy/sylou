-- User-selectable reasoning level for the chat model (Settings → Models): a
-- per-model map, e.g. {"zai-glm-5-3": "max", "claude-opus-4-8": "medium"},
-- read by chat and context-prompt (Ask/Propose) and validated server-side
-- against CHAT_REASONING_OPTIONS in supabase/functions/_shared/_thinking.ts;
-- an unknown or missing entry means the code default. FLOW, editor actions
-- and the summary calls keep their fixed settings and never read it.
--
-- The column is user-writable (Settings patches it), so it joins the
-- column-level UPDATE allowlist of 20260707000000 (the budget freeze); the
-- CHECK keeps the value a small JSON object. Deploy chat, context-prompt and
-- editor-action AFTER applying this: their profile fetch selects the column.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_chat_reasoning jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_chat_reasoning_shape
  CHECK (jsonb_typeof(preferred_chat_reasoning) = 'object'
         AND pg_column_size(preferred_chat_reasoning) <= 2048);

GRANT UPDATE (preferred_chat_reasoning) ON public.profiles TO authenticated;
