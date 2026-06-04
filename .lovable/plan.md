## Objective
Add a "Not applicable" option to the band selector used in both pre-analysis (`FlowFeedbackSection`) and post-analysis (`FlowUserAssessmentSection`) self-assessment flows, so users can indicate a pillar is irrelevant to their project.

## Background

Currently the self-assessment UI offers six FLOW bands (AI-led through Human-authored) for each pillar. The internal `FlowFeedback` type stores `number` scores. The user wants a seventh "Not applicable" option. Since `null` is already the representation for "no score / insufficient evidence" in downstream components (radar chart, profile computation), using `null` for "Not applicable" is the cleanest approach.

## Changes

### 1. Type system — `src/hooks/useFlowAnalysis.ts`
Change `FlowFeedback` from `Record<string, number>` to `Record<string, number | null>`:
```
find: number | null;
lead: number | null;
organize: number | null;
write: number | null;
```
The JSONB database columns already accept `null` values.

### 2. BandSelector — `src/components/flow-report/BandSelector.tsx`
- Add a "Not applicable" chip after the six FLOW band chips.
- Style: muted gray/neutral appearance, distinct from the colored band chips.
- Clicking it calls `onChange(null)`.
- The `onChange` prop type changes from `(score: number) => void` to `(score: number | null) => void`.

### 3. Pre-analysis feedback — `src/components/FlowFeedbackSection.tsx`
- Update `values` state type to `FlowFeedback` (now with nullable scores).
- Read-only view: when a score is `null`, render the chip as "Not applicable" instead of "—".

### 4. Post-analysis assessment — `src/components/FlowUserAssessmentSection.tsx`
- Update `scores` state type to match the new `FlowFeedback`.
- Read-only view: when a score is `null`, render "Not applicable".

### 5. Display components

**`src/components/flow-report/SelfAssessmentDisplay.tsx`**
- In `BandChip`, render `null` user scores as "Not applicable" instead of falling through to `getBandLabel` (which returns "Insufficient evidence" — an AI-assessment concept, not a user choice).

**`src/components/flow-report/FlowRadarChart.tsx`**
- Already handles `null` scores (renders at radius 0 with dashed markers). No changes needed.

**`src/lib/flow-work-profiles.ts`**
- `getProfileCode` already treats `null` as `0` (`scores.find ?? 0`), which maps to "-" in the 4-char code. This is acceptable: a "Not applicable" pillar is treated as "not a human-led pillar" for profile purposes.

### 6. Type-safety sweep
- Verify all call sites of `BandSelector` compile after the `onChange` signature change.
- Verify `extractFeedbackScores` and `extractUserAssessment` in `shared-utils.ts` handle the new nullable shape correctly.

## Out of scope
- No database migration needed (JSONB already supports null).
- No edge function changes needed.
- No changes to AI analysis scoring (those scores remain `number | null` as they already were).

## Verification
1. Trigger a FLOW analysis on a fresh project.
2. In the pre-analysis self-assessment, select "Not applicable" for one or more pillars and submit.
3. Confirm the read-only view shows "Not applicable" for those pillars.
4. Confirm the radar chart renders the user polygon with those points at the center (radius 0).
5. Check the post-analysis self-assessment also offers the "Not applicable" option.