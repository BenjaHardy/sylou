

## Plan: FlowWorkProfile Visual Component

### New File: `src/components/FlowWorkProfile.tsx`

A standalone card component that presents the user's FLOW Work Profile as a personality-type reveal.

### Layout (top to bottom)

**1. Header** — 4-char code in monospace (`font-mono text-3xl tracking-widest`). Each character rendered individually: letters that met threshold (≥3) get `text-[#5D89A8] font-bold`, dashes get `text-muted-foreground/40`. Profile name below in `text-2xl font-bold`. Tagline in `text-muted-foreground italic`.

**2. Description** — The 2-3 sentence paragraph in `text-sm leading-relaxed`.

**3. Pillar Breakdown** — A row of 4 equal-width mini-cards (grid-cols-4 on desktop, grid-cols-2 on mobile). Each shows:
- Pillar letter (F/L/O/W) in a small circle
- Score value or "N/A"
- Label: "You led" (score ≥ 3, colored), "AI assisted" (score < 3, muted), or "N/A" (null, gray)
- Visual: filled circle for ≥3, outline circle for <3, dashed for null

Uses `#5D89A8` (Silver Lake Blue) for "You led" indicators, consistent with the existing FLOW report color scheme.

**4. Contextual Note** — Small muted text: "This profile reflects your collaboration style on this project."

### Props

```ts
interface FlowWorkProfileProps {
  profile: FlowProfile;
  scores: { find: number | null; lead: number | null; organize: number | null; write: number | null };
  language?: string; // default "English", unused for now
}
```

### Wrapper

Uses the existing `Card` component from `@/components/ui/card` for the outer container, keeping consistency with the design system.

### Files Changed

| File | Change |
|------|--------|
| `src/components/FlowWorkProfile.tsx` | New — standalone visual profile card component |

