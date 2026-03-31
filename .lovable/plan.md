

## Fix: Post-its Panel Blank Screen

### Root Cause

`ProjectContentArea` returns a React fragment (`<>...</>`) containing up to three children: the FLOW report, the PostItsPanel, and the editor div. Since fragments don't create DOM elements, all three become direct children of the `flex` container in `Index.tsx`. When PostItsPanel renders, it has `flex-1 h-screen` but competes with the hidden editor div (which also has `flex-1 h-screen` with `display: none`). The result is layout confusion — the PostItsPanel doesn't size correctly and appears blank.

### Fix

**`src/components/ProjectContentArea.tsx`** — two changes:

1. **PostItsPanel**: Change `h-screen` to `h-full` and wrap it in a sizing container within ProjectContentArea that ensures it fills the space properly. Specifically, change the fragment wrapper to a single `div` with `className="flex-1 flex flex-col"` so there's one flex child for the parent layout.

2. **PostItsPanel.tsx**: 
   - Change outer container from `h-screen` to `h-full`
   - Add a visible canvas background (subtle dot-grid CSS pattern via `bg-muted/40` + radial-gradient) so the empty state is clearly distinguishable from a blank page
   - Enlarge the empty-state prompt with a `StickyNote` icon

### Detail

In `ProjectContentArea.tsx`, replace the fragment `<>...</>` with a wrapper `<div className="flex-1 flex flex-col overflow-hidden">` so the component is a single flex child. The FLOW report, PostItsPanel, and editor div all render inside this wrapper and their `flex-1` + `display: none` toggling works correctly within this local flex context.

In `PostItsPanel.tsx`, change `h-screen` → `h-full` on the outer div, and add a subtle dot-grid background pattern to the canvas area so it reads as an interactive space rather than a blank white page.

