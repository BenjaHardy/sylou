
I reviewed the code path end-to-end at the file/DB level, and the main project-switch flush work is not the real failure anymore.

## Root cause

The provenance is being destroyed on reload, not on save.

In `src/hooks/useProvenanceTracker.ts`:
- the load path fetches `segment_map`
- then immediately does `trackerRef.current.init(segmentMap, 0)`

In `src/lib/provenance-tracker.ts`, `init(savedSegments, contentLength)` always calls `clampToLength(contentLength)` when saved segments exist.

So when `contentLength` is `0`, all loaded segments are trimmed away:
```ts
if (savedSegments && savedSegments.length > 0) {
  this.segments = savedSegments;
  this.clampToLength(contentLength); // contentLength = 0 here
}
```

Then later, when `WritingEditor` calls `initWithContentLength(docLen)`, `getSegments()` is already empty, so it falls into:
```ts
tracker.init(null, contentLength)
```
which recreates the whole document as one `[t]` segment.

That exactly matches your symptom: leaving and returning reloads everything as typed.

I also checked the DB state: the latest `provenance_events` rows for your recent test projects are already stored as a single typed segment (`[{ start: 0, end: N, source: "typed" }]`), while `writing_content` still contains the real text. That’s consistent with this destructive re-init path.

## Fix to implement

### 1. Stop initializing saved provenance at length 0
In `useProvenanceTracker`, do not call `tracker.init(segmentMap, 0)` during the fetch.

Instead:
- add a `loadedSegmentsRef`
- on load, store fetched `segment_map` into that ref
- keep `trackerRef.current` fresh but uninitialized
- in `initWithContentLength(contentLength)`, initialize from `loadedSegmentsRef.current` once the editor’s real doc length is known

Implementation shape:
```ts
const loadedSegmentsRef = useRef<ProvenanceSegment[] | null>(null);

// after fetch
loadedSegmentsRef.current = segmentMap ?? null;
trackerRef.current = new ProvenanceTracker();

// later
const saved = loadedSegmentsRef.current;
tracker.init(saved, contentLength);
loadedSegmentsRef.current = null;
```

### 2. Reset save baselines when loading a project
Also in `useProvenanceTracker`:
- set `lastSavedJsonRef.current` from the fetched `segment_map`
- clear it appropriately when no project / empty project loads

That prevents cross-project stale comparisons and unnecessary rewrites.

### 3. Keep the awaited flush logic
The recent `Index -> ProjectContentArea -> WritingEditor` flush chain is still correct and should stay:
- it protects against race conditions during project switching
- but it only works if the load path preserves the saved segments

## Files to update

- `src/hooks/useProvenanceTracker.ts`
  - replace the destructive `init(segmentMap, 0)` load path
  - add `loadedSegmentsRef`
  - reset `lastSavedJsonRef` correctly per project
- optionally leave `src/lib/provenance-tracker.ts` unchanged
  - cleaner to fix this in the hook than to give `init()` special “0 means defer” semantics

## Verification after implementation

1. In Project A, create mixed provenance (`[cc]`, `[ce]`, `[ai]`, `[t]`)
2. Confirm live provenance panel shows mixed segments
3. Switch to Project B, then immediately back to A
4. Confirm mixed segments still appear
5. Open `View FLOW`, go back, confirm segments still persist
6. Refresh the page and re-open Project A
7. Confirm DB `provenance_events.segment_map` still contains mixed segments, not a single typed span

## Why I’m confident this is the real issue

The current save/flush code may be imperfect, but even a correct save would still fail if the app reloads saved segments by first clamping them to length 0. That is the one code path that directly explains:
- FLOW/view return resets
- project switch resets
- “everything becomes `[t]`”
- recent DB rows ending up as one typed segment
