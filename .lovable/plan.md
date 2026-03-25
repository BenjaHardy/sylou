

## Plan: Add Diagnostic Console Logs for Paste Classification

### Purpose
Add temporary `console.log` statements to trace why `_pasteOverride` isn't reaching `classifyGap` when pasting external text, especially into a blank editor.

### Changes

**File 1: `src/components/WritingEditor.tsx`** (line ~96-103, handlePaste)

Add log after classification:
```ts
handlePaste: (_view, event) => {
  const tracker = getTracker();
  const pastedText = event.clipboardData?.getData("text/plain") ?? "";
  if (pastedText) {
    const classification = tracker.classifyPaste(pastedText);
    console.log('[PASTE DEBUG] handlePaste fired', {
      classifiedSource: classification.source,
      pastedTextPreview: pastedText.slice(0, 50),
    });
    tracker.setPasteOverride(classification);
  }
  return false;
},
```

**File 2: `src/lib/provenance-tracker.ts`**

1. **`applyTransaction`** (line ~231): log `_pasteOverride` at start, mapped segments + gaps after mapping:
```ts
// At start of applyTransaction:
console.log('[PROV DEBUG] applyTransaction start', {
  pasteOverrideSet: !!this._pasteOverride,
  pasteOverrideSource: this._pasteOverride?.source ?? null,
  existingSegments: this.segments.length,
});

// After mapping loop (after line ~248), before gap fill:
console.log('[PROV DEBUG] after mapping', {
  mappedSegments: mapped.map(s => ({ start: s.start, end: s.end, source: s.source })),
  newDocSize,
});

// Inside gap detection (line ~262, when segStart > cursor):
console.log('[PROV DEBUG] gap found', {
  gapStart: cursor, gapEnd: segStart,
  gapTextPreview: gapText.slice(0, 50),
  pasteOverrideStillSet: !!this._pasteOverride,
});

// After trailing gap (line ~282):
console.log('[PROV DEBUG] trailing gap', {
  gapStart: cursor, gapEnd: newDocSize,
  gapTextPreview: gapText.slice(0, 50),
  pasteOverrideStillSet: !!this._pasteOverride,
});
```

2. **`classifyGap` / `classifyInsertionFull`** (line ~321/364): log when called and what it returns:
```ts
// In classifyInsertionFull, before return statements:
console.log('[PROV DEBUG] classifyInsertionFull', {
  textPreview: text.slice(0, 50),
  pendingAi: this._pendingAiInsertion,
  pasteOverride: this._pasteOverride?.source ?? null,
});
```

### No functional changes
These are purely diagnostic logs. After the user runs the two tests (blank editor paste, mid-text paste) and shares output, the logs will be removed and the actual fix implemented.

