

## Fix: Structural Reorganization Detection for Cross-Paragraph Deletions

### Root Cause

The current substring check only looks at text **within the deleted range** (`oldStart` to `oldEnd`). But when you delete lines at the beginning of a document, ProseMirror reports a replacement where the "inserted" content is text from **after** the deleted range — the surviving paragraphs that got repositioned due to paragraph merging.

Example: document has paragraphs P1, P2, P3. User deletes P1 and P2.
- ProseMirror step: replace `[0, 27]` with P3's content (which was at positions `[27, 40]`)
- Current check: is P3's text a substring of `textBetween(0, 27)` (P1+P2 text)? **No** → `preserveSource = false`
- Result: P3's content gets reclassified as `[t]` — the exact bug observed

### Fix

**File: `src/components/WritingEditor.tsx`** (lines 136-147)

Expand the substring check to also look at text **immediately after** `oldEnd` in the old document. The surviving text in a cross-paragraph deletion always comes from the tail — the content just beyond the deleted range.

```
if (deleteLength > 0 && insertLength > 0 && insertedText) {
  try {
    const normalizedNew = normalize(insertedText);
    if (normalizedNew.length > 0) {
      // Check within the deleted range (handles mid-paragraph edits)
      const oldText = transaction.before.textBetween(oldStart, oldEnd, "");
      if (normalize(oldText).includes(normalizedNew)) {
        preserveSource = true;
      } else {
        // Check text AFTER the deleted range (handles cross-paragraph deletions
        // where ProseMirror merges surviving tail content into the replacement)
        const beforeSize = transaction.before.content.size;
        if (oldEnd < beforeSize) {
          const tailEnd = Math.min(beforeSize, oldEnd + insertLength + 50);
          const tailText = transaction.before.textBetween(oldEnd, tailEnd, "");
          if (normalize(tailText).includes(normalizedNew)) {
            preserveSource = true;
          }
        }
      }
    }
  } catch {
    // fall through to default handling
  }
}
```

### Why this works

- For **beginning/end deletions**: the surviving text is right after `oldEnd` in the old doc → tail check matches → provenance preserved
- For **mid-paragraph merges** (existing behavior): the surviving text is within `[oldStart, oldEnd]` → original check matches
- For **genuine replacements** (paste-over, typing): the new text doesn't exist in either range → correctly classified as `typed`

### No other changes needed

The `provenance-tracker.ts` logic is correct — the issue was solely in the detection of when to set `preserveSource`.

