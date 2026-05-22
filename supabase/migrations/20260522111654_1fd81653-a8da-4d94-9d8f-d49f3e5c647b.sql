-- 1. Remove the over-permissive public policy on the base table.
DROP POLICY IF EXISTS "Public can view shared flow_reports" ON public.flow_reports;

-- 2. Create a sanitized view that enforces share toggles at the column level.
--    Uses SECURITY DEFINER semantics (default) so anon can read shared rows
--    via this view only, without gaining direct access to the base table.
CREATE OR REPLACE VIEW public.flow_reports_public AS
SELECT
  id,
  project_id,
  project_name,
  certificate_id,
  share_token,
  share_enabled,
  share_visibility,
  share_include_feedback,
  share_include_replay,
  share_include_report,
  share_include_profile,
  model_used,
  created_at,
  -- Always-shared fields
  writing_snapshot,
  ai_find,
  ai_lead,
  ai_organize,
  ai_write,
  ai_summary,
  key_user_contributions,
  flow_meta,
  metrics_snapshot,
  -- Feedback gated by share_include_feedback
  CASE WHEN share_include_feedback THEN user_feedback_pre  ELSE NULL END AS user_feedback_pre,
  CASE WHEN share_include_feedback THEN user_feedback_post ELSE NULL END AS user_feedback_post,
  CASE WHEN share_include_feedback THEN user_feedback_pre_at  ELSE NULL END AS user_feedback_pre_at,
  CASE WHEN share_include_feedback THEN user_feedback_post_at ELSE NULL END AS user_feedback_post_at,
  -- Replay gated by share_include_replay
  CASE WHEN share_include_replay THEN replay_snapshot ELSE NULL END AS replay_snapshot
FROM public.flow_reports
WHERE share_enabled = true
  AND share_visibility = 'public';
  -- Note: provenance_snapshot and ai_editor_summary are intentionally
  -- never exposed through this view.

-- 3. Grant read access on the view to anonymous and authenticated roles.
GRANT SELECT ON public.flow_reports_public TO anon, authenticated;

-- 4. Document the intent.
COMMENT ON VIEW public.flow_reports_public IS
  'Sanitized public view of flow_reports for shared report links. Enforces share_include_* toggles and hides internal analysis fields. Always query this view (never the base table) from unauthenticated contexts.';