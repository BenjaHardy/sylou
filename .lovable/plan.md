# Automatic page breaks in the writing editor

Add real visual page breaks to the existing A4 page-view mode, using a ProseMirror plugin that measures block heights and inserts spacer + page-number decorations. No changes to the document, undo, save, provenance, export, or print pipelines.

## Scope

- Active only when the existing `pageView` toggle is on.
- Session-only (matches the toggle's persistence).
- Visual + on-screen only. PDF/print continues to use today's flat layout.
- Page numbers shown as small labels in the right margin of each page.

## How it works

1. The A4 sheet's inner content area has a known fixed height: `A4_HEIGHT - 2 * PAGE_MARGIN` (≈ 29.7cm − 2 × 2.5cm = 24.7cm). Computed once from CSS custom properties so the values stay in sync with the sheet styling.
2. A ProseMirror plugin (`pagination`) observes the editor:
   - On every transaction (debounced ~150ms via `requestAnimationFrame` + timeout) and on container `ResizeObserver` events, it walks the top-level block DOM children of the editor root.
   - For each block it reads `offsetTop` and `offsetHeight` relative to the editor root.
   - It tracks `currentPageBottom` (initialized to `pageContentHeight`). When a block's bottom would exceed `currentPageBottom`, it records a break before that block: the spacer height equals `currentPageBottom - blockTop + pageGap`, where `pageGap` is the visual gutter between sheets (e.g. 1.5cm).
   - Then advances `currentPageBottom += pageContentHeight + pageGap` and continues.
3. The plugin produces a `DecorationSet` of widget decorations:
   - **Spacer widget** before each break position: a non-editable `<div>` with the computed `margin-top` (or `height`) and a grey background matching the backdrop, so it reads as the inter-page gutter.
   - **Page-number widget** at the top of each page: a small absolutely-positioned `<span>` in the right margin showing "Page N".
4. Decorations are recomputed only when (a) the doc changes, (b) the editor width changes, or (c) the toggle flips. They are torn down when `pageView` is off.

### Edge cases handled

- **Oversized single block** (paragraph or image taller than a page): no break inserted inside it; it simply spills past its page boundary. Acceptable for v1.
- **Images loading after initial measure**: the `ResizeObserver` on the editor root catches the height change and reruns the pass.
- **Selection/cursor**: widget decorations are non-editable and `side: -1`, so they never become a selection target and don't shift cursor positions.
- **Provenance**: zero document mutations means the existing provenance mapping is unaffected.

## Files to change

1. **`src/lib/editor-extensions/pagination.ts`** (new)
   - TipTap `Extension.create({ name: 'pagination' })` that registers a ProseMirror plugin.
   - Plugin owns the `DecorationSet`, the `ResizeObserver`, and the debounced recompute.
   - Reads `pageContentHeight`, `pageGap`, `pageMargin` from CSS variables on the editor's nearest `.editor-page-sheet` ancestor (with sensible JS fallbacks).
   - Exposes an `enabled` storage flag toggled via `editor.commands.setPaginationEnabled(boolean)`.

2. **`src/components/WritingEditor.tsx`**
   - Register the new extension in the TipTap `extensions` array.
   - In the existing `useEffect` (or a new one keyed on `pageView`), call `editor?.commands.setPaginationEnabled(pageView)`.
   - No structural changes to the sheet wrapper from the previous step.

3. **`src/index.css`**
   - Add CSS variables on `.editor-page-sheet`: `--page-content-height`, `--page-gap`, `--page-margin`.
   - Style `.pm-page-spacer` (grey gutter look matching `bg-muted`) and `.pm-page-number` (small, muted-foreground, positioned in the right margin).
   - Ensure `@media print` hides both decorations (they are screen-only).

## Out of scope (for this iteration)

- Real PDF/print pagination (would need `@page` CSS + per-block `break-inside: avoid` and a separate render path).
- Manual page-break insertion via toolbar / shortcut.
- Splitting oversized single blocks across pages.
- Headers/footers per page.

If automatic breaks feel right, we can layer those on next.
