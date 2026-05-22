## Goal

Add a second downloadable FLOW Pledge Badge variant (Profile) next to the existing radar-chart one in the Share Report section. Both badges get a "Visit www.meetsylou.eu" footer line baked into the PNG.

## Changes

### 1. `src/components/flow-report/FlowPledgeBadge.tsx`
- Add a `variant: "radar" | "profile"` prop (default `"radar"` to preserve current behavior).
- Add `profile?: { code, name, tagline }` prop (only used when `variant === "profile"`).
- Increase canvas height (~+16px) to fit a centered footer line: **"Visit www.meetsylou.eu"** (small muted text, ~9px), drawn on both variants above the certificate ID line.
- New `drawProfileBadge` rendering path:
  - Header: "Created with Sylou" (small) + "FLOW Analysed" (blue, bold) — same as radar variant for consistency.
  - Right side replaces the radar with the upper Profile card content:
    - Small "FLOW" label in Silver Lake Blue (muted), letter-spaced.
    - Profile name (e.g., "The Architect") bold, ~14px.
    - Italic tagline (e.g., "You built this from the ground up."), small, muted, wrapped to fit width.
  - Same rounded border, certificate ID footer, and "Visit www.meetsylou.eu" line.
- Download filename becomes `flow-badge-${variant}-${certificateId}.png`.

### 2. `src/components/FlowReportView.tsx` (around line 617-629)
- Compute `flowProfile` (already available as `flowProfile` from `getFlowProfile(flowScores)`).
- Replace the single badge slot with a row holding both:
  - Left: `<FlowPledgeBadge variant="radar" ... />` labeled "FLOW Pledge Badge (Radar Chart)".
  - Right: `<FlowPledgeBadge variant="profile" profile={{code, name, tagline}} ... />` labeled "FLOW Pledge Badge (Profile)".
- Adjust the surrounding grid: change the QR+Badges block from `grid-cols-2` to a vertically stacked layout where QR sits on its own row and the two badges share a `grid-cols-1 sm:grid-cols-2` row below, so nothing gets cramped at narrow widths.

### Technical notes
- All drawing stays in Canvas 2D (no new deps), reusing the existing DPR-aware `drawBadge` scaffolding.
- Text wrapping for the tagline: simple word-wrap helper inside the component (max 2 lines, ellipsis if longer) so longer profile taglines stay inside the badge.
- Footer URL string lives as a constant `BADGE_FOOTER_URL = "Visit www.meetsylou.eu"` at top of the file (per user request — not derived from `PUBLIC_SITE_URL`, since that domain differs).
