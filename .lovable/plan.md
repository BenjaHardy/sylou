

## Plan: Fix Creative Tool Layout Issues (Height & Visibility)

### Root Cause

The `ResizablePanel` (left panel, line 445) contains two sibling blocks:
1. The writing div (`flex flex-col h-full`)
2. The `CreativeAIContextProvider` with three creative tool divs

The `ResizablePanel` renders as a plain `div` with size constraints but **no `flex flex-col`** layout. The creative tool divs use `flex-1` to fill available space, but without a flex-column parent they get **zero height**. This causes:
- **World-Building**: columns render but are cut off (no height to fill)
- **Characters**: the canvas div gets zero height; cards are absolutely positioned inside it but the container clips or collapses

### Fix: `ProjectContentArea.tsx` (lines 445–538)

Add `className="flex flex-col h-full min-h-0"` to the `ResizablePanel` itself (the component forwards className to its rendered div), so all children participate in flex layout:

```tsx
<ResizablePanel
  ref={editorPanelRef}
  defaultSize={DEFAULT_EDITOR_SIZE}
  minSize={0}
  className="flex flex-col h-full min-h-0"
>
```

This single change makes `flex-1` work on both the writing div and the creative tool divs, giving them proper height.

### Files Changed

| File | Change |
|------|--------|
| `src/components/ProjectContentArea.tsx` | Add `className="flex flex-col h-full min-h-0"` to left `ResizablePanel` |

