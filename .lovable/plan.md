# Fix: PDF export only prints first page

## Root cause

`handleExportPDF` called `window.print()` on the live app. The editor sits
inside `h-screen` / `overflow-hidden` / `min-h-0` / `ResizablePanel` ancestors
(`Index.tsx` → `ProjectContentArea` → `ResizablePanel` → editor wrapper) that
clip content to viewport height. The browser only paginated what fit in that
clipped box, so anything past the first viewport never reached the printer.

## Fix — dedicated print container

`handleExportPDF` now mounts `editor.getHTML()` into a `.print-export-root`
container appended to `<body>`, calls `window.print()`, and removes the
container in `afterprint` (with a 30 s `setTimeout` fallback for Safari).
A new `@media print` block in `src/index.css` hides every other body child
and lets the print container flow freely.

Provenance markers (`[t]/[cc]/[ce]/[ai]`) are intentionally not included —
they travel with the FLOW report and JSON export. A future enhancement could
add a provenance appendix.

## Implementation notes (decisions made during build)

### Portal hiding rule

Grep for `createPortal` in `src/` returned no matches — we don't use
`react-dom/createPortal` directly. However the app uses Radix/shadcn
primitives (Dialog, Tooltip, Toast, Popover, DropdownMenu, Sonner) which
all portal into `document.body`. Hiding only `#root` would leak any open
tooltip/toast/dialog into the print output. Picked the broader rule:

```css
body > *:not(.print-export-root) { display: none !important; }
```

### `.editor-page-sheet` cleanup

`.editor-page-sheet` is used on-screen (`WritingEditor.tsx:341`) and queried
by `src/lib/editor-extensions/pagination.ts:82`. The class must stay. Only
the `@media print` rule that re-styled it for printing was removed — the
live editor tree is hidden during print now, so those overrides are dead
code.

## Files changed

- `src/index.css` — replaced legacy ancestor-override print block with the
  `.print-export-root` rules; removed the now-redundant `.editor-page-sheet`
  `@media print` block.
- `src/components/WritingEditor.tsx` — rewrote `handleExportPDF` to build
  and tear down the print container, sanitize `document.title` for the
  PDF filename, and clean up via `afterprint` + timeout fallback.

## Verification checklist

- [ ] Paste ≥ 5 pages of mixed content (paragraphs, multiple `h2`/`h3`
      headings, bulleted and numbered lists) into the editor.
- [ ] Click Export → PDF; confirm the print preview shows all pages, not
      just page 1.
- [ ] Confirm no heading is orphaned at the bottom of a page; paragraphs
      and list items aren't split mid-block where avoidable.
- [ ] Cancel/print, confirm the app UI is fully restored (no leftover
      hidden container, title reverted).
- [ ] Trigger print while a tooltip and/or toast is visible; confirm they
      don't appear in the printed pages.
- [ ] Re-test DOCX export — unchanged code path, should still work.
- [ ] Confirm the print preview's filename is the sanitized project name.
