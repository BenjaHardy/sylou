

## Plan: Black Text on FLOW Pillar Cards

### Change

In `getScoreColor` (`src/components/flow-report/shared-utils.ts`), replace the `text-[#5D89A8]...` classes with `text-foreground` (which resolves to black in light mode, white in dark mode) for all scored states. Keep backgrounds and borders as-is.

### Readability check

The darkest card (score 5) has `bg-[#5D89A8]/25` — Silver Lake Blue at 25% opacity over a white card surface yields roughly `#D6E2EA`. Black on that light blue-gray gives a contrast ratio of ~14:1, well above WCAG AAA.

### Updated `getScoreColor` (lines 23–30)

```ts
export function getScoreColor(score: number | null): string {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 4.0) return "bg-[#5D89A8]/25 text-foreground border-[#5D89A8]/40";
  if (score >= 3.0) return "bg-[#5D89A8]/20 text-foreground border-[#5D89A8]/35";
  if (score >= 2.0) return "bg-[#5D89A8]/15 text-foreground border-[#5D89A8]/30";
  if (score >= 1.0) return "bg-[#5D89A8]/10 text-foreground border-[#5D89A8]/20";
  return "bg-[#5D89A8]/5 text-foreground border-[#5D89A8]/10";
}
```

### Files Changed

| File | Change |
|------|--------|
| `src/components/flow-report/shared-utils.ts` | Replace `text-[#5D89A8]` variants with `text-foreground` |

