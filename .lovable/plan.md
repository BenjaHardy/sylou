

## Plan: Fix Propose Chat Logging — Root Cause + Safety Nets

### Root Cause

The `ai_editor_actions` insert (line 393-407) silently fails, returning `action_id: null`. The frontend's `handleAccept` (line 281) gates the confirm call on `pendingSummaryUpdate !== null && currentActionId` — since `currentActionId` is null, the confirm endpoint is never called, and no chat messages are logged.

The RLS policy on `ai_editor_actions` requires `owns_project(project_id)` for INSERT. The edge function creates the Supabase client with the user's auth header, so RLS *should* work. The likely cause is either: (a) a silent Supabase error being swallowed because `.select("id").single()` returns `{ data: null, error: ... }` and the error is never checked, or (b) a column mismatch. We need to log the actual error to find out.

### Changes

**1. Edge function: Add explicit error logging to ai_editor_actions insert**

In `supabase/functions/context-prompt/index.ts` (line 393-407), capture the error from the insert:

```ts
const { data: actionRow, error: actionErr } = await supabase
  .from("ai_editor_actions")
  .insert({ ... })
  .select("id")
  .single();

if (actionErr) {
  console.error("ai_editor_actions insert failed:", JSON.stringify(actionErr));
}
```

This is the diagnostic step — once deployed, the logs will reveal the exact cause.

**2. Edge function: Use service role for ai_editor_actions insert**

Since the edge function already validates the user's identity and project ownership, use the service role client for the `ai_editor_actions` insert to bypass RLS (which is the most likely failure cause). Create a second client:

```ts
const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
```

Use `supabaseAdmin` for the `ai_editor_actions` insert and for reading it back during confirm. Keep the user-scoped client for everything else (chat_messages, writing_summary_log, etc.) since those RLS policies work fine.

**3. Frontend: Remove currentActionId gate from confirm calls**

In `TextSelectionWindow.tsx`, change `handleAccept` and `handleAcceptModified` to call the confirm endpoint whenever `pendingSummaryUpdate !== null`, regardless of whether `currentActionId` is present. Pass `action_id` if available, but don't skip the call if it's null.

Change line 281 from:
```ts
if (pendingSummaryUpdate !== null && currentActionId) {
```
to:
```ts
if (pendingSummaryUpdate !== null) {
```

Same for `handleAcceptModified` line 319, and `handleReject` line 358.

**4. Edge function: Confirm endpoint works without action_id**

The confirm handler (line 198-284) already handles missing `action_id` — it skips the outcome update and the ai_response_full lookup. But when `action_id` is missing and `aiResponseContent` is empty string, the `propose_response` chat message gets empty content.

Fix: accept `ai_response` in the confirm body as a fallback. Use `actionRow.ai_response_full` as primary (server-side, trusted), fall back to `body.ai_response` only if no action row exists.

```ts
// In confirm handler, after trying to fetch actionRow:
if (!aiResponseContent && body.ai_response) {
  aiResponseContent = body.ai_response;
}
```

In `TextSelectionWindow.tsx`, add `ai_response: proposedText` to the confirm body so the fallback has data.

**5. Priority order**

- Fix #1 (logging) and #2 (service role) fix the root cause
- Fix #3 and #4 are safety nets ensuring the flow works even if the insert fails for any reason
- Once deployed, check edge function logs to confirm the insert error is resolved

### Files Changed

- `supabase/functions/context-prompt/index.ts` — error logging, service role client, fallback ai_response in confirm
- `src/components/TextSelectionWindow.tsx` — remove `currentActionId` gate, add `ai_response` to confirm body

