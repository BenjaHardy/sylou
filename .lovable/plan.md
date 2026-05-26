# Mirror FLOW Report extras into FLOW Profile tab

Two small additions so the FLOW Profile tab shows the same pillar tooltips and quantitative footer as the FLOW Report tab.

## 1. Pillar tooltips on the Profile card

File: `src/components/FlowWorkProfile.tsx`

- Import `Tooltip`, `TooltipContent`, `TooltipProvider`, `TooltipTrigger` from `@/components/ui/tooltip`, and `PILLAR_TOOLTIPS` from `@/components/flow-report/shared-utils`.
- Wrap each pillar tile's letter circle (the F / L / O / W disc) in a `Tooltip` whose `TooltipContent` shows `PILLAR_TOOLTIPS[key]`, matching the ScoreCard pattern (`side="top"`, `max-w-xs text-xs`, `cursor-help` on the trigger).
- Single shared `TooltipProvider` wrapping the pillar grid is fine.

No changes to copy or layout — only adds hover behavior identical to the FLOW Report's ScoreCard tooltips.

## 2. Token Usage + Project Activity at the bottom of the Profile tab

File: `src/components/flow-report/ProfileTabContent.tsx`

- Extend props with optional `flowMeta?: FlowReport["flow_meta"]` and `metricsSnapshot?: FlowReport["metrics_snapshot"]`.
- Below the existing content (after `SelfAssessmentDisplay`), render — when present — the same blocks that appear in `FlowReportView`:
  - `<TokenUsageSection meta={flowMeta} />`
  - The two `imported_documents_mode` info notices (`summaries` / `excluded`) using the same markup.
  - `<ProjectActivitySection metrics={metricsSnapshot} />`

Files: `src/components/FlowReportView.tsx` and `src/pages/SharedReport.tsx`

- Pass `flowMeta={report.flow_meta}` and `metricsSnapshot={report.metrics_snapshot}` to `ProfileTabContent`. Figures will therefore be identical to the FLOW Report tab (same source data).

No new components, no backend changes, no behavior changes elsewhere.
