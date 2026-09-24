-- Report evidence is not user-writable through the API.
--
-- Same principle as the 20260709120000 FLOW-input lockdown and the
-- 20260904120000 thread-deletion drop: rows that a shared FLOW report
-- presents as evidence must only be produced by Sylou itself. Two gaps
-- remained, both reachable with a direct PostgREST call (never through the
-- UI, which has no such features):
--
--   * flow_reports — users could INSERT a report row of their own making
--     (and then share it, generator info and all) or DELETE one. Reports
--     are now inserted by the analysis function through its service-role
--     client, behind the ownership check at request entry. Users keep
--     SELECT (viewing) and UPDATE (share toggles, pre/post feedback).
--   * writing_versions — users could DELETE versions, thinning out the
--     replay timeline a report presents. The client still INSERTs them
--     (the debounced auto-save is the legitimate writer); nothing ever
--     deletes them except a project deletion, which cascades regardless of
--     RLS (referential actions bypass it).
--
-- DEPLOY ORDER: deploy the `analysis` function (which now inserts through
-- the service role) BEFORE applying this migration. Applied first, every
-- FLOW run would fail at "Failed to store analysis report" until the
-- deploy lands.
--
-- Left as-is, deliberately: token_usage. Its user INSERT policy is
-- load-bearing by design — the RLS-scoped user client writes the usage
-- history row so the row's user_id is bound to the caller (see the
-- BillingDeps note in analysis/attempt.ts and PersistCtx in
-- context-prompt/persist.ts). The table is an audit log that neither FLOW
-- nor the budget counter reads (the counter is the security-definer
-- increment_tokens_used RPC on profiles), so a forged row affects nothing.

DROP POLICY "Users can insert own flow_reports" ON public.flow_reports;
DROP POLICY "Users can delete own flow_reports" ON public.flow_reports;
DROP POLICY "Users delete own writing_versions" ON public.writing_versions;
