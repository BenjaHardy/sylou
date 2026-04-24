## Plan: Band-based FLOW scoring UI + KEY USER CONTRIBUTIONS

Numeric FLOW scores stay in DB and drive radar geometry, but are no longer rendered to the user. The UI displays descriptive bands. A new section captures and displays 3–5 key user contributions returned by the LLM.

---

### 1. New module: `src/lib/flowBands.ts`

Single source of truth for band definitions. Exports:
- `FlowBand` type and `FLOW_BANDS` array (6 bands: AI-led → Human-authored).
- `FLOW_ZONE_BOUNDARIES = [0, 0.75, 1.75, 2.75, 3.75, 4.75, 5.0]`.
- `getBandForScore(score)` and `getBandLabel(score)` helpers.
- Colors aligned with the existing Ethos palette (Silver Lake Blue family) while preserving the AI→Human visual gradient (purple → blue → green → deep-green). Each band has `color` + `bgColor` + score range. `getBandLabel(null)` → `"Insufficient evidence"`.

Adopt these labels exactly:
- AI-led (0.0–0.5)
- AI-led, human-refined (1.0–1.5)
- Collaborative (2.0–2.5)
- Human-led, AI-assisted (3.0–3.5)
- Human-led (4.0–4.5)
- Human-authored (5.0)

`shared-utils.ts`: `getScoreLabel` and `getScoreColor` are reworked to delegate to `getBandLabel` / `getBandForScore`. Remaining call sites switch to band labels — no numeric strings rendered.

---

### 2. ScoreCard (`src/components/flow-report/ScoreCard.tsx`)

- Remove the big numeric score block (`{pillar.score.toFixed(1)} / 5.0`).
- In its place, render a band badge (rounded pill) with the band color as background tint and the band label as text. Null → "Insufficient evidence" pill in muted style.
- Card outer color uses `band.bgColor` for tint (replaces `getScoreColor`).

### 3. Radar chart (`src/components/flow-report/FlowRadarChart.tsx`)

Rebuilt as a custom SVG radar (recharts polar zones aren't easily band-tinted) — keep recharts only if zone polygons are achievable with a custom layer; otherwise switch to a hand-rolled SVG so we can render concentric band-zone polygons reliably.

- Four axes (F, L, O, W), no numeric tick labels.
- Six concentric polygon zones filled with each band's `bgColor` at ~40% opacity, drawn smallest-to-largest using `FLOW_ZONE_BOUNDARIES`.
- AI signature polygon: stroke + 25% fill (same blue as today). Dashed strokes/markers for null pillars unchanged.
- Self-assessment overlay polygon: dashed stroke, different color (green for pre / orange for post), unchanged behavior.
- Tooltip on hover: shows band label only ("Find — Collaborative"), no numeric score.
- Below the chart: legend listing the 6 band colors and labels (innermost → outermost), plus AI vs self-assessment color key.

### 4. Self-assessment input (`FlowFeedbackSection.tsx`, `FlowUserAssessmentSection.tsx`)

Replace the `Slider` (0–5, half-point) with a band selector per pillar:
- 6 selectable chips/buttons per pillar, each colored with its band color and labeled with its band name.
- On submit, map the chosen band to a representative internal score (band midpoint, e.g. AI-led=0.25, AI-led-human-refined=1.25, Collaborative=2.25, Human-led-AI-assisted=3.25, Human-led=4.25, Human-authored=5.0). Store the numeric value in `user_feedback_pre`/`user_feedback_post` exactly as today, so radar overlay logic and existing reports keep working.
- Read-only display: show the band label/chip per pillar, never a number.

### 5. Self-assessment display (`SelfAssessmentDisplay.tsx`)

Replace `{score.toFixed(1)}` blocks with band chips (color + label). Comments unchanged.

### 6. FLOW Profile (`FlowWorkProfile.tsx`)

Per-pillar tile: replace `{score.toFixed(1)}` with the band label in the band color. Replace the "You led" / "AI assisted" subtitle logic with band-driven coloring (band determines whether the tile is highlighted). Profile code/name/tagline/description unchanged.

### 7. Disclaimers (`FlowInfoSection.tsx`)

- Remove the entire "How to read scores" `<div>`.
- In the "About the AI Assessment" paragraph, change "scores" → "band labels". No other content changes. Same component is used for both "About this FLOW Report" and "About this FLOW Profile" via the `title` prop — single edit covers both.

### 8. New section: KEY USER CONTRIBUTIONS

**UI** (in `FlowReportView.tsx` and `SharedReport.tsx`, inside the Report tab, immediately below the OVERALL SUMMARY block):

- New component `src/components/flow-report/KeyUserContributions.tsx`.
- Heading "KEY USER CONTRIBUTIONS" matching OVERALL SUMMARY style.
- Reads `report.key_user_contributions` (new column). If absent or empty array, render nothing (gracefully hide for legacy reports). If exactly one item with contribution = "Not applicable", render it as a single muted note.
- Each item: bold contribution sentence, muted "Evidence: …" line, normal "Why it matters: …" line. Card-style background like OVERALL SUMMARY.

**Data layer**:
- Add column `key_user_contributions JSONB NULL` to `flow_reports` (migration).
- Extend `FlowReport` interface in `useFlowAnalysis.ts` and the select lists in `useFlowAnalysis.loadLatestReport`, `SharedReport.tsx`, and `export-json.ts`.

**Edge function (`supabase/functions/analysis/index.ts`)**:
- Extend `SUBMIT_FLOW_TOOL.input_schema`:
  - Add `key_user_contributions` array (items: `{contribution, evidence, why_it_matters}`, all required), `minItems: 0`, `maxItems: 5`.
  - Add `"key_user_contributions"` to top-level `required`.
- Append a new STEP 8 to both prompt templates (standard + creative) right after STEP 7:
  > "STEP 8: Identify 3–5 key user contributions. These are specific, concrete moments where the user's thinking, judgment, knowledge, or creativity meaningfully shaped the final work. If there are genuinely fewer than 3 clear user contributions, return whatever is well-supported by evidence. Do not fabricate contributions to reach 3."
- Persist `key_user_contributions: flowResult.key_user_contributions ?? []` in the `flow_reports` insert.

### 9. Pledge badge (`FlowPledgeBadge.tsx`)

Optional polish: keep numeric polygon math (badge isn't user-facing text), but remove the small implied "score" — it doesn't render numbers today, so no change needed.

### 10. JSON export (`src/lib/export-json.ts`)

Update the `flow_reports` select to include `key_user_contributions`. The existing JSON export already exposes raw numeric scores in `ai_find/lead/organize/write` (each contains `score`); the spec's "internal score alongside band label" is satisfied by post-processing each pillar entry to add `band_label: getBandLabel(p.score)` while keeping the existing `score` field. No schema break.

### 11. Backward compatibility

- Existing reports (numeric scores already stored) work unchanged — UI derives band labels via `getBandLabel(score)` at render time.
- Existing reports without `key_user_contributions` simply hide the new section.
- Existing self-assessments stored as floats remain valid; on display they map to the nearest band via `getBandForScore`.

---

### Files Changed

| File | Change |
|------|--------|
| `src/lib/flowBands.ts` | NEW — single source of truth for bands |
| `src/components/flow-report/shared-utils.ts` | Delegate `getScoreLabel`/`getScoreColor` to bands |
| `src/components/flow-report/ScoreCard.tsx` | Replace numeric score with band pill |
| `src/components/flow-report/FlowRadarChart.tsx` | Custom SVG with band zones, no numeric ticks, band-only tooltip, legend |
| `src/components/FlowFeedbackSection.tsx` | Band-selector UI; map to midpoint score on submit |
| `src/components/FlowUserAssessmentSection.tsx` | Same band-selector treatment + read-only chips |
| `src/components/flow-report/SelfAssessmentDisplay.tsx` | Band chips instead of `toFixed(1)` |
| `src/components/FlowWorkProfile.tsx` | Band labels instead of numeric scores per tile |
| `src/components/flow-report/FlowInfoSection.tsx` | Remove "How to read scores"; rename "scores" → "band labels" |
| `src/components/flow-report/KeyUserContributions.tsx` | NEW — renders the new section |
| `src/components/FlowReportView.tsx` | Insert `<KeyUserContributions>` below OVERALL SUMMARY |
| `src/pages/SharedReport.tsx` | Same insertion + extend select list |
| `src/hooks/useFlowAnalysis.ts` | Type + select list include `key_user_contributions` |
| `src/lib/export-json.ts` | Include `key_user_contributions`; enrich each pillar with `band_label` |
| `supabase/functions/analysis/index.ts` | Add STEP 8 to both prompts; extend tool schema; persist new field |
| `supabase/migrations/<timestamp>_add_key_user_contributions.sql` | `ALTER TABLE flow_reports ADD COLUMN key_user_contributions JSONB` |

