## Page View for the Writing Editor

Add a toggleable "Page View" that renders the editor content on a single A4-width sheet floating on a grey backdrop, with realistic page margins — visually evoking a traditional word processor. The default remains the current edge-to-edge view.

### Behavior
- Toggle lives in `EditorToolbar` as a new icon button (Lucide `FileText` icon), with a tooltip "Page view".
- Session-only state: managed locally in `WritingEditor` via `useState`, no persistence.
- When ON:
  - Editor scroll container gets a muted grey background.
  - `EditorContent` is wrapped in a centered A4 sheet: `width: 21cm`, `min-height: 29.7cm`, white background, subtle shadow, ~2.5cm padding (margins), top/bottom spacing.
  - Multi-page illusion is achieved purely by the sheet growing tall; no automatic page breaks (per chosen scope).
- When OFF: current behavior unchanged (full-width prose, existing padding).

### Files to change
1. **`src/components/EditorToolbar.tsx`** — Add `pageView: boolean` and `onTogglePageView: () => void` props; render a toggle button next to existing view controls.
2. **`src/components/WritingEditor.tsx`** — Add `const [pageView, setPageView] = useState(false)`; pass to `ExportEnabledToolbar` → `EditorToolbar`; conditionally apply page-view classes on the scroll container and wrap `EditorContent` in a sheet div when active. Remove the inline `px-8 py-6` from `editorProps.attributes.class` when in page view (handled by the sheet wrapper instead).
3. **`src/index.css`** — Add a small `.editor-page-sheet` utility with A4 dimensions, white bg, shadow, and `@media print` reset (so printing still works as today).

### Technical notes
- A4 dimensions use physical CSS units (`cm`) so print output is consistent; on-screen size scales naturally with browser zoom.
- The sheet width (21cm ≈ 794px at 96dpi) fits comfortably in the editor pane at typical viewports; horizontal scroll only appears below ~840px pane width, which is acceptable.
- No changes to TipTap extensions, provenance tracking, save logic, AI selection, or export flows.
- Tailwind semantic tokens used for the backdrop (`bg-muted`) and sheet shadow.