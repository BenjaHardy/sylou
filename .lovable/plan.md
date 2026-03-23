

## Fix: Provenance Data Race Condition

### Problem
When the editor loads, there's a race between two async operations:
1. `useProvenanceTracker` fetches `segment_map` from `provenance_events` (async, no loading state exposed)
2. `WritingEditor` calls `initWithContentLength` as soon as writing content is ready

If #2 fires before #1 completes, the tracker has empty segments, so `initWithContentLength` marks the entire document as `[t]` (typed). This overwritten state then gets auto-saved back to the database via `scheduleSave`, permanently destroying the real provenance data.

This also explains why re-running FLOW analysis shows everything as typed — the provenance was already overwritten in the DB.

### Fix

**`src/hooks/useProvenanceTracker.ts`** — Add a `provenanceLoaded` state:
- Add a `useState<boolean>(false)` for `provenanceLoaded`
- Set it to `true` after the async load completes (or when there's no projectId)
- Return `provenanceLoaded` from the hook

**`src/components/WritingEditor.tsx`** — Wait for provenance before initializing:
- Destructure `provenanceLoaded` from `useProvenanceTracker`
- In the "Set initial content" effect, add `provenanceLoaded` to the guard condition: only call `initWithContentLength` when `!loading && provenanceLoaded && !initialSet`
- Add `provenanceLoaded` to the effect dependency array

### Steps
1. In `useProvenanceTracker.ts`: add `provenanceLoaded` state, set `true` after load, return it
2. In `WritingEditor.tsx`: gate `initWithContentLength` on `provenanceLoaded`

### Result
The editor will wait for provenance segments to be fetched before initializing the tracker, preventing the race condition from overwriting real provenance data with all-typed segments.

