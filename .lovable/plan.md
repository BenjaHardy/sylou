

## Fix: Content Not Saving + Stale Provenance on Project Switch

### Root Cause Analysis

There are **three interacting bugs**, all caused by stale closures:

#### Bug A: `combinedFlush` is created once and never updated

In `WritingEditor.tsx` line 191-195, the combined flush callback is created inside a `useEffect` that only runs when `initialSet` transitions from false to true:

```typescript
// This runs ONCE per project load, capturing that moment's flushWritingContent and flushProvenance
const combinedFlush = async () => {
  await flushWritingContent();  // ← stale after content changes
  await flushProvenance();
};
onFlushProvenance?.(combinedFlush);
```

After the user types, `flushWritingContent` (from `useWritingContent`) gets recreated (it depends on `[projectId, content, saveNow]`), but `combinedFlush` still references the **initial** version. When `Index.tsx` calls `flushRef.current()` before switching projects, it flushes the **initial content**, not the current content. The save is silently skipped (`html === lastSavedContent.current`), so the user's work is lost.

#### Bug B: `useWritingContent.flushSave` captures `content` from React state

Even if the flush were fresh, `flushSave` reads `content` from its closure:

```typescript
const flushSave = useCallback(async () => {
  await saveNow(content);  // ← content is a snapshot from the render that created this callback
}, [projectId, content, saveNow]);
```

This is fragile because React state isn't synchronous — there's always a render lag between `updateContent` setting state and `flushSave` capturing the new value.

#### Bug C: No debounce cleanup on project change

`useWritingContent`'s `[projectId]` effect cleanup (line 64-66) sets `currentProjectId.current = null` but **never clears the debounce timer**. A pending 3-second save can fire after the project has already switched, potentially saving to the wrong project.

### Fix Plan

#### 1. `useWritingContent.ts` — Use a content ref for flush reliability

Add a `contentRef` that always holds the latest content. Change `flushSave` to read from the ref instead of React state. Also clear the debounce timer in the `[projectId]` effect cleanup:

```typescript
const contentRef = useRef<string>("");

// Keep ref in sync
useEffect(() => { contentRef.current = content; }, [content]);

const flushSave = useCallback(async () => {
  if (debounceTimer.current) {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = null;
  }
  if (!projectId) return;
  await saveNow(contentRef.current);  // ← always latest
}, [projectId, saveNow]);
```

And in the `[projectId]` effect cleanup:
```typescript
return () => {
  if (debounceTimer.current) {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = null;
  }
  currentProjectId.current = null;
};
```

#### 2. `WritingEditor.tsx` — Use refs for flush functions

Instead of capturing `flushWritingContent` and `flushProvenance` in a one-time closure, store them in refs and pass a stable callback to the parent:

```typescript
const flushWritingRef = useRef(flushWritingContent);
const flushProvenanceRef = useRef(flushProvenance);
useEffect(() => { flushWritingRef.current = flushWritingContent; }, [flushWritingContent]);
useEffect(() => { flushProvenanceRef.current = flushProvenance; }, [flushProvenance]);

// Pass a stable flush to parent — always calls latest versions
useEffect(() => {
  const stableFlush = async () => {
    await flushWritingRef.current();
    await flushProvenanceRef.current();
  };
  onFlushProvenance?.(stableFlush);
}, [onFlushProvenance]);
```

Remove the stale `combinedFlush` from the `initialSet` effect (lines 191-195).

#### 3. `WritingEditor.tsx` — Re-expose tracker after project switch

The `onProvenanceTracker?.(tracker)` call only happens once when `initialSet` becomes true. After a project switch, `useProvenanceTracker` creates a new `ProvenanceTracker` instance, but the parent holds the old reference. The `initialSet` reset (line 201) should trigger re-exposure — just need to ensure the effect re-runs properly (it already should, since `initialSet` is in the deps).

No additional code change needed here — Bug A/B fixes will make the init effect run correctly on project switch.

### Files Changed

| File | Change |
|------|--------|
| `src/hooks/useWritingContent.ts` | Add `contentRef`, fix `flushSave` to use ref, clear debounce on project change |
| `src/components/WritingEditor.tsx` | Use refs for flush functions, pass stable callback to parent |

### What This Fixes

- **Content saves reliably** before project switch (flushes latest content, not stale initial)
- **Provenance persists** across project switches (flushes latest provenance state)
- **FLOW analysis** can read content from DB (because content is actually saved)
- **Provenance panel** updates when switching projects (fresh tracker exposed)
- **No cross-project contamination** from orphaned debounce timers

### Why This Is Safe

- All changes are ref-based plumbing — no functional logic changes
- `saveNow` already handles deduplication (`html === lastSavedContent.current`)
- Existing fallback flushes (unmount, cleanup) remain as safety nets

