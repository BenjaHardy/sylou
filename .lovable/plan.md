## Plan: FLOW Band Recolor + Expanded Disclaimer

### 1. New band color palette

The current bands run purple → silver-blue → green. We'll replace them with a **purple → off-white/light grey → blue** gradient, with the neutral grey sitting at the "Collaborative" midpoint as a clear visual pivot between AI-led and Human-authored sides.

Proposed palette (each band has a main color for text/borders/chips and a tinted background for radar zones):

| # | Label | Main color | Background tint | Notes |
|---|---|---|---|---|
| 1 | AI-led | `#6B2D8E` (deep purple) | `#EFE4F3` | Strongest purple — anchors the AI side |
| 2 | AI-led, human-refined | `#A06CB8` (muted lavender) | `#F3EAF6` | Softer purple |
| 3 | Collaborative | `#8A8F96` (slate grey) | `#F1F1F0` (warm off-white) | Neutral pivot — text uses slate grey for contrast on the off-white tint |
| 4 | Human-led, AI-assisted | `#5D89A8` (Silver Lake Blue — already a brand color) | `#E6EEF5` | Bridges grey into blue |
| 5 | Human-led | `#2F6699` (mid blue) | `#DCE7F1` | Stronger blue |
| 6 | Human-authored | `#1B4A7A` (deep navy blue) | `#CFDDEA` | Anchors the Human side |

Why these choices:
- The neutral "Collaborative" band is a warm off-white background with a slate-grey accent — it reads as genuinely neutral on a light theme without disappearing into the page.
- The blue side ends at a deep navy that mirrors the visual weight of the deep purple on the AI side, so neither end dominates.
- `#5D89A8` (Silver Lake Blue) already exists in the Ethos palette and is reused here for continuity.
- All tints have enough contrast against the white card background to remain visible as concentric radar zones.

These palette values are the proposal. If you'd prefer a cooler grey, a darker pivot, or a different blue family (e.g. teal-leaning), say so and I'll adjust before applying.

### 2. Where the change propagates automatically

Because every band-aware UI element reads from `FLOW_BANDS` in `src/lib/flowBands.ts`, updating that single source of truth will cascade to:

- Radar chart concentric zones and legend swatches (`FlowRadarChart.tsx`)
- Pillar score chips (`ScoreCard.tsx`)
- Self-assessment band chips and selector (`BandSelector.tsx`, `FlowFeedbackSection.tsx`, `FlowUserAssessmentSection.tsx`, `SelfAssessmentDisplay.tsx`)
- Work profile band labels (`FlowWorkProfile.tsx`)
- Shared report (`SharedReport.tsx`) — same components
- JSON export `band_label` strings (unchanged, only colors move)

No other files need code changes for the recolor.

### 3. Disclaimer update

Edit `src/components/flow-report/FlowInfoSection.tsx`. Inside the "About the AI Assessment" block, append a new paragraph after the existing one:

> "Additionally, the more the user has used Ethos for their meaningful work-related queries (not using external AI), the more the feedback is relevant."

This component is already shared by both surfaces, so the update appears in:
- "About this FLOW Report" (FLOW Report tab)
- "About this FLOW Profile" (Profile tab — same component, different `title` prop)

### Files to modify

- `src/lib/flowBands.ts` — replace the six `color` / `bgColor` values per the table above
- `src/components/flow-report/FlowInfoSection.tsx` — add the new paragraph at the end of the "About the AI Assessment" section

No database, edge function, or schema changes required.
