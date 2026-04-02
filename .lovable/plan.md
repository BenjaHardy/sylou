
## Fix: Pinned bottom bars still not holding in chat/editor

### What’s actually happening
The earlier `h-screen` → `h-full` change helped one container, but it did not fix the real flex overflow chain.

Both the editor pane and chat pane are nested inside flex layouts where some parents are missing `min-h-0`. In CSS flexbox, that means children resist shrinking and push the whole panel taller than the viewport. When that happens, the entire pane scrolls instead of only the intended middle content area.

### Root cause confirmed
The main problem is not just one height class:
- `Index.tsx` uses `min-h-screen` on the root layout instead of a fixed viewport-height shell.
- `ProjectContentArea.tsx` has several flex layers, but the resizable group / panel wrappers / pane wrappers are missing `min-h-0`.
- `ChatPanel.tsx` already has the correct internal structure (`header` + `flex-1 overflow-y-auto messages` + `shrink-0 input`), but that only works if all parent flex containers allow shrinking.
- `WritingEditor.tsx` also has the right pattern internally, but its parent wrappers need `min-h-0` too.
- There are still some `h-screen` usages in FLOW-related views that should also be normalized for consistency.

### Implementation plan

1. **Make the app shell a true viewport-height container**
   - In `src/pages/Index.tsx`, change the root wrapper from `min-h-screen` to `h-screen overflow-hidden`.
   - This ensures the workspace is capped to the viewport instead of growing with content.

2. **Allow the project workspace to shrink correctly**
   - In `src/components/ProjectContentArea.tsx`, add `min-h-0` to the main wrapper and to the editor layer wrapper.
   - Add `min-h-0` to the `ResizablePanelGroup`.
   - Wrap each `ResizablePanel` content with `min-h-0` so the editor/chat internals can own scrolling.

3. **Fix the editor pane scroll ownership**
   - In `src/components/ProjectContentArea.tsx`, update the editor-side wrapper around `WritingEditor` to `flex min-h-0 flex-col`.
   - Keep the footer/activity bar as `shrink-0`.
   - In `src/components/WritingEditor.tsx`, ensure the scrollable editor body remains the only `overflow-y-auto` region and that its top-level flex container also includes `min-h-0`.

4. **Fix the chat pane scroll ownership**
   - In `src/components/ChatPanel.tsx`, add `min-h-0` to the root container and to the messages container if needed.
   - Preserve the existing structure:
     - header: fixed
     - tip banner: fixed
     - messages: `flex-1 overflow-y-auto`
     - input/footer: fixed

5. **Clean up related full-height inconsistencies**
   - In `src/components/ProjectContentArea.tsx`, replace the remaining FLOW loading wrappers that still use `h-screen` with `h-full`/`min-h-0`.
   - This avoids similar overflow bugs when switching views.

### Expected result
After these changes:
- In the chat pane, only the message list scrolls.
- The chat input stays pinned at the bottom.
- In the editor pane, only the document body scrolls.
- The toolbar and bottom status/action bar stay pinned.
- No need to create a new project; this is purely a layout issue.

### Files to update
- `src/pages/Index.tsx`
- `src/components/ProjectContentArea.tsx`
- `src/components/ChatPanel.tsx`
- `src/components/WritingEditor.tsx`

### Technical details
```text
Viewport shell
└── ProjectContentArea (min-h-0)
    └── ResizablePanelGroup (min-h-0)
        ├── Editor panel (min-h-0)
        │   ├── Toolbar (fixed)
        │   ├── Editor body (scrollable)
        │   └── Footer bars (fixed)
        └── Chat panel (min-h-0)
            ├── Header (fixed)
            ├── Tip (fixed)
            ├── Messages (scrollable)
            └── Input (fixed)
```

The key CSS fix is `min-h-0` on flex parents, not just `h-full` on one child.
