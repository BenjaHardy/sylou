-- Migrate stored model preferences from the legacy rolling alias
-- `deepseek-chat` to the pinned `deepseek-v4-flash` id.
--
-- DeepSeek discontinues the legacy `deepseek-chat` / `deepseek-reasoner`
-- model names on 2026-07-24; until then `deepseek-chat` aliases
-- `deepseek-v4-flash` (non-thinking mode), so this rename is
-- behavior-preserving. Inverse of 20260521154222, which had adopted the
-- rolling alias. Column defaults are `mistral-medium-3-5` (20260615220324)
-- and are unaffected. Idempotent.

UPDATE public.profiles
SET preferred_chat_model = 'deepseek-v4-flash'
WHERE preferred_chat_model = 'deepseek-chat';

UPDATE public.profiles
SET preferred_flow_model = 'deepseek-v4-flash'
WHERE preferred_flow_model = 'deepseek-chat';
