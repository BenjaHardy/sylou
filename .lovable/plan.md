

## Fix: Chat Prompt Count for Non-Main Threads

### Changes

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | Move prompt count increment to `transform()` at `[DONE]` detection; add `flush()` monitoring logs |

### Detail

1. **In `transform()`**: When `payload === "[DONE]"`, fire the prompt count increment immediately (guarded by a `promptCounted` boolean flag to prevent double-counting). Same logic currently in `flush()` — fetch current count, increment, update.

2. **Remove** the prompt count increment from `flush()`.

3. **Add monitoring to `flush()`**: Insert `console.log("[stream] flush() started")` at the top and `console.log("[stream] flush() completed")` at the end of `flush()`. This gives us visibility into whether `flush()` is reliably called — if message persistence issues appear later, the logs will tell us whether to move more logic into `transform()`.

No client-side changes needed.

