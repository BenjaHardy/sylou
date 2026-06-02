# Root cause

The `chat_messages.tutor_mode` column exists (default `false`) but is never set on any insert. Both `supabase/functions/chat/index.ts` and `supabase/functions/context-prompt/index.ts` resolve `tutorMode` from `projects.tutor_mode` and use it to shape the system prompt, but they omit `tutor_mode: tutorMode` from every `chat_messages` insert. Result: every row exports as `tutor_mode = false`, regardless of the project setting.

Same shape as the `concise_mode` bug we just fixed. By the same reasoning, the `writing_summary` rows must stay at the default `false`: LLM #1 (summary call) runs before the response prompt is built and never receives the tutor-mode system prompt — so the persisted flag should reflect what actually happened, not the project setting.

# Fix

## 1. `supabase/functions/chat/index.ts`
`tutorMode` is already in scope from line 284. Add `tutor_mode: tutorMode` to every `chat_messages` insert row:
- Streaming Call #1 user + assistant rows (~lines 529–545)
- Streaming tool-use user + assistant rows (~lines 776–792)
- Streaming early-flush user + assistant rows (~lines 932–948)
- Non-streaming user + assistant rows (~lines 1031–1047)

No other paths in this function write `chat_messages`.

## 2. `supabase/functions/context-prompt/index.ts`

**Non-confirm branch** — `tutorMode` is already in scope from line 735. Add `tutor_mode: tutorMode` to:
- Streaming Ask path: `ask_prompt` (~972) and `askResponseRow` (~995)
- Non-streaming Ask paths: both `ask_prompt` / `ask_response` insert sites near lines 1425/1437 and 1515/1527
- Both Propose paths (non-confirm) where `propose_prompt` / `propose_response` are written, mirroring the `concise_mode` additions

Leave the three `writing_summary` inserts in this branch (~985, ~1431, ~1521) untouched — they keep the DB default `false`. Extend the existing one-line comment to mention tutor mode as well.

**Confirm branch (~line 523):** the `projects` row is not currently fetched here. Add a lightweight fetch right after `aiResponseContent` is resolved:
```ts
const { data: confirmProject } = await adminClient
  .from("projects")
  .select("tutor_mode")
  .eq("id", project_id)
  .single();
const tutorMode: boolean = confirmProject?.tutor_mode ?? false;
```
Then add `tutor_mode: tutorMode` to:
- `propose_prompt` insert (~559)
- `propose_response` `responseMsgRow` (~582)

Leave the confirm-branch `writing_summary` insert (~572) at the default `false`, same reason as above; extend the existing comment.

## Client
No client changes. Unlike `concise_mode`, `tutor_mode` is a project-level setting read server-side from `projects.tutor_mode`, so the streaming POST and the confirm POST do **not** need to carry it in the body.

## Out of scope
- `chat_messages.tutor_mode` DB default stays `false`.
- `useChatMessages.ts` optimistic rows keep `tutor_mode: null` (placeholder is overwritten by the persisted row on refresh — same convention as today).

# Verification

1. With Tutor Mode **off**, run a chat message, an Ask, and a Propose (accept). All resulting `chat_messages` rows should have `tutor_mode = false`.
2. Toggle Tutor Mode **on**, repeat the three actions (use accept-as-modified for Propose). `ask_prompt`, `ask_response`, `propose_prompt`, `propose_response`, and the user/assistant `chat` rows should all have `tutor_mode = true`.
3. Every `writing_summary` row in both runs should remain `tutor_mode = false` (intentional — matches the `concise_mode` convention).
4. Reject path: unchanged.
