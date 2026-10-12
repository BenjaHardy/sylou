-- Default FLOW model for NEW profiles: Z.ai GLM 5.3, replacing Claude Sonnet
-- 4.6 (20261002120000). FLOW prompt v1.5 (2026-10-06) removed the
-- user-leaning scores that had taken GLM 5.3 off the recommended list, and
-- the maintainer's field tests since then make it a recommended FLOW model
-- again, alongside Claude Sonnet 5.5. GLM 5.3 is the chat default already.
--
-- Existing preferences are NOT changed: a stored preference is
-- indistinguishable from a choice, and Settings lets anyone switch. Kept in
-- step with src/lib/models.ts (DEFAULT_FLOW_MODEL) and the analysis
-- function's fallback for a NULL preference; order vs. the function deploy
-- does not matter (the default only fills new rows).

ALTER TABLE public.profiles ALTER COLUMN preferred_flow_model SET DEFAULT 'zai-glm-5-3';
