

## Plan: Enable Streaming for AI Chat Responses

### Overview

Switch the chat from "wait for full response" to progressive token-by-token display using Server-Sent Events (SSE). The implementation is model-agnostic, ready for both Mistral and future Anthropic support.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | Add streaming path with SSE response, model-agnostic chunk parser |
| `src/hooks/useChatMessages.ts` | Replace `supabase.functions.invoke` with raw `fetch()` + SSE reader |
| `src/components/ChatPanel.tsx` | Show streaming message progressively instead of bounce dots |

### 1. Edge Function — Streaming Path

When `body.stream === true`:

- Call Mistral with `stream: true`
- Return `ReadableStream` with SSE headers (`text/event-stream`)
- For each chunk, extract delta text via `extractDeltaText(chunk, provider)`:
  - Mistral: `choices[0].delta.content`
  - Anthropic (future): `delta.text` from `content_block_delta` events
- Forward as `data: {"token":"<text>"}\n\n`
- Accumulate full response server-side in a buffer
- After stream ends: persist both messages, log tokens, update budget, update stats
- Send final event: `data: {"done":true, "user_message":..., "assistant_message":..., "budget_remaining":...}\n\n`
- If client disconnects mid-stream, still finish reading LLM response and persist everything (wrap writer errors in try/catch, continue accumulating)
- When `stream` is false/missing, keep existing non-streaming path unchanged

### 2. Client Hook — SSE Consumer

In `sendMessage`:

- Build URL as `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`
- Get fresh token via `supabase.auth.getSession()` at call time
- Pass `Authorization: Bearer <token>` and `apikey` headers
- Add `stream: true` to request body
- Read response body as stream, parse `data:` lines
- On `{"token":"..."}`: append token to a streaming placeholder message (id: `streaming-assistant`)
- On `{"done":true, ...}`: replace optimistic user msg + streaming placeholder with final persisted messages, update `budgetRemaining`
- On error/drop (no `done` received): remove streaming placeholder, show error via toast
- `sending` stays `true` until `done` event

### 3. ChatPanel — Progressive Display

- When a message with id `streaming-assistant` exists in the list, render it as a normal assistant `ChatBubble` (content grows progressively)
- Remove the bounce-dots indicator when streaming is active (the growing message replaces it)
- The existing auto-scroll effect (`useEffect` on `[messages, sending]`) already triggers on message changes, so progressive content will auto-scroll naturally
- No other UI changes needed

### Technical Details

**SSE parsing** on the client: read chunks with `TextDecoder`, split on `\n\n`, extract `data:` prefix, `JSON.parse` each event. Handle partial chunks with a line buffer.

**Client disconnect resilience**: The edge function's `ReadableStream` pull function wraps `controller.enqueue()` in try/catch. If write fails (client gone), it sets a `clientDisconnected` flag but continues reading from LLM and accumulating text. After the LLM stream ends, persistence runs regardless.

**Auth token freshness**: `getSession()` is called inside `sendMessage` (not at hook init), so tokens are always current even during long writing sessions.

