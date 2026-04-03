

## Fix: `[object Object]` in Chat Messages from Streaming Deltas

### Root Cause

In `supabase/functions/chat/index.ts`, `extractDeltaText()` (line 43-58) checks `choices[0].delta.content` for truthiness and returns it assuming it's a string. But Mistral sometimes returns `delta.content` as an array of content blocks (e.g., `[{type:"text", text:"..."}]`). When this non-string value is concatenated via `fullResponse += delta`, JavaScript coerces the array to the string `"[object Object]"` — producing exactly the output shown in the screenshot.

The same `extractDeltaText` function exists in `context-prompt/index.ts` and needs the same fix.

### Fix

Update `extractDeltaText` in both files to normalize non-string `content`:

```typescript
function extractDeltaText(
  parsed: Record<string, unknown>,
  _provider: string
): string | null {
  const choices = parsed.choices as
    | Array<{ delta?: { content?: unknown } }>
    | undefined;
  const content = choices?.[0]?.delta?.content;
  if (content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b.text ?? "")
        .join("");
    }
    return String(content);
  }
  if (parsed.type === "content_block_delta") {
    const delta = parsed.delta as { text?: string } | undefined;
    if (delta?.text) return delta.text;
  }
  return null;
}
```

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | `extractDeltaText` handles array content |
| `supabase/functions/context-prompt/index.ts` | Same fix |

