## Issue

In `src/hooks/useFlowAnalysis.ts` (line ~107), the `flow_reports` query lists every column individually but omits `writing_snapshot`. `FlowReportView.tsx` then reads `(report as any)?.writing_snapshot ?? ""`, which is always empty, so `WritingSnapshotTab` falls back to its "no snapshot available" message.

The shared/public route (`SharedReport.tsx`, querying the `flow_reports_public` view) already includes the snapshot — that path is unaffected. This regression only impacts the owner's in-app view.

## Fix

Add `writing_snapshot` to the `.select(...)` column list in `useFlowAnalysis.ts` (the query that loads the latest report for `FlowReportView`).

That's the only change required. No DB, RLS, or edge function work needed.

## Verification

- Open an existing FLOW report generated after snapshots launched → snapshot tab renders the captured HTML.
- Open an old report from before snapshots → still shows the empty-state message (because the column is genuinely empty/null).
