
## Fix plan: make project switching wait for a real save before loading the next project

### What’s actually happening
The current project-switch fix is not reliable because it saves provenance in a `useEffect` cleanup as a fire-and-forget request. On switch:

1. old project cleanup starts an async provenance update
2. new project immediately loads
3. if the user switches back before that write finishes, the app reloads stale/empty `provenance_events`
4. `initWithContentLength` sees no saved segments and recreates everything as `[t]`

There is also a second risk: writing content and provenance are persisted independently, so project switching can load fresh editor HTML with stale provenance.

### Implementation approach

#### 1) Move project-switch persistence out of cleanup and into the selection flow
Instead of relying on `useEffect` cleanup timing, save explicitly before changing the selected project.

- In `Index.tsx`, replace direct `setSelectedId` usage with an async `handleSelectProject`
- Keep a ref to a “flush current project” callback exposed by `ProjectContentArea`
- When the user selects a different project:
  - await the current editor flush
  - then update `selectedId`

This makes switching deterministic.

#### 2) Expose one combined flush from the editor screen
In `ProjectContentArea.tsx`, expose a single callback upward that flushes:
- writing content
- provenance

in sequence before project switch.

This should live at the `ProjectContentArea` level because it owns the active project/editor context.

#### 3) Make `WritingEditor` expose both flushes, not just provenance
Right now it exposes only `flushProvenance`.

Update it to expose a single `flushBeforeLeave(): Promise<void>` that:
- clears and saves pending writing-content debounce
- clears and saves pending provenance debounce

That avoids HTML/provenance drift.

#### 4) Add a real flush API to `useWritingContent`
`useWritingContent` currently only supports debounced autosave and manual button save.

Add a dedicated async flush method that:
- clears the debounce timer
- awaits `saveNow(currentContent)`
- can be safely called during project switching / navigation

#### 5) Keep the existing unmount/project cleanup as fallback only
The cleanup-based provenance save is still worth keeping as a safety net, but it should no longer be the primary mechanism for project switching.

If kept:
- update `lastSavedJsonRef` on successful fire-and-forget saves if practical
- treat it as backup for abrupt unmounts, not navigation correctness

### Files to update
- `src/pages/Index.tsx`
  - intercept project selection and await flush before switching
- `src/components/ProjectContentArea.tsx`
  - expose current-project flush callback upward
- `src/components/WritingEditor.tsx`
  - compose and expose a combined flush method
- `src/hooks/useWritingContent.ts`
  - add `flushSave` / immediate save API
- `src/hooks/useProvenanceTracker.ts`
  - keep existing fallback cleanup, but no longer depend on it for project switching

### Why this should fix it
This changes project switching from:
```text
click project B -> old project maybe saves later -> B loads now
```

to:
```text
click project B -> await old project save -> switch to B
```

That removes the race condition causing stale provenance to reload as `[t]`.

### Small related cleanup
There is also a separate console warning in `FlowHighlightedText` caused by `<div>` inside `<p>` in tooltip content. I would fix that in the same pass only if you want, but it is unrelated to the provenance reset bug.

### Verification
After implementation, test this exact flow:

1. add mixed provenance in Project A
2. switch to Project B immediately
3. switch back to Project A immediately
4. confirm live provenance still shows original tags
5. repeat after opening/closing FLOW to confirm both navigation paths are safe
