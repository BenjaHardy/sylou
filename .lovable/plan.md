

## Plan: Fix Web Search Formatting, Streaming, and Phase Events

### Summary

Fix three bugs in the web search integration: (1) raw JSON appearing in chat messages, (2) missing "Searching the web..." phase indicators, (3) broken streaming when tools are used. Also refine the web search prompt to be truly optional and include source URLs inline.

### Changes

#### 1. Add `cleanLLMContent()` helper (both files)

Add to both `chat/index.ts` and `context-prompt/index.ts`:

```typescript
function cleanLLMContent(content: string): string {
  if (!content) return content;
  const trimmed = content.trim();
  if (!trimmed.startsWith("[")) return content;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(b => b?.type === "text")) {
      return parsed.map(b => b.text ?? b.content ?? "").join("");
    }
  } catch { /* not JSON */ }
  return content;
}
```

**Applied to every response path:**
- `chat/index.ts`: `call1Content` (line 434), `nextContent` (line 607), `fullResponse` before persistence in flush() (lines 799, 970), non-streaming path `assistantText` (line 1083)
- `context-prompt/index.ts`: `summaryResult.text` (line 550), `call2aContent` (line 856), `fullResponse` in flush() (line 1019), `callMistral` result in non-streaming paths (lines 1248, 1338)

#### 2. Restructure tool-use path to stream-first (both files)

**Current problem:** Phase events are emitted in the TransformStream's `start()` callback — which fires only when Call #2 streaming begins, AFTER tools are already resolved. The user never sees "Searching the web..." because by the time the stream starts, the search is done.

**Fix for `chat/index.ts`:** Replace the current tool-use path (lines 530-860) with a stream-first approach:

1. Create `TransformStream` + writer immediately when tool calls are detected
2. Return `createSSEResponse(readable)` right away
3. In a background async block:
   - For each tool call, emit `{"phase":"searching_web"}` or `{"phase":"reading_documents"}` via `writer.write()` BEFORE calling the Brave API or reading the document
   - After tool resolution, make Call #2 as streaming
   - Read Call #2's body manually with `getReader()`, forwarding each token delta via `writer.write()` 
   - After stream completes, clean response with `cleanLLMContent`, persist, emit `done` event with accurate `tokensUsed` and `budgetRemaining`, then `writer.close()`
   - On error: emit `{"done":true, "error":"..."}` via writer, then close

**Fix for `context-prompt/index.ts`:** Same restructuring for the Call #2 tool-use path (lines 826-1048):
- Create stream before tool resolution
- Emit phase events during tool calls
- Read Call #2b stream manually via `getReader()`
- Persist via `persistResults()` after stream completes
- Only applies to Call #2 (Call #1 writing summary is unaffected)

#### 3. Refine web search system prompt (both files)

Replace the current web search prompt section with:

```
# WEB SEARCH

You have access to a web_search tool, but using it is OPTIONAL. Only use it when
the user's message genuinely requires current information, recent data, or facts
you don't have in your training data [or in the imported documents].

Do NOT use web search for:
- Simple conversational replies, greetings, or acknowledgments
- Topics you can answer confidently from your training knowledge
- Follow-up questions about information you already provided

When citing information from web search results, always include the source URL
inline in your response text (e.g. "According to [Source Title](URL), ...").
This ensures the user can verify and revisit the sources later.
```

This addresses both the "forced to search on every message" latency issue and the "follow-up queries can't find URLs" issue (URLs will be in the persisted message text).

### Error Handling

- If Brave API times out or fails mid-stream: the `searchWeb()` helper already returns `[]` on error. The stream continues with an empty result rather than hanging.
- If Call #2 fails after tools are resolved: emit `{"done":true, "error":"AI service temporarily unavailable."}` via the writer and close the stream gracefully.
- `done` event always includes accurate `tokensUsed` and `budgetRemaining` because token counting for all calls completes before the done event is written.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | `cleanLLMContent` helper, stream-first tool-use path, refined web search prompt |
| `supabase/functions/context-prompt/index.ts` | `cleanLLMContent` helper, stream-first Call #2 tool-use path, refined web search prompt |

### What's NOT Changed
- Database schema
- UI components (phase handling already correct in ChatPanel and TextSelectionWindow)
- FLOW analysis function
- Non-streaming paths (just add `cleanLLMContent` to response text)

