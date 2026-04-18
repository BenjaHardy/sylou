

## Plan: FLOW Report Restructure (Tabs, Sharing, Profile Sub-Tabs)

### Database Changes

Add two new columns to `flow_reports`:
- `share_include_report BOOLEAN DEFAULT TRUE`
- `share_include_profile BOOLEAN DEFAULT TRUE`

Both default to `true` so existing shares keep working. UI enforces "at least one selected".

### 1. FLOW Report Tab Changes (`FlowReportView.tsx`)

**Top-level tabs** (3 buttons): `FLOW Report` | `FLOW Profile` | `Replay`
- Add `"replay"` to the `activeTab` union type
- Replay tab shows the `FlowReplayOverlay` content inline. Lazy-loads snapshot on first click via existing `handleLoadReplay`.
- Remove the standalone "Replay" button currently next to "View Highlighted Text".
- Disable Replay tab button (muted + tooltip) if no replay snapshot exists.

**Share Report section** — replace existing checkboxes with:
- "Sections to include" group: `[ ] FLOW Report` `[ ] FLOW Profile` (UI prevents unchecking the last one)
- `[ ] Include my self-assessment in shared report` — applies to whichever of Report/Profile is selected
- `[ ] Include project replay in shared report` — kept as-is, independent of Report/Profile selection
- Each checkbox calls `share-report` toggle action.

### 2. FLOW Profile Tab Changes (`FlowReportView.tsx`)

Top to bottom:

1. **"About this FLOW Profile" section** — reuse `FlowInfoSection` with optional `title` prop (default `"About this FLOW Report"`), pass `"About this FLOW Profile"`. Body text identical.

2. **Sub-tabs for profile assessment source** — only render if self-assessment exists:
   - `AI assessment` (default, always shown)
   - `Self-assessment - pre-analysis feedback` (if `user_feedback_pre` exists)
   - `Self-assessment - post-analysis feedback` (if `user_feedback_post` exists)
   - Compute three profiles via `getFlowProfile()` from each score set.
   - Heading reads "Your Collaboration Profile (AI assessment)" etc.
   - Card-flip animation re-triggered on sub-tab change via `key` prop.

3. **Self-assessment scores display** below the profile card — only if available. Uses the same compact 4-column grid pattern from `SharedReport.tsx` (pre + post grids + comments).

### 3. Shared Report Changes (`SharedReport.tsx`)

- Read `share_include_report`, `share_include_profile`, `share_include_replay` flags.
- **Tab switcher** is conditional on which sections are included:
  - Both Report+Profile shared → both tabs shown
  - Only one shared → that tab is the default and only one
  - **Replay tab** appears as long as `share_include_replay` is true, regardless of whether Report or Profile (or both) are shared. So a profile-only share with replay enabled shows: `FLOW Profile` | `Replay`.
- Default active tab: Report if shared, else Profile, else Replay.
- Profile tab mirrors internal: "About this FLOW Profile" + sub-tabs + self-assessment (gated by `share_include_feedback`).
- "Beta" badge removed from Replay overlay header.
- Standalone Replay button at bottom of report removed.

### 4. Edge Function (`share-report/index.ts`)

Extend `toggle` action to accept `share_include_report` and `share_include_profile` boolean fields and write them to `flow_reports`.

### 5. Replay Overlay (`FlowReplayOverlay.tsx`)

Remove the `<Badge>Beta</Badge>` block.

### Files Changed

| File | Change |
|------|--------|
| New migration SQL | Add `share_include_report`, `share_include_profile` (default true) |
| `src/components/FlowReportView.tsx` | 3 top-level tabs, restructured Profile tab with About + sub-tabs + self-assessment, updated share controls |
| `src/components/flow-report/FlowInfoSection.tsx` | Accept optional `title` prop |
| `src/pages/SharedReport.tsx` | Conditional tabs (Replay independent of Report/Profile selection), restructured Profile tab |
| `src/components/FlowReplayOverlay.tsx` | Remove "Beta" badge |
| `supabase/functions/share-report/index.ts` | Accept new toggle fields |

