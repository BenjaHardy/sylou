

## Plan: Add Error Boundary around FlowHighlightedText

### What
Wrap `<FlowHighlightedText>` in a React Error Boundary so rendering crashes show a fallback message and log to `console.error` instead of blanking the screen.

### Changes

**`src/components/FlowReportView.tsx`**
- Add an inline `ErrorBoundary` class component (small, ~20 lines) at the top of the file
- Wrap lines 684–692 (the highlighted text overlay) in `<ErrorBoundary>`:
  ```tsx
  <ErrorBoundary>
    <div className="absolute inset-0 z-10 bg-background">
      <FlowHighlightedText ... />
    </div>
  </ErrorBoundary>
  ```
- The boundary's `componentDidCatch` logs the error + stack to `console.error`
- Fallback UI: a centered message with "Back" button that calls `setShowHighlighted(false)`

No other files changed.

