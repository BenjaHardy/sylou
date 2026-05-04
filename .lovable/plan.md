## Goal

Add a user popover (avatar bottom-left) with **Sign out** and **Settings…**. Settings lets the user pick the LLM independently for **Chat** and **FLOW analysis**, plus a couple of standard preferences. Add **DeepSeek V4 Flash** as a third provider (alongside Mistral and Anthropic). Display the active chat model in the chat header and the model that actually ran each FLOW report in its footer.

## Decisions confirmed from your feedback

1. **No `_shared/llm.ts`.** Confirmed by inspection: there is no `supabase/functions/_shared/` directory today, and nothing currently imports across function folders. Each Supabase edge function is an isolated Deno entrypoint, so I'll **inline a `callLLM` helper into each of `chat/`, `analysis/`, `editor-action/`, and `context-prompt/`** (same copy-per-folder pattern already used for `cleanLLMContent` / `extractDeltaText`). Single source of truth lives in this plan; I'll keep the four copies identical.

2. **History windows kept as today, with one fix:**
   - `chat/index.ts` — last **50** messages (already correct, line 398). ✅
   - `context-prompt/index.ts` — currently **20 cross-thread** (line 665). **Bump to 50.**
   - `analysis/index.ts` — full chat history (unchanged). ✅
   - **No user-facing setting** for history window. Removed from Settings dialog.

3. **FLOW-with-DeepSeek validation guardrail.** After the FLOW call returns, validate the parsed `submit_flow_analysis` tool payload against the existing Zod-equivalent shape (4 pillars × required fields, summary, key contributions). If validation fails:
   - Do **not** insert into `flow_reports`.
   - Do **not** charge tokens beyond what the provider already billed (we still log to `token_usage` for transparency, but flag `outcome='schema_invalid'`).
   - Return `{ error: "Analysis could not be completed with this model — try Claude Sonnet 4.6." }` to the frontend, surfaced as a toast.
   - Same guard wraps Mistral/Claude too (cheap insurance).

4. **Mistral slug backfill — wider scope.** Migration backfills `mistral-large-latest` → `mistral-large-3` in:
   - `profiles.preferred_chat_model`
   - `chat_messages.model_used`
   - `flow_reports.model_used`
   - `token_usage.model_used`
   - `ai_editor_actions` — N/A (no model column)

5. **Concise mode default behaviour.** `profiles.default_concise_mode` is the **initial value** only. On project load, `ChatPanel` reads it once and seeds local state. The existing per-session toggle keeps working and **never writes back** to the profile. Setting changes affect the next project opened, not the current session.

6. **Pricing display wording.** Add a small footnote under the model pickers:
   > *Indicative provider rates as of April 2026 — shown for transparency. Your actual usage is metered against your Ethos token budget, not billed per-token at these rates.*

7. **Claude Opus 4.7 context = 1M tokens.** Confirmed — both Sonnet 4.6 and Opus 4.7 use 1,000,000. `MODEL_CONTEXT_LIMITS` updated accordingly.

8. **Drop the project-summary footnote** from the Settings dialog. Not surfaced.

## Mid-project model switching — confirmed safe

Per-message and per-report `model_used` columns already exist; switching between prompts/reports is recorded faithfully. In-flight streams finish on the model that started them. No prompt rewrites needed across providers (all three accept the same OpenAI-style tool schema; Anthropic uses a thin Messages wrapper). Project summaries piggyback on the chat model — no extra UI needed.

## Pricing reference (April 2026 web search)

| Model | Slug | Input $/1M | Output $/1M | Context |
|---|---|---|---|---|
| Mistral Large 3 | `mistral-large-3` | 2.00 | 6.00 | 256K |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 3.00 | 15.00 | 1M |
| Claude Opus 4.7 | `claude-opus-4-7` | 5.00 | 25.00 | 1M |
| DeepSeek V4 Flash *(experimental)* | `deepseek-v4-flash` | 0.14 | 0.28 | 1M |

## What you'll see

### 1. Sidebar user popover
Avatar becomes a `DropdownMenu` trigger with: name + email header · **Settings…** · **Sign out**. Standalone Sign-out link removed.

### 2. Settings dialog (tabbed)

**Models tab**
- **Chat model** — Mistral Large 3 · Claude Sonnet 4.6 · Claude Opus 4.7 · DeepSeek V4 Flash *(experimental)*
- **FLOW analysis model** — same four (Sonnet 4.6 marked recommended)
- Each row shows `~$X / 1M in · ~$Y / 1M out` + the transparency footnote above
- Note: *"Editor Ask/Propose uses your chat model. Switching takes effect on your next prompt; in-flight requests finish on the previous model."*

**Preferences tab**
- Display name → `profiles.display_name`
- Preferred language → `profiles.preferred_language`
- Default to "concise responses" → `profiles.default_concise_mode` (initial value only — does not lock per-session toggle)

**Account tab**
- Email (read-only) · Subscription tier (read-only) · Sign out (mirror)

### 3. Model display
- **ChatPanel header** — small `Badge` next to thread selector showing the active chat model. Live-updates with Settings.
- **FLOW report footer** — already renders `model_used`; map slug → friendly label via new `MODEL_LABELS`.

## Technical details

### DB migration
```sql
alter table public.profiles
  add column if not exists preferred_flow_model text not null default 'claude-sonnet-4-6',
  add column if not exists default_concise_mode boolean not null default false;

alter table public.profiles
  alter column preferred_chat_model set default 'mistral-large-3';

update public.profiles      set preferred_chat_model = 'mistral-large-3' where preferred_chat_model = 'mistral-large-latest';
update public.chat_messages set model_used           = 'mistral-large-3' where model_used = 'mistral-large-latest';
update public.flow_reports  set model_used           = 'mistral-large-3' where model_used = 'mistral-large-latest';
update public.token_usage   set model_used           = 'mistral-large-3' where model_used = 'mistral-large-latest';
```

### New secret
`DEEPSEEK_API_KEY` — endpoint `https://api.deepseek.com/v1/chat/completions` (OpenAI-compatible). Will be requested via `add_secret` as the first build step.

### Edge functions (each gets its own copy of `callLLM`)
- `chat/index.ts` — accept `model` from body, fall back to `profiles.preferred_chat_model`. Persist real `model_used` per message. History stays at 50.
- `analysis/index.ts` — accept `model` from body, fall back to `profiles.preferred_flow_model`. Wrap tool-call result in schema validator; on failure return error and skip insert. Write actual model into `flow_reports.model_used`.
- `editor-action/index.ts` — accept `model`, fall back to `profiles.preferred_chat_model`.
- `context-prompt/index.ts` — bump `.limit(20)` → `.limit(50)` (line 665). Same `model` plumbing as chat.

`callLLM({ model, messages, stream, tools? })` dispatches by slug prefix:
- `mistral-` → Mistral `/v1/chat/completions`
- `claude-`  → Anthropic `/v1/messages` (translates tool schema)
- `deepseek-`→ DeepSeek `/v1/chat/completions` (OpenAI-shape)

All three normalised to a unified SSE delta + tool-call shape.

### Frontend
- `src/lib/models.ts` — registry: id, label, provider, isExperimental, pricing { input, output }, contextLimit. Source of truth for `MODEL_LABELS`.
- `src/lib/estimateTokens.ts` — extend `MODEL_CONTEXT_LIMITS`:
  - `mistral-large-3`: 256_000
  - `claude-sonnet-4-6`: 1_000_000 (already)
  - `claude-opus-4-7`: 1_000_000
  - `deepseek-v4-flash`: 1_000_000
- `src/hooks/useUserSettings.ts` — react-query around the user's `profiles` row + mutation.
- `src/components/SettingsDialog.tsx` — tabbed dialog (Models / Preferences / Account).
- `DashboardSidebar.tsx` — avatar wrapped in `DropdownMenu`; remove inline Sign-out; add Settings + Sign out items.
- `ChatPanel.tsx` — model badge in header; pass `model` to `useChatMessages.sendMessage`; on mount seed concise state from `profiles.default_concise_mode` (no write-back).
- `useFlowAnalysis.ts` — pass `model: settings.flowModel` to `analysis`; surface schema-validation error as toast.
- `CreativeAITextField.tsx` / editor-action callers — pass `model: settings.chatModel`.
- `FlowReportFooter.tsx` — pretty-print `model_used` via `MODEL_LABELS`.

## Build steps once approved
1. Request `DEEPSEEK_API_KEY` via `add_secret` (you'll be prompted).
2. Run DB migration (2 new columns, default change, 4 backfill UPDATEs).
3. Inline `callLLM` into the 4 edge functions; bump context-prompt limit to 50; add FLOW schema validator.
4. Add `src/lib/models.ts`, extend `MODEL_CONTEXT_LIMITS`, add `useUserSettings`, `SettingsDialog`, sidebar dropdown.
5. Wire chat header badge, FLOW footer label, and model passing through `useChatMessages` / `useFlowAnalysis` / editor actions.

Approve and I'll start with the secret request.
