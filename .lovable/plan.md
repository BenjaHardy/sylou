

## Plan: FLOW Pillar Card Color Gradient — Blank to Silver Lake Blue

### Concept

Replace the current red→orange→yellow→green spectrum with a single-hue progression from neutral/blank (score 0) to "Silver Lake Blue" (score 5). Silver Lake Blue is approximately `#5D89A8` / HSL(203, 30%, 51%).

### Change: `src/components/flow-report/shared-utils.ts`

Replace `getScoreColor` with a function that returns **inline style** (via a new approach) or uses Tailwind arbitrary values to produce a progressive blue tint:

| Score | Appearance | Tailwind classes |
|-------|-----------|-----------------|
| null | Muted (unchanged) | `bg-muted text-muted-foreground` |
| 0–1 | Very faint blue-gray | `bg-[#5D89A8]/5 text-[#5D89A8]/40 border-[#5D89A8]/10` |
| 1–2 | Light blue tint | `bg-[#5D89A8]/10 text-[#5D89A8]/60 border-[#5D89A8]/20` |
| 2–3 | Medium blue | `bg-[#5D89A8]/15 text-[#5D89A8]/70 border-[#5D89A8]/30` |
| 3–4 | Stronger blue | `bg-[#5D89A8]/20 text-[#5D89A8]/80 border-[#5D89A8]/35` |
| 4–5 | Full Silver Lake Blue | `bg-[#5D89A8]/25 text-[#5D89A8] border-[#5D89A8]/40` |

### Files Changed

| File | Change |
|------|--------|
| `src/components/flow-report/shared-utils.ts` | Replace `getScoreColor` thresholds with blank→silver-lake-blue gradient |

No changes needed in `ScoreCard.tsx` or `SharedReport.tsx` — they already consume `getScoreColor` and apply the returned classes.

