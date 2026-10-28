-- Report evidence: on their own FLOW reports, users write their feedback
-- and nothing else, and the pre-analysis feedback only once.
--
-- Same principle as 20260924120000: the rows a shared FLOW report presents
-- as evidence are produced by Sylou itself. That migration kept the user
-- UPDATE policy for the feedback, and 20260925120000 mirrors the policy
-- with a table-level grant; this one narrows the grant to the columns the
-- client writes and adds the once-only rule for the pre-analysis feedback.
--
-- 1. Columns. The client writes four, the pre/post feedback and their
--    timestamps (saveFeedback and saveUserAssessment in useFlowAnalysis);
--    sharing goes through the share-report function's service-role
--    client, as the analysis function's insert does. So authenticated
--    keeps UPDATE on those four columns only: any other column is a 42501
--    for users, and the ownership policy still decides which rows. As in
--    the profiles budget freeze (20260707000000), the table-level UPDATE is
--    revoked first, because a column-level REVOKE does nothing while it
--    exists (its column grants go with it).
--
-- 2. Pre-analysis feedback. The app offers it once, on a project's first
--    report, before showing the results; the self-assessment (post) stays
--    editable. The trigger holds the pre columns to that: settable while
--    empty, on the project's earliest report, never changed after. It runs
--    only for an UPDATE that names a pre column, so share toggles and
--    self-assessment saves never reach it. It runs with the caller's rights
--    (it reads only the caller's own reports) and, like the other trigger
--    functions, has no API-role EXECUTE grant.
--
-- No deploy order: no function changes, and the client already writes only
-- these columns, the pre ones once. Idempotent.

REVOKE UPDATE ON public.flow_reports FROM authenticated;
GRANT UPDATE (
  user_feedback_pre,
  user_feedback_pre_at,
  user_feedback_post,
  user_feedback_post_at
) ON public.flow_reports TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_pre_feedback_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_feedback_pre IS DISTINCT FROM OLD.user_feedback_pre
     OR NEW.user_feedback_pre_at IS DISTINCT FROM OLD.user_feedback_pre_at THEN
    IF OLD.user_feedback_pre IS NOT NULL OR OLD.user_feedback_pre_at IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: pre-analysis feedback can be given only once'
        USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.flow_reports
      WHERE project_id = OLD.project_id AND created_at < OLD.created_at
    ) THEN
      RAISE EXCEPTION 'Forbidden: pre-analysis feedback is only possible on a project''s first FLOW report'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_pre_feedback_once() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER enforce_pre_feedback_once
  BEFORE UPDATE OF user_feedback_pre, user_feedback_pre_at ON public.flow_reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pre_feedback_once();
