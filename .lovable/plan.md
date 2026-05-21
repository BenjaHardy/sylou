# Fix LLM choice regressions

## Confirmed root causes

1. **Chat header doesn't update on model change.** `useUserSettings()` is called independently in `SettingsDialog` and `ChatPanel`. Each call owns its own `useState`. When Settings persists to the DB, ChatPanel's local copy never re-reads, so `MODEL_LABELS[userSettings.preferred_chat_model]` keeps showing the old label until full reload.

2. **Mistral never replies.** Edge logs: `[stream] Call #1 error: 400 {"message":"Invalid model: mistral-large-3"}`. The catalog ships fictional IDs.

3. **DeepSeek never replies.** `deepseek-v4-flash` is not a DeepSeek API ID; the right one is `deepseek-chat`.

4. **Claude "No response generated" when documents are imported.** Verified online: `claude-sonnet-4-6` and `claude-opus-4-7` are valid (dateless 4.6-generation format). The real bug is in the **two-pass tool flow** in `supabase/functions/chat/index.ts` (mirrored in `context-prompt/index.ts`). It reads the first-call response as OpenAI shape:

   ```ts
   call1Data.choices?.[0]?.message?.content
   extractToolCalls(call1Data)               // OpenAI-shape only
   toolMessages.push(call1Data.choices[0].message)
   ```

   For Anthropic the raw response has no `choices` — text + `tool_use` live in `content` blocks — so `call1Content` is `""`, `toolCalls` is `[]`, execution falls into the "no tool use, emit Call #1 directly" branch and emits the fallback string `"No response generated."`. This matches the symptom exactly: plain chat works (no imported docs ⇒ `hasTools = false` ⇒ standard streaming path handles Anthropic SSE via `extractDeltaText`); the moment a doc is uploaded, the `read_imported_document` tool registers and the broken two-pass path takes over.

## Changes

### 1. Real Mistral / DeepSeek model IDs (`src/lib/models.ts`)

```text
mistral-large-3     → mistral-large-latest   (label "Mistral Large")
deepseek-v4-flash   → deepseek-chat          (label "DeepSeek Chat", keep experimental)
```

Keep Claude entries unchanged. Update `DEFAULT_CHAT_MODEL` to `mistral-large-latest`. Add legacy aliases in `MODEL_LABELS` (`"mistral-large-3": "Mistral Large"`, `"deepseek-v4-flash": "DeepSeek Chat"`) so historical `chat_messages.model_used` / `flow_reports.model_used` rows still render a friendly label without any data backfill.

### 2. Backfill profiles + column defaults

Migration on `public.profiles`:
- `UPDATE` rows where `preferred_chat_model = 'mistral-large-3'` → `'mistral-large-latest'` and `preferred_flow_model` / `preferred_chat_model = 'deepseek-v4-flash'` → `'deepseek-chat'`.
- Change the column default for `preferred_chat_model` from `'mistral-large-3'` to `'mistral-large-latest'`.

Historical `chat_messages.model_used` and `flow_reports.model_used` are intentionally **not** backfilled — display is handled by the legacy MODEL_LABELS aliases above.

### 3. Patch edge-function fallback constants

Replace hardcoded `"mistral-large-3"` with `"mistral-large-latest"` in the final fallback (after request override and profile preference) in `supabase/functions/chat/index.ts` and `supabase/functions/context-prompt/index.ts`.

### 4. Make the two-pass tool flow provider-agnostic

In `supabase/functions/chat/index.ts` (mirror in `context-prompt/index.ts`), adopt the existing `normaliseResponse(providerFor(model), data)` helper from `_llm.ts`:

- After `call1Res.json()`: `const norm = normaliseResponse(providerFor(chatModel), call1Data)`. Use `norm.text` / `norm.toolCalls` / `norm.assistantMessage` instead of `call1Data.choices?.[0]?.message?.content`, `extractToolCalls(call1Data)`, and `call1Data.choices[0].message`.
- **Inside the `while` loop**, apply the **same normalisation to every iteration** — each `callLLM(...)` follow-up call must run through `normaliseResponse` before its `text` / `toolCalls` / `assistantMessage` are consumed. This covers multi-step flows where the model reads a document then issues a web search (or vice-versa) across iterations.
- `normaliseResponse` already returns `assistantMessage` in the project's normalised OpenAI-style `LLMMessage` shape, which `toAnthropicBody` round-trips correctly via its existing `tool_calls` handling, so no per-provider branching is needed at push time.

This is the only edit needed for Claude + documents to work; it also hardens the path against any future provider added to `providerFor()`.

### 5. Share user-settings state across the app (gated on auth)

Add `UserSettingsProvider` in `src/contexts/UserSettingsContext.tsx`:

- Owns the single `useState` + `refresh` + `update` (lifted verbatim from the current hook body).
- **Gate the fetch on the auth session**: read `useAuth()` and only call the Supabase query when `session !== null`. While `session` is `null`, hold the defaults without firing a request. Re-fetch when the user id changes (login / logout).
- Re-export `useUserSettings` as a thin `useContext` wrapper so every existing call site keeps working unchanged.

Mount once in `src/App.tsx` **inside** `<AuthProvider>` and outside `<Routes>` so it lives in the auth-aware subtree but persists across route changes:

```tsx
<AuthProvider>
  <UserSettingsProvider>
    <Routes>...</Routes>
  </UserSettingsProvider>
</AuthProvider>
```

`update()` already does an optimistic `setSettings({...prev, ...patch})`, so once state is shared the chat-pane header label flips the instant the user picks a new model.

### 6. Verification

- Pick each of the four models in the chat header → header label updates immediately, no reload needed.
- Send a plain chat message with each model → real response, no `Invalid model` errors in `chat` function logs.
- Upload a document and ask a question with each Claude model → real answer, not the fallback string. `[stream] tool iteration N` log lines should appear and Call #2 should produce text.
- Tail `chat` and `context-prompt` logs for `Invalid model` and "No response generated." occurrences — both should be gone.

## Technical notes

- `providerFor()` keys off the `mistral-` / `claude-` / `deepseek-` prefixes — the new IDs preserve those prefixes, so the router needs no change.
- `normaliseResponse()` is exported from `_llm.ts` but not yet used in the chat function; adopting it is a pure refactor (no new helper code).
- No schema change beyond the profile data backfill + default tweak.
