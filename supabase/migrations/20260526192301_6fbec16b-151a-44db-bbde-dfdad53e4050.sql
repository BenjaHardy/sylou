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
  generator_info
FROM public.flow_reports
WHERE share_enabled = true AND share_visibility = 'public';

GRANT SELECT ON public.flow_reports_public TO anon, authenticated;