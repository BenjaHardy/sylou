

## Fix: Provenance Flush on Project Switch

### Root Cause

The unmount-flush `useEffect(…, [])` on line 71 only fires when the **component unmounts entirely**. When the user switches projects, `WritingEditor` stays mounted — it just receives a new `projectId` prop. The `[projectId]` effect cleanup (line 61-67) only clears the debounce timer but **never flushes** the old project's segments to DB.

So the old project's in-memory provenance is silently discarded, and when the user returns to that project, stale/empty segments are loaded from DB → `initWithContentLength` treats everything as typed.

### Fix

In `src/hooks/useProvenanceTracker.ts`, add a flush to the `[projectId]` effect cleanup (lines 61-67). Use `projectIdRef` to capture the *previous* project ID before the effect body overwrites it:

```typescript
// In the [projectId] effect cleanup (line 61):
return () => {
  if (saveTimerRef.current) {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }
  // Flush old project's provenance (fire-and-forget)
  const oldProjectId = projectIdRef.current;
  const json = JSON.stringify(trackerRef.current.toJSON());
  if (json !== lastSavedJsonRef.current && oldProjectId) {
    supabase
      .from("provenance_events")
      .update({ segment_map: JSON.parse(json), updated_at: new Date().toISOString() })
      .eq("project_id", oldProjectId)
      .then(() => {});
  }
};
```

This is the same fire-and-forget pattern already used in the `[]` unmount effect, just applied to the project-switch cleanup too.

### Files changed

| File | Change |
|------|--------|
| `src/hooks/useProvenanceTracker.ts` | Add DB flush in `[projectId]` effect cleanup (lines 61-67) |

Single-file, ~8-line change. No functional side effects — just ensures the save happens before the old tracker is replaced.

