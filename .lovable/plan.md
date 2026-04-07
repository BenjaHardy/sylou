

## Plan: Replace Textareas with TipTap Mini-Editors in Characters & Timeline

### Summary

Replace the `<Textarea>` elements in the Characters edit dialog (description field) and Timeline edit dialog (description field) with minimal TipTap editor instances. This makes `window.getSelection()` work naturally, so the existing `CreativeAITextField` wrapper enables "Interact with AI" without any changes to the selection detection logic.

### Scope

There are exactly **2 textarea fields** to replace:

1. **CharactersDiagram.tsx** — character description (line 615)
2. **TimelineView.tsx** — event description (line 314)

Both are inside edit dialogs with local state (`editChar` / `editEvent`), making the integration straightforward.

### Implementation

**Create a reusable mini-editor component: `src/components/creative-tools/MiniTipTapEditor.tsx`**

- Minimal TipTap instance with `StarterKit` (same as World-Building notes)
- No toolbar — just a plain contenteditable area styled to look like a textarea
- Props: `value: string` (HTML), `onChange: (html: string) => void`, `placeholder?: string`, `className?: string`
- Uses `useEditor` with `onUpdate` to call `onChange(editor.getHTML())`
- Syncs external `value` changes via `editor.commands.setContent()` in a `useEffect` (only when value differs from current content, to avoid cursor jumps)
- Applies same prose styling as World-Building: `prose prose-sm dark:prose-invert`
- Wraps `EditorContent` in the component — the parent wraps it in `CreativeAITextField`

**CharactersDiagram.tsx changes (lines 612-621)**

Replace:
```tsx
<CreativeAITextField sourceModule="character_chart">
  <Textarea value={editChar.description} onChange={...} rows={3} />
</CreativeAITextField>
```
With:
```tsx
<CreativeAITextField sourceModule="character_chart">
  <MiniTipTapEditor
    value={editChar.description}
    onChange={(html) => setEditChar({ ...editChar, description: html })}
    className="min-h-[80px]"
  />
</CreativeAITextField>
```

**TimelineView.tsx changes (lines 311-320)**

Same pattern — replace `Textarea` with `MiniTipTapEditor` inside the existing `CreativeAITextField` wrapper.

### Data compatibility

Character descriptions and timeline event descriptions are currently stored as plain text strings. After this change they will be stored as HTML (TipTap output). This is backward-compatible because:
- TipTap renders plain text strings correctly (treats them as text nodes)
- The `stripHtmlDeno()` helper in edge functions already handles HTML for creative data in prompts
- No migration needed — existing plain text loads fine, new saves will be HTML

### Edge case: dialog open/close lifecycle

When the edit dialog opens, `editChar`/`editEvent` is set with the current description. The TipTap instance initializes with that content. When the dialog closes, the editor is unmounted and destroyed. This is clean — no stale editor state between opens.

### Files Changed

| File | Change |
|------|--------|
| `src/components/creative-tools/MiniTipTapEditor.tsx` | New — minimal TipTap wrapper with value/onChange interface |
| `src/components/creative-tools/CharactersDiagram.tsx` | Replace description Textarea with MiniTipTapEditor |
| `src/components/creative-tools/TimelineView.tsx` | Replace description Textarea with MiniTipTapEditor |

