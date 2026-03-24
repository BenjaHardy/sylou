

## Fix: Pass Source Breakdown in Propose Confirm Requests

### Problem

For "Ask" actions, `selected_text_source` is sent in the initial request and the chat message is logged immediately — so it works.

For "Propose" actions, the flow is two-step:
1. Initial request computes `selected_text_source` and sends it (line 207-217), but chat messages are NOT logged yet
2. Confirm request (Accept/Modified) logs the chat messages, but does NOT send `selected_text_source`

The backend confirm handler (line 250) reads `selectedTextSource` from the request body, but the frontend confirm calls (lines 308-318, 347-358) never include it.

### Fix

**File: `src/components/TextSelectionWindow.tsx`**

1. Add a state variable `pendingSourceBreakdown` (similar to `pendingSummaryUpdate` and `pendingInstruction`)
2. When the initial Propose response is received, store the computed `selected_text_source` in `pendingSourceBreakdown`
3. In `handleAccept` and `handleAcceptModified`, include `selected_text_source: pendingSourceBreakdown` in the confirm request body
4. Reset `pendingSourceBreakdown` in `resetState()`

No backend changes needed — the confirm handler already reads and uses `selected_text_source`.

