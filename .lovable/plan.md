

## Plan: Add User Feedback to Shared Report with Opt-in Control

### Summary

Add a `share_include_feedback` boolean column to `flow_reports`, a checkbox in the sharing controls, and render read-only pre/post feedback on the shared report page when the flag is true.

### Database Migration

```sql
ALTER TABLE public.flow_reports
  ADD COLUMN IF NOT EXISTS share_include_feedback boolean NOT NULL DEFAULT false;
```

### Changes

#### 1. Edge function: `supabase/functions/share-report/index.ts`

- Accept `share_include_feedback` (boolean) in the toggle action body
- Update it alongside `share_enabled` when toggling
- On initial share (POST), default `share_include_feedback` to `false`

#### 2. Sharing controls: `src/components/FlowReportView.tsx`

- Add local state `shareIncludeFeedback` synced from `report.share_include_feedback`
- When `shareToken && shareEnabled`, render a checkbox: "Include my self-assessment in shared report" (default off)
- On checkbox change, call `share-report` toggle with `{ report_id, action: "toggle", share_include_feedback: newValue }`

#### 3. Shared report page: `src/pages/SharedReport.tsx`

- Add `user_feedback_pre, user_feedback_post, share_include_feedback` to the explicit `.select()` list
- When `share_include_feedback` is true and feedback data exists, render read-only displays:
  - **Pre-analysis feedback**: A simple read-only card showing the 4 pillar scores (reuse the layout from `FlowFeedbackSection`'s submitted view, but inline it to avoid importing the interactive component)
  - **Post-analysis feedback**: A read-only card showing scores + comments (reuse the layout from `FlowUserAssessmentSection`'s read-only view, minus the Edit button)
- When `share_include_feedback` is false, render nothing for feedback

#### 4. Type update: `src/hooks/useFlowAnalysis.ts`

- Add `share_include_feedback?: boolean` to `FlowReport` interface

### Technical Details

- The read-only feedback rendering in `SharedReport.tsx` will be inline JSX (not importing `FlowFeedbackSection` or `FlowUserAssessmentSection`) to avoid pulling in interactive editing logic and to keep the public page fully read-only
- The `extractUserAssessment` and `extractFeedbackScores` helpers from `shared-utils.ts` will be used to safely parse the JSONB feedback data

### Files Changed

| File | Change |
|------|--------|
| Migration | Add `share_include_feedback` column |
| `supabase/functions/share-report/index.ts` | Handle `share_include_feedback` in toggle |
| `src/components/FlowReportView.tsx` | Add checkbox in sharing controls |
| `src/pages/SharedReport.tsx` | Fetch and render read-only feedback |
| `src/hooks/useFlowAnalysis.ts` | Add `share_include_feedback` to interface |

