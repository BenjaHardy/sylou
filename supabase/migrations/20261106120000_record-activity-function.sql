-- Activity time is recorded by the server.
--
-- While a project is open and in use (visible tab, mouse or keyboard used in
-- the last 5 minutes), the app sends a heartbeat every 30 seconds
-- (useActivityTracker). record_activity adds the time by the database's
-- clock, so the totals grow no faster than real time:
--
-- 1. last_activity_at holds the moment up to which time has been counted
--    (the row's created_at before the first heartbeat). A heartbeat adds the
--    whole seconds since then, at most 30, and moves it forward by what it
--    added, so fractions of a second count at the next heartbeat.
-- 2. After a pause of a minute or more, a heartbeat adds 30 seconds and
--    counting restarts from now: the time away is never added.
-- 3. A moment more than a minute ahead of the clock (written by a browser
--    clock before this change) restarts from now; one slightly ahead
--    (another heartbeat was counted a moment ago) adds nothing.
-- 4. Writing time gets the same seconds when the app reports an edit in the
--    last 5 minutes.
--
-- clock_anomaly_count, which counted browser clocks going backwards, no
-- longer changes. The function is callable by signed-in users, for their own
-- projects only, and runs with its owner's rights: users can only read
-- project_stats from 20261106130000 on.
--
-- Deploy order: apply before the app that calls it goes live, and
-- 20261106130000 once that app is live. Idempotent.

CREATE OR REPLACE FUNCTION public.record_activity(_project_id uuid, _writing boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _counted_to timestamptz;
  _seconds integer := 0;
BEGIN
  IF NOT public.owns_project(_project_id) THEN
    RAISE EXCEPTION 'Forbidden: cannot record activity on another user''s project'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(last_activity_at, created_at) INTO _counted_to
  FROM public.project_stats
  WHERE project_id = _project_id
  FOR UPDATE;

  IF _counted_to > now() + interval '1 minute' THEN
    _counted_to := now();
  ELSIF now() - _counted_to >= interval '1 minute' THEN
    _seconds := 30;
    _counted_to := now();
  ELSIF now() > _counted_to THEN
    _seconds := least(30, floor(extract(epoch FROM now() - _counted_to)));
    _counted_to := _counted_to + make_interval(secs => _seconds);
  END IF;

  UPDATE public.project_stats
  SET total_active_time_seconds = total_active_time_seconds + _seconds,
      total_writing_time_seconds = total_writing_time_seconds
        + CASE WHEN _writing THEN _seconds ELSE 0 END,
      first_activity_at = coalesce(first_activity_at, now()),
      last_activity_at = _counted_to
  WHERE project_id = _project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_activity(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_activity(uuid, boolean) TO authenticated;
