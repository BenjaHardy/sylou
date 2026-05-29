## Changes

### 1. `src/components/flow-report/FlowReportFooter.tsx`
Remove the sentence "FLOW is a proprietary analytical framework by Sylou." The footer keeps:
- "Powered by Sylou — AI-Use Transparency" (link)
- "Learn more at www.meetsylou.eu" (trailing line)

### 2. `src/components/FlowReportView.tsx`
The metadata block (Model/Generated/Project) + `<FlowReportFooter />` currently render only inside the FLOW Report tab (lines 762–771).

Render the same block at the bottom of:
- FLOW Report tab (existing — unchanged)
- FLOW Profile tab (new — append after `<ProfileTabContent />`)

Replay and Writing tabs: no change. Uses existing values (`report.model_used` via `MODEL_LABELS`, `report.created_at`, `projectName`); no new props/data.

### 3. `src/pages/SharedReport.tsx` (public share view)
Apply the same two changes:
- Footer copy update inherited automatically via `FlowReportFooter` (shared component, if used). If `SharedReport.tsx` inlines its own footer, edit it to match.
- Render the metadata + footer block at the bottom of both the FLOW Report and FLOW Profile sections/tabs (whichever the share view exposes); skip Replay and Writing.

Will read `SharedReport.tsx` during build to confirm whether it uses `FlowReportFooter` directly or duplicates the markup, then apply minimal edits accordingly.

### Out of scope
No styling changes beyond placement.
