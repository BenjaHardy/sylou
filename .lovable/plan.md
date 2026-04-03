

## Plan: Add Web Search to Chat via Brave Search API (ToS-Compliant)

### Summary

Add a `web_search` tool to chat and context-prompt workflows, controlled by a user toggle. When enabled, the LLM can search the web alongside reading imported documents using the existing two-pass flow. Per Brave ToS compliance, only search query strings are persisted — no titles, URLs, or snippets are stored in the database. Results are shown transiently during the streaming session only.

---

### Prerequisite: BRAVE_SEARCH_API_KEY Secret

The user will need to add `BRAVE_SEARCH_API_KEY` as a Supabase Edge Function secret before this feature works.

### Database Migration

Add `web_searches_performed` JSONB column to `chat_messages`:
```sql
ALTER TABLE public.chat_messages
ADD COLUMN web_searches_performed JSONB DEFAULT NULL;
```

Schema: a simple array of query strings, e.g. `["latest GDPR enforcement actions 2026", "EU AI Act timeline"]`

### Edge Function: `supabase/functions/chat/index.ts`

1. **Accept `web_search_enabled: boolean`** in request body (default false)

2. **Add `buildWebSearchTool()`** — tool definition with `query` parameter

3. **Add `searchWeb(query)`** — calls `GET https://api.search.brave.com/res/v1/web/search?q={query}&count=5` with `X-Subscription-Token` header. Returns `{ title, url, snippet }[]` for the LLM context (transient only)

4. **Tool array logic**: Build tools array based on `hasDocuments` and `webSearchEnabled`:
   - Both → include both tools
   - Documents only → document tool only (existing behavior)
   - Web search only → web search tool only (new: enters two-pass flow)
   - Neither → no tools, direct streaming (existing behavior)

5. **Tool dispatch**: In existing tool-use loop, add `web_search` case alongside `read_imported_document`. Format results for LLM consumption. Accumulate query strings in `webSearchesPerformed: string[]`.

6. **Phase event**: Send `{"phase":"searching_web"}` when web search tool call detected

7. **System prompt**: Append web search instructions based on toggle state + document availability

8. **Persistence**: Store `web_searches_performed` (query strings only) on assistant message row. No titles/URLs/snippets persisted.

### Edge Function: `supabase/functions/context-prompt/index.ts`

Same additions in Call #2:
- Accept `web_search_enabled` in request body
- Include `web_search` tool alongside `read_imported_document` when enabled
- Handle in existing tool-use loop, send `"searching_web"` phase event
- Store `web_searches_performed` (query strings) on Ask messages / in done event for Propose

### Edge Function: `supabase/functions/analysis/index.ts`

- Add `web_searches_performed` to the chat messages query select
- In `buildChatHistoryString`, append `[Web searches performed: "query1", "query2"]` when present (queries only, no results)

### UI: `src/hooks/useChatMessages.ts`

- Accept `webSearchEnabled` parameter in `sendMessage`, pass to Edge Function body

### UI: `src/components/ChatPanel.tsx`

- Add `webSearchEnabled` state toggle (globe icon) in the input area, next to the send button
- Handle `phase === "searching_web"` in loading indicator: show "Searching the web..."
- No persistent "Sources" display since we don't store URLs/titles (results visible transiently during streaming only)

### UI: `src/components/TextSelectionWindow.tsx`

- Handle `"searching_web"` phase in loading stages: show "Searching the web..."

---

### Files Changed

| File | Change |
|------|--------|
| Migration SQL | Add `web_searches_performed` JSONB column |
| `supabase/functions/chat/index.ts` | Web search tool, Brave API wrapper, tool dispatch, phase event, persist query strings |
| `supabase/functions/context-prompt/index.ts` | Same web search additions in Call #2 |
| `supabase/functions/analysis/index.ts` | Include `web_searches_performed` in chat history formatting |
| `src/hooks/useChatMessages.ts` | Pass `web_search_enabled` to Edge Function |
| `src/components/ChatPanel.tsx` | Globe toggle, "searching_web" phase |
| `src/components/TextSelectionWindow.tsx` | Handle "searching_web" loading phase |

### What's NOT Changed
- Behavior when toggle is off (zero overhead)
- FLOW prompt template
- Editor actions
- Sanity checks (separate feature)

### ToS Compliance Summary
- **Persisted**: Query strings only (user-owned Search Query Data per Section 9(b))
- **Transient only**: Titles, URLs, snippets shown during streaming session but never written to database
- **FLOW**: Uses only `[Web searches performed: "query"]` — no search results

