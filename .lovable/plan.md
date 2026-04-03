

## Fix: `cleanLLMContent` Crash Killing Tool-Use Streams

### Root Cause

The error log shows:
```
TypeError: content.trim is not a function
    at cleanLLMContent (chat/index.ts:19)
```

Mistral's API sometimes returns `.message.content` as an **array of objects** (e.g., `[{type:"text", text:"..."}]`) rather than a plain string. The current `cleanLLMContent(content: string)` assumes it receives a string, so calling `.trim()` on an array throws. This crash happens inside the `(async () => { ... })()` background block that runs tool resolution and streaming — killing the entire stream silently. The client sees no tokens, no phase events, no done event, and the message disappears.

### Fix

**`supabase/functions/chat/index.ts`** and **`supabase/functions/context-prompt/index.ts`**

1. **Make `cleanLLMContent` robust to non-string input** — if `content` is already an array, extract text directly; if it's not a string at all, coerce or return empty:

```typescript
function cleanLLMContent(content: unknown): string {
  if (!content) return "";
  // Already an array (Mistral structured format passed as object, not string)
  if (Array.isArray(content)) {
    return content
      .filter(b => b?.type === "text")
      .map(b => b.text ?? b.content ?? "")
      .join("");
  }
  if (typeof content !== "string") return String(content);
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

2. **Fix `m.content.length` crash** in `chat/index.ts` line 443 — `llmMessages.reduce((s, m) => s + m.content.length, 0)` also assumes string content. Wrap with a safe accessor:

```typescript
llmMessages.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0)
```

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | `cleanLLMContent` accepts `unknown`, safe content length calc |
| `supabase/functions/context-prompt/index.ts` | Same `cleanLLMContent` fix |

### Why This Fixes All Reported Symptoms

- **No "Searching the web..." shown**: The crash occurs right after Call #1 completes (line 444), before the phase events at lines 567/592 are ever reached.
- **No streaming**: The stream's background async block dies, so no tokens are written.
- **Message disappears**: No `done` event is emitted, so `consumeSSEStream` fires `onError("Stream ended without done event")`, and the temporary streaming message is removed with no feedback.

Once `cleanLLMContent` stops crashing, the existing stream-first architecture will work as designed — phase events during tool calls, then streamed tokens from Call #2.

