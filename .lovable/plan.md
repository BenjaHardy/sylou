

## Fix: Scroll to Top When Opening Highlighted Text View

### Problem
When the user scrolls down in the FLOW report to reach the "View Highlighted Text" button and clicks it, the scroll position remains at the bottom. The highlighted text view renders at the top, so the user sees a blank area until they manually scroll up.

### Solution
In `FlowReportView.tsx`, when `showHighlighted` is set to `true`, scroll the container to the top. Add a `useEffect` that watches `showHighlighted` and calls `scrollTo(0, 0)` on the scrollable container (or the window/parent element).

### File: `src/components/FlowReportView.tsx`
- Add a ref to the outer container (or use the existing one)
- Add `useEffect`: when `showHighlighted` becomes `true`, scroll the container to top (`ref.current?.scrollTo(0, 0)`)
- This is a 3-line change

### Bonus
The Error Boundary added previously is still valuable as a safety net, so it stays in place.

