-- Default FLOW model for NEW profiles: Claude Sonnet 4.6, replacing Z.ai GLM
-- 5.3 (20261001120000). The maintainer's field test of 2026-10-02 found GLM
-- 5.3's FLOW scores leaning towards the user at every reasoning level,
-- unlike GLM 5.2, so it is no longer recommended for FLOW and Sonnet 4.6 is
-- the one recommended model left. The chat default stays GLM 5.3.
--
-- Existing preferences are NOT changed: a stored preference is
-- indistinguishable from a choice, and Settings lets anyone switch. Kept in
-- step with src/lib/models.ts (DEFAULT_FLOW_MODEL) and the analysis
-- function's fallback for a NULL preference; order vs. the function deploy
-- does not matter (the default only fills new rows).

ALTER TABLE public.profiles ALTER COLUMN preferred_flow_model SET DEFAULT 'claude-sonnet-4-6';
