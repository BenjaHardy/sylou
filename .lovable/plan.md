

## Fix: Provenance Classification for Pasted Text

### What changes

**File 1: `src/lib/provenance-tracker.ts`**

- Add `_internalClipboard: { text: string; source: SegmentSource } | null` field
- Add `setInternalClipboard(text, source)` — stores the copied text and its dominant source; overwrites any previous value (no expiry needed since it's only cleared by a new copy)
- Add `checkInternalClipboard(pastedText)` — checks (without clearing) if pasted text matches the stored internal clipboard text; returns the source or null. Only cleared when overwritten by a new copy event
- Add `getDominantSource(from, to)` — iterates segments overlapping `[from, to)`, returns the source with the most character coverage. Include a code comment noting the known limitation: mixed-source ranges get a single dominant tag, and preserving per-segment breakdown on paste is a future refinement
- Normalize text in `consumeAiResultText` — trim and collapse whitespace before comparison so minor formatting differences don't prevent matching
- Update `classifyPaste` priority order:
  1. AI result text match (existing)
  2. Chat clipboard role (existing)
  3. Internal clipboard check (new) — if matched, return stored source with appropriate `originalText`
  4. External fallback (existing)

**File 2: `src/components/WritingEditor.tsx`**

- Add copy/cut handlers in `editorProps`:
  - `handleDOMEvents.copy` and `handleDOMEvents.cut`
  - Guard: if selection is empty/collapsed, bail out immediately
  - Get selection `from`/`to` from editor state
  - Call `tracker.getDominantSource(from, to)` to determine the source
  - Get selected text via `editor.state.doc.textBetween(from, to)`
  - Call `tracker.setInternalClipboard(text, dominantSource)`
  - Return `false` to let default copy/cut proceed

### Priority order verification

Chat panel copies set `_chatClipboardRole` (consumed on paste). Editor copies set `_internalClipboard`. Since `classifyPaste` checks chat clipboard before internal clipboard, a chat panel copy followed by paste will correctly use the chat tag. An editor copy doesn't touch `_chatClipboardRole`, so no conflict.

### Known limitation (commented in code)

`getDominantSource` returns a single source for mixed-provenance selections. Future refinement could preserve the full segment breakdown when copying.

