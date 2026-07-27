-- Expose provenance_snapshot on the public shared-report surface.
--
-- Maintainer decision 2026-07-27: the provenance map (typed / copied /
-- AI spans) becomes part of the shared report, powering the same
-- "View Highlighted Text" view the in-app report has. writing_snapshot
-- (the full writing text) has always been an unconditionally-shared
-- column of this view, so provenance adds only origin annotations over
-- already-public text — the transparency story the report exists to
-- tell. The original omission was deliberate (see 20260522111654) and
-- predates the provenance-accuracy fixes (#73/#74); it is now
-- superseded.
--
-- ai_editor_summary remains intentionally NOT exposed.
--
-- Mechanics notes:
-- * CREATE OR REPLACE VIEW can only APPEND columns after the current
--   last one (generator_info) — never reorder or drop — so
--   provenance_snapshot is added at the end.
-- * OR REPLACE preserves the view's existing ACLs: anon's direct SELECT
--   stays revoked (20260704000100); access remains token-gated through
--   get_shared_report, which is re-issued verbatim below so its SETOF
--   rowtype follows the new view shape.
-- * Apply via the SQL editor (project convention). The frontend is
--   resilient to either apply order: it fetches provenance_snapshot in
--   a separate tolerant query and hides the button when the column
--   doesn't exist yet.

CREATE OR REPLACE VIEW public.flow_reports_public AS
SELECT
  id, project_id, project_name, certificate_id, share_token,
  share_enabled, share_visibility, share_include_feedback,
  share_include_replay, share_include_report, share_include_profile,
  model_used, created_at,
  writing_snapshot, ai_find, ai_lead, ai_organize, ai_write, ai_summary,
  key_user_contributions, flow_meta, metrics_snapshot,
  CASE WHEN share_include_feedback THEN user_feedback_pre  ELSE NULL END AS user_feedback_pre,
  CASE WHEN share_include_feedback THEN user_feedback_post ELSE NULL END AS user_feedback_post,
  CASE WHEN share_include_feedback THEN user_feedback_pre_at  ELSE NULL END AS user_feedback_pre_at,
  CASE WHEN share_include_feedback THEN user_feedback_post_at ELSE NULL END AS user_feedback_post_at,
  CASE WHEN share_include_replay THEN replay_snapshot ELSE NULL END AS replay_snapshot,
  generator_info,
  provenance_snapshot
FROM public.flow_reports
WHERE share_enabled = true AND share_visibility = 'public';

-- Re-issued verbatim from 20260704000000 so the function's SETOF rowtype
-- is refreshed against the widened view.
CREATE OR REPLACE FUNCTION public.get_shared_report(_token text)
RETURNS SETOF public.flow_reports_public
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.flow_reports_public WHERE share_token = _token;
$$;

REVOKE ALL ON FUNCTION public.get_shared_report(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_report(text) TO anon, authenticated;
