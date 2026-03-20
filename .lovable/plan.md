

## Plan: Fix Context-Prompt Edge Function & TextSelectionWindow Issues

### 1. Flow Flags Fix (context-prompt Edge Function)

Change `flow_flag` values in `supabase/functions/context-prompt/index.ts`:

| Message type | Current | New |
|---|---|---|
| ask_prompt (line 406) | "not_assessed" | "normal" |
| ask_response (line 424) | "not_assessed" | "normal" |
| writing_summary (lines 414, 218) | "not_assessed" | "not_assessed" (keep) |
| propose_prompt (line 212) | "not_assessed" | "normal" |
| propose_response (line 231) | "not_assessed" | "normal" |

### 2. Language Awareness

In the project fetch (line 277), add `language` to the select: `"id, tutor_mode, language"`. Then append `Respond in {project.language}.` to both the summary prompt system message and the response prompt system message.

### 3. Server-Side AI Response Storage

Store the full `ai_response` in `ai_editor_actions` during the initial call. The existing `ai_response_preview` column is truncated to 500 chars — we'll add a new `ai_response_full` TEXT column via migration. On confirm, read the response from the DB row instead of trusting the client-provided `ai_response`.

**Migration**: `ALTER TABLE ai_editor_actions ADD COLUMN ai_response_full text;`

In the edge function:
- On initial insert, store `ai_response` in `ai_response_full`
- On confirm, fetch the `ai_editor_actions` row by `action_id` and use its `ai_response_full` value

In `TextSelectionWindow.tsx`: remove `ai_response: proposedText` / `ai_response: editableText` from the confirm body.

### 4. Atomic Budget Update

Replace the read-then-write budget update (lines 391-395) with:
```ts
await supabase.rpc('increment_tokens_used', { user_uuid: user.id, amount: totalTokens });
```
The `increment_tokens_used` function already exists in the database.

Also update the budget_remaining calculation to use a fresh read or compute from the pre-check value.

### 5. Propose Confirm Outcome — Server-Side

Add `modified` field support to the confirm endpoint body. When `confirm === true && body.modified === true`, set outcome to `"modified"` instead of `"accepted"`.

In `TextSelectionWindow.tsx` `handleAcceptModified`: add `modified: true` to the confirm body and remove the separate `updateOutcome(currentActionId, "modified")` call.

### 6. localStorage Removal in ChatPanel

Replace `localStorage.getItem(TIP_DISMISSED_KEY)` with `useState(false)`. Remove the `localStorage.setItem` call in `dismissTip`. Remove the `TIP_DISMISSED_KEY` constant.

### Files Changed

- `supabase/functions/context-prompt/index.ts` — fixes 1-5
- `src/components/TextSelectionWindow.tsx` — fixes 3, 5
- `src/components/ChatPanel.tsx` — fix 6
- New migration for `ai_response_full` column

