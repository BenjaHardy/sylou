

## Fix: Provenance Lost When Leaving Editor Screen

### Root Cause

When `showFlowReport` becomes true, `ProjectContentArea` returns early with the `FlowReportView` component — **`WritingEditor` is completely unmounted**. Same thing happens when switching projects. On unmount:

1. `useProvenanceTracker`'s cleanup only clears the debounce timer — it **never flushes** unsaved segments to DB
2. When `WritingEditor` remounts, `useProvenanceTracker` creates a brand-new `ProvenanceTracker` and reloads from DB
3. The DB data may be stale (last debounced save was 3s ago or never happened), so the segments loaded are outdated or empty
4. `initWithContentLength` then treats the content as all-typed if no segments were loaded

This explains why it happens on View FLOW, Run FLOW, and project switching — all three unmount the editor.

### Fix

Two changes:

**1. Flush provenance on unmount** (`src/hooks/useProvenanceTracker.ts`)

Add a separate `useEffect` with an unmount cleanup that calls `doSave()` synchronously (or as close as possible). The existing cleanup in the `projectId` effect only clears the timer. Add:

```typescript
useEffect(() => {
  return () => {
    // Flush on unmount
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    // Fire-and-forget save on unmount
    const json = JSON.stringify(trackerRef.current.toJSON());
    if (json !== lastSavedJsonRef.current && projectIdRef.current) {
      supabase
        .from("provenance_events")
        .update({ segment_map: JSON.parse(json), updated_at: new Date().toISOString() })
        .eq("project_id", projectIdRef.current)
        .then(() => {});
    }
  };
}, []);
```

This requires storing `projectId` in a ref (`projectIdRef`) so the unmount cleanup can access the current value without stale closure issues.

**2. Prevent conditional unmounting of WritingEditor** (`src/components/ProjectContentArea.tsx`)

As a belt-and-suspenders approach, instead of returning early when `showFlowReport` is true (which unmounts the editor), render both the editor and the report, hiding the editor with CSS (`display: none`). This keeps the editor mounted and its provenance tracker alive:

```tsx
// Instead of early returns for flow report, render both:
<div style={{ display: showFlowReport ? 'none' : undefined }} className="flex-1 flex flex-col">
  {/* existing editor layout */}
</div>
{showFlowReport && (flowReport || flowLoading) && (
  <FlowReportView ... />
)}
```

### Technical Details

| File | Change |
|------|--------|
| `src/hooks/useProvenanceTracker.ts` | Add `projectIdRef`, add unmount-flush `useEffect` |
| `src/components/ProjectContentArea.tsx` | Render editor + report side-by-side with CSS visibility toggle instead of conditional early returns |

### Why both changes

- The unmount flush handles project switching (where the editor genuinely needs to unmount for a different project)
- The CSS hide handles FLOW report viewing (where the same project's editor should stay alive)

