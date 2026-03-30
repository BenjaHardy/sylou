

## Cleanup Pass: Provenance Tracker Code (revised)

### 1. Dead code removal
Remove `classifyGap()` (pass-through wrapper), `consumeDragOverride()` (never called), and relocate scattered `_pasteOverride` declaration.

### 2. Consolidate into `_pendingSignal`

Replace `_pendingAiInsertion`, `_pasteOverride`, `_dragOverride` with one field:
```typescript
private _pendingSignal: { source: SegmentSource; originalText: string | null } | null = null;
```

**Confirmed**: `classifyPaste` keeps its full priority chain (internal clipboard → AI registry → chat clipboard → external) untouched. Only its *result* is passed to `setPendingSignal` instead of stored in `_pasteOverride`. The consolidation changes storage, not classification logic.

Callers update to:
- Paste: `tracker.setPendingSignal(tracker.classifyPaste(text))`
- Drag: `tracker.setPendingSignal({ source, originalText })`
- AI accept: `tracker.setPendingSignal({ source: "ai_editor", originalText: null })`

`classifyInsertionFull` consumes `_pendingSignal` instead of checking three fields.

### 3. Lifecycle comments

**`provenance-tracker.ts` top-of-file** — architecture summary:
```
// Provenance Tracker
// Segment positions are updated via ProseMirror's transaction.mapping.
// Insertions within segments are detected by analyzing StepMap ranges.
// Classification priority: internal clipboard → AI registry → chat → external.
```

Plus comments at:
- `useWritingContent.ts`: debounce → saveNow → flushSave pipeline
- `useProvenanceTracker.ts`: deferred init → debounced save → flush lifecycle
- `WritingEditor.tsx`: why refs avoid stale closures in the flush chain
- `ProjectContentArea.tsx`: awaited flush chain diagram
- `Index.tsx`: deterministic switch pattern

### Files changed

| File | Changes |
|------|---------|
| `src/lib/provenance-tracker.ts` | Dead code removal, `_pendingSignal` consolidation, architecture comment |
| `src/components/WritingEditor.tsx` | Update callers to `setPendingSignal`, flush lifecycle comments |
| `src/hooks/useWritingContent.ts` | Flush lifecycle docstring |
| `src/hooks/useProvenanceTracker.ts` | Load/save lifecycle docstring |
| `src/components/ProjectContentArea.tsx` | Flush chain comment |
| `src/pages/Index.tsx` | Project-switch comment |

All changes are structural refactors — no behavioral changes.

