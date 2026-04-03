

## Fix: Web Search and Streaming in Context Prompts (Ask/Propose)

### Root Causes

**Issue 1 — Web search never triggers**: `TextSelectionWindow.tsx` does not include `web_search_enabled` in the request body sent to the `context-prompt` function. The toggle state lives only in `ChatPanel.tsx` and is never passed down to the text selection window.

**Issue 2 — No streaming/phase events when tools are present**: The two-pass tool path in `context-prompt/index.ts` awaits the entire Call #2a (non-streamed planning call) *before* creating the `ReadableStream` and returning the HTTP response. This means:
- The client's `fetch()` doesn't resolve until Call #2a completes (can take 5-15s)
- During that time, no SSE events can reach the client — the user sees only "Reviewing your writing..."
- Once Call #2a completes, tool resolution and Call #2b happen inside `start()`, but by then the delay has already occurred
- The edge function logs confirm this: many entries show `no tool use, emitting Call #2a directly` because web search was never requested

### Fix

#### 1. Pass `webSearchEnabled` to TextSelectionWindow

The `webSearchEnabled` state currently lives in `ChatPanel.tsx`. It needs to be lifted or passed so `TextSelectionWindow` can include it in its request body.

**`ProjectContentArea.tsx`**: Lift `webSearchEnabled` state up from `ChatPanel` (or add a shared state), and pass it as a prop to both `ChatPanel` and `WritingEditor` → `TextSelectionWindow`.

**`TextSelectionWindow.tsx`**: Accept `webSearchEnabled` prop and include `web_search_enabled: true` in the request body when the flag is set (line ~284-294).

#### 2. Move Call #2a inside the ReadableStream

Restructure the tool-use path in `context-prompt/index.ts` so Call #2a happens *inside* the `ReadableStream.start()` callback, matching the pattern already used in `chat/index.ts`. This ensures:
- The HTTP response is returned immediately
- Phase events (`searching_web`, `reading_documents`) reach the client in real-time
- Call #2b tokens stream progressively

```text
Current flow:
  await Call #2a          ← blocks response
  return ReadableStream   ← too late for phase events

Fixed flow:
  return ReadableStream {
    start() {
      emit phase("reviewing")
      await Call #2a
      if tools requested:
        emit phase("searching_web" / "reading_documents")
        resolve tools
        stream Call #2b tokens
      else:
        emit Call #2a text as rapid tokens
    }
  }
```

### Files Changed

| File | Change |
|------|--------|
| `src/components/ProjectContentArea.tsx` | Lift `webSearchEnabled` state, pass to ChatPanel and WritingEditor |
| `src/components/ChatPanel.tsx` | Accept `webSearchEnabled` + `setWebSearchEnabled` as props instead of local state |
| `src/components/WritingEditor.tsx` | Pass `webSearchEnabled` through to TextSelectionWindow |
| `src/components/TextSelectionWindow.tsx` | Accept `webSearchEnabled` prop, include in request body |
| `supabase/functions/context-prompt/index.ts` | Move Call #2a inside ReadableStream.start() so phase events stream immediately |

### What's NOT Changed
- Chat function (already working correctly)
- Database schema
- FLOW analysis
- Non-streaming fallback path

