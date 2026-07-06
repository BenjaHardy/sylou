-- Token-gated access to shared FLOW reports (step 2 of 2).
--
-- Companion to 20260704000000. Removes direct SELECT on the sanitized
-- flow_reports_public view from the anon and authenticated API roles, so the
-- ONLY way to read a shared report is via get_shared_report(_token) with the
-- exact token. This is the statement that actually closes the enumeration.
--
-- The SECURITY DEFINER function is unaffected: it runs as its owner, which
-- retains access to the view. No application code selects the view directly
-- after the frontend switch (only src/pages/SharedReport.tsx did, and it now
-- calls the RPC).
--
-- APPLY ORDER: apply this ONLY AFTER the frontend calling get_shared_report()
-- is deployed. Applying it while the old frontend is still served would make
-- shared links return "not found" until the new frontend goes live.
--
-- Idempotent: REVOKE of an already-absent grant is a no-op.

REVOKE SELECT ON public.flow_reports_public FROM anon, authenticated;
