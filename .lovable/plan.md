

## Plan: Update Color Palette from Warm Beige to Blue-Gray

### Summary

Replace the warm beige/parchment tones with a cohesive blue-gray palette anchored on `#99B6D6`, updating all related CSS custom properties in `src/index.css`. No component files need changes — they all reference the CSS variables via `hsl(var(--...))` or Tailwind tokens.

### Color Mapping

| Token | Current HSL | Current Hex | New HSL | New Hex |
|-------|-------------|-------------|---------|---------|
| `--background` | `0 20% 98%` | #FBF9F8 | `0 0% 98%` | #FAFAFA |
| `--sidebar-background` | `34 12% 92%` | #EDE9E4 | `210 42% 72%` | #99B6D6 |
| `--sidebar-accent` | `27 14% 87%` | #E2DDD6 | `210 38% 63%` | #839FBF |
| `--ethos-surface` | `34 12% 92%` | #EDE9E4 | `210 42% 72%` | #99B6D6 |
| `--ethos-navy` | `27 18% 92%` | #EEE9E2 | `210 42% 72%` | #99B6D6 |
| `--ethos-navy-light` | `27 14% 87%` | #E2DDD6 | `210 38% 63%` | #839FBF |

### What Changes

**Single file**: `src/index.css` — update 6 CSS custom property values in the `:root` block.

### What's NOT Changed

- No component files — all 12+ files referencing these tokens use CSS variables, so they update automatically
- Dark mode values (unchanged)
- Primary blue, foreground, card, muted, destructive, border, ring tokens
- Tailwind config (reads from CSS variables)

### Contrast Check

- Foreground `#1D1E2E` on new `#99B6D6` background: ~4.1:1 contrast ratio (meets AA for large text; sidebar text is typically nav items with adequate size)
- Foreground on `#FAFAFA` background: ~15:1 (excellent)
- Sidebar accent foreground on `#839FBF`: ~3.5:1 (adequate for interactive hover states)

