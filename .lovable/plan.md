## Add "Writing" Tab to FLOW Report

A new tab will display the writing content **as it existed at the moment the FLOW analysis was run**. The snapshot is frozen — subsequent edits never modify it. A new analysis creates a new snapshot in a new report. The tab is **mandatory**: always shown in both the in-app report and shared reports, and it cannot be toggled off in share settings.

### 1. Database

Migration on `flow_reports`:
- Add `writing_snapshot text NOT NULL DEFAULT ''` — stores the HTML/text of `writing_content.content` captured at analysis time.
- Backfill existing rows with `''` (older reports will show an empty-state message in the new tab).

No share toggle column is added — the tab is always visible.

### 2. Edge function (`supabase/functions/analysis/index.ts`)

When inserting the new `flow_reports` row (~line 1108), include:
```
writing_snapshot: writingContent,
```
`writingContent` is already fetched at line 621.

### 3. Frontend — new component

`src/components/flow-report/WritingSnapshotTab.tsx`:
- Props: `{ snapshot: string; capturedAt: string; projectName?: string }`.
- Renders the snapshot inside a styled, read-only container using `dangerouslySetInnerHTML` (writing is stored as TipTap HTML — same rendering approach used elsewhere in the app for FLOW highlights).
- Header: "Writing snapshot" + small caption "Captured when this FLOW analysis ran on {date}. Later edits to the project are not reflected here."
- Empty-state for legacy reports with empty `writing_snapshot`: "No writing snapshot is available for this report (it was generated before snapshots were introduced)."

### 4. Frontend — wire into tab switchers

`src/components/FlowReportView.tsx`:
- Extend `activeTab` union to include `"writing"`.
- Add a "Writing" button in the tab switcher (between Report and Profile).
- Render `<WritingSnapshotTab />` when active.

`src/pages/SharedReport.tsx`:
- Extend `activeTab` union with `"writing"`.
- Always render the Writing tab button (no `available` gate — mandatory).
- Adjust default-tab logic so Writing is the fallback if Report is hidden.
- Update `visibleTabsCount` to always count Writing.
- Select `writing_snapshot, created_at` from `flow_reports` in the existing fetch.

### 5. Share settings UI

In the dialog that toggles `share_include_report` / `share_include_profile` / `share_include_replay`, add a non-interactive note: "The writing snapshot is always included in shared reports so reviewers can see the work that was assessed." No new toggle is added.

### 6. Out of scope

- Re-running analysis on the same report (already creates a new report row with its own snapshot — no change needed).
- Diffing the snapshot against current writing.
- Storing per-pillar excerpts (already covered by `key_user_contributions`).

### Technical notes

- The snapshot is plain HTML from TipTap; size is bounded by the same writing-budget limits already enforced before analysis runs, so no extra size guard is needed.
- RLS: `flow_reports` already exposes shared rows publicly via `share_enabled = true`; the new column inherits that policy automatically.
- `src/integrations/supabase/types.ts` regenerates automatically after migration.
