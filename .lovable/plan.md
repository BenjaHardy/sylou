

## Fix: Clipboard Capture Text Mismatch (Issues 1 & 3)

### Root Cause

The boundary errors stem from a **text normalization mismatch** between what we store in the internal clipboard and what arrives from the paste event.

In the copy/cut handlers (`WritingEditor.tsx`, lines 75 and 88):
```js
const text = ed.state.doc.textBetween(from, to, "");
```

The block separator is `""` — paragraphs are joined with no separator. But the **browser clipboard** serializes paragraph breaks as `\n`. When `checkInternalClipboard` compares them:

- Internal clipboard (stored): `"HelloWorld"` (no separator)
- Paste event data: `"Hello\nWorld"` (browser adds newlines)
- After normalize (`trim().replace(/\s+/g, " ")`): `"HelloWorld"` vs `"Hello World"`
- **No match** → falls through to external → classified as `[ce]`

For single-paragraph text, the match works. But any multi-paragraph copy from the editor fails to match, causing incorrect `[ce]` classification. This explains the boundary-looking errors: the "last character" before a paragraph break, or text spanning paragraph boundaries, gets misclassified because the entire paste is treated as external.

### Fix

**File: `src/components/WritingEditor.tsx`** — 2 lines changed

Change the block separator from `""` to `"\n"` in both the copy and cut handlers:

```typescript
// Line 75 (copy handler)
const text = ed.state.doc.textBetween(from, to, "\n");

// Line 88 (cut handler)  
const text = ed.state.doc.textBetween(from, to, "\n");
```

This makes the stored internal clipboard text match what the browser puts in the clipboard, so `checkInternalClipboard` will correctly recognize internal copies and preserve their provenance source.

### What This Fixes
- Copying multi-paragraph text from the editor and pasting it back now correctly retains its original provenance (e.g., `[ai]` stays `[ai]`, `[t]` stays `[t]`)
- Single-paragraph copies are unaffected (no `\n` involved)

### What This Doesn't Fix (by design, per your decision)
- Issues 2 & 4 (dominant origin for mixed-provenance copies) — deferred to post-MVP

