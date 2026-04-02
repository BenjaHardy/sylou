

## Fix: Pin Bottom Bars in Editor and Chat Panels

### Root Cause

In `ProjectContentArea.tsx` line 296, the editor layer div has `h-screen` (100vh). This div is nested inside a flex column that already accounts for a 40px project header. The explicit `100vh` height exceeds the available space, causing the entire editor+chat area to overflow and scroll as a whole — which drags the bottom bars (word count / FLOW button, chat input) out of view.

### Fix

**`src/components/ProjectContentArea.tsx`** — Line 296: change `h-screen` to `h-full`.

```diff
- className="flex-1 flex flex-col bg-background h-screen ..."
+ className="flex-1 flex flex-col bg-background h-full ..."
```

This single change makes the editor layer respect the flex container's height constraint. The `flex-1` already stretches it to fill available space, and `h-full` ensures it doesn't exceed the parent. The chat panel's internal layout (`flex-col h-full` with `flex-1 overflow-y-auto` messages and `shrink-0` input) then works as intended — only the messages area scrolls.

### Files
- `src/components/ProjectContentArea.tsx` (1 line change)

