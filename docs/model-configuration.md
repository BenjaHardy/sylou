# Model Configuration Reference

This document tracks how Sylou configures each LLM model across the four main edge functions (FLOW analysis, Chat, Editor actions, Context-prompt) and the two summary calls (document import, conversation memory). It serves as a single source of truth for what's set where, why, and how the models behave in practice.

**When to update this document:**

- A new model is added to `src/lib/models.ts`
- A temperature, effort, or thinking value is changed in `_temperatures.ts` or `_thinking.ts`
- Observed model behavior changes (e.g., a model's response quality changes after a provider update)

**Last updated:** October 2026

---

## Quick reference

| Model              | Provider  | Pricing (in/out per 1M) | Context (input token limit) | API ID               |
| ------------------ | --------- | ----------------------- | --------------------------- | -------------------- |
| Claude Sonnet 4.6  | Anthropic | $3.00 / $15.00          | 1M                          | `claude-sonnet-4-6`  |
| Claude Sonnet 5.5  | Anthropic | $2.00 / $10.00          | 1M                          | `claude-sonnet-5-5`  |
| Claude Opus 4.8    | Anthropic | $5.00 / $25.00          | 1M                          | `claude-opus-4-8`    |
| Claude Opus 5.5    | Anthropic | $4.00 / $20.00          | 1M                          | `claude-opus-5-5`    |
| Claude Fable 5.1   | Anthropic | $10.00 / $50.00         | 1M                          | `claude-fable-5-1`   |
| Mistral Large 3    | Mistral   | $0.50 / $1.50           | 256K                        | `mistral-large-2512` |
| Mistral Medium 3.5 | Mistral   | $1.50 / $7.50           | 256K                        | `mistral-medium-3-5` |
| Mistral Small 4    | Mistral   | $0.15 / $0.60           | 256K                        | `mistral-small-2603` |
| DeepSeek V4 Flash** | DeepSeek | $0.30 / $1.20 (peak)    | 1M                          | `deepseek-v4-flash`  |
| Z.ai GLM 5.3       | Mistral*  | $1.40 / $4.40           | 1M                          | `zai-glm-5-3`        |

*Pricing as of October 2026 (Anthropic pricing page, Mistral model cards, DeepSeek pricing page); verify against provider pricing pages before publishing. Cache reads: $0.30 Sonnet 4.6, $0.50 Opus 4.8, $0.20 Sonnet 5.5 and Opus 5.5, $0.25 Fable 5.1, $0.14 GLM 5.3 (cached input), $0.006 DeepSeek (cache hit).*

\*\* `deepseek-v4-flash` is a legacy id: DeepSeek retired V4 Flash and serves
it with DeepSeek-V4.1-Flash at the Flash price (half price off-peak, outside
01:00–04:00 and 06:00–10:00 UTC on weekdays). The model runs in thinking
mode by default; Sylou does not configure its thinking fields yet.

\* Z.ai GLM 5.3 is a **third-party open model** (Z.ai) hosted unmodified on
the Mistral API on EU infrastructure. It routes through Sylou's Mistral path
and uses the operator's `MISTRAL_API_KEY`. GLM 5.3 is a **reasoning-only**
model: `reasoning_effort` accepts "low" | "high" | "max", the model's own
default is "max" when the field is omitted, and reasoning cannot be disabled.
Note: "low" and "max" are **GLM-only** levels (Mistral's own reasoning models
accept "high" | "none" and must never be configured with either).

---

## Configuration by model × function

### FLOW (analysis)

The most analytically demanding function. All models targeted for determinism (temperature 0) when possible, with reasoning enabled where supported.

| Model              | Temperature                  | Thinking / Effort                                      | max_tokens (output) | Notes                                                                                           |
| ------------------ | ---------------------------- | ------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------- |
| Claude Sonnet 4.6  | 0.0                          | thinking: off, effort: high (matches provider default) | 8192                | *Recommended* for FLOW; quality and repeatability. |
| Claude Sonnet 5.5  | undefined (rejects any value) | thinking: adaptive, effort: xhigh                     | 24000               | Not yet recommended: field tests pending (experimental badge). |
| Claude Opus 4.8    | undefined (model-controlled) | thinking: adaptive, effort: high                       | 24000               | Adaptive thinking; consumes more tokens than Sonnet, not recommended by default except for specific scenarios.         |
| Claude Opus 5.5    | undefined (rejects any value) | thinking: always on, effort: xhigh                    | 24000               | Not yet recommended: field tests pending (experimental badge). |
| Claude Fable 5.1   | undefined (rejects any value) | thinking: always on, effort: medium                   | 24000               | Not yet recommended: field tests pending. Slower turns, hence medium; needs an Anthropic account with 30-day data retention. |
| Mistral Large 3    | 0.0                          | n/a (no reasoning support)                             | 8192                | *Not* recommended, strong inherent bias towards the user.                                       |
| Mistral Medium 3.5 | 0.0                          | reasoning_effort: off                                  | 8192                | *Not* recommended. Good repeatability, but strong Write pillar and provenance data lead to user-bias on other pillars. |
| Mistral Small 4    | 0.0                          | reasoning_effort: high                                 | 24000               | *Not* recommended, bias towards the user, poor repeatability.  |
| DeepSeek V4 Flash  | 0.0 (no effect in thinking mode) | provider default thinking mode (not configured)    | 8192                | *Not* recommended, bias towards the user, poor repeatability.  |
| Z.ai GLM 5.3       | 0.0                          | reasoning_effort: high                                 | 24000               | *Not* recommended, bias toward the user (unlike GLM 5.2, which is however retiring from Mistral API). |

**Rationale for FLOW settings:**

- max_tokens 24000 for reasoning models (in step with chat and context-prompt): thinking chunks consume output budget; insufficient headroom causes truncation and validation failures. FLOW is a single non-streamed call aborted at 145 s; an attempt the provider cut at the ceiling is not retried (the retry exists for format slips, and a budget overrun at temperature 0 would only repeat).
- GLM 5.3 (October 2026 field test): at "low", "high" and "max" alike the scores lean toward the user and lack the independence GLM 5.2 (retiring from Mistral API) showed at "max". Hence not recommended, left at "high" for anyone who selects it. Claude Sonnet 4.6 is the default FLOW model for new profiles since 2026-10-02.
- Opus 4.7 and later, Sonnet 5.5 and Fable 5.1 are excluded from the temperature setting (any non-default sampling parameter returns 400), so FLOW repeatability on them rests on the model and the prompt.
- Sonnet 5.5 and Opus 5.5 start at xhigh ("extra"), the level below max: a starting point for the field tests, one table entry away from high if runs approach the 145 s limit or truncate. Fable 5.1 starts at medium because its turns are the slowest.

---

### Chat

Conversational responses. Quality matters; reasoning effort calibrated per model tier.

| Model              | Temperature                  | Thinking / Effort                | max_tokens (output) | Notes                                                                 |
| ------------------ | ---------------------------- | -------------------------------- | ------------------- | --------------------------------------------------------------------- |
| Claude Sonnet 4.6  | 1.0                          | thinking: off, effort: high      | 4000                | Default chat behavior.                                                |
| Claude Sonnet 5.5  | undefined (rejects any value) | thinking: adaptive, effort: medium | 24000             | "Off" in the picker sends `between_tools`.                            |
| Claude Opus 4.8    | undefined (model-controlled) | thinking: adaptive, effort: high | 24000               | Adaptive thinking; raises max_tokens.                                 |
| Claude Opus 5.5    | undefined (rejects any value) | thinking: always on, effort: medium | 24000            | Thinking cannot be turned off; effort is the only control.            |
| Claude Fable 5.1   | undefined (rejects any value) | thinking: always on, effort: medium | 24000            | Same; the slowest and most expensive model.                           |
| Mistral Large 3    | 0.7                          | n/a                              | 4000                | Standard chat.                                                        |
| Mistral Medium 3.5 | 0.7                          | reasoning_effort: high           | 24000               | Mistral "Quality tier" — reasoning enabled.                           |
| Mistral Small 4    | 0.7                          | reasoning_effort: none           | 4000                | Mistral "Speed tier" — no thinking chunk; ideal for cheap, fast chat. |
| DeepSeek V4 Flash  | 1.0 (no effect in thinking mode) | provider default thinking mode (not configured) | 4000 | Cheap chat; the default thinking shares the plain ceiling. |
| Z.ai GLM 5.3       | 0.7                          | reasoning_effort: high           | 24000               | Third-party (Z.ai) via Mistral API; 1M context. "max" is its deep-reasoning level: occasionally significant thinking before the first answer token. |

**Rationale for Chat settings:**

- Temperature at provider default: 1.0 for Claude Sonnet and DeepSeek, 0.7 for Mistral; allows natural variation for conversational warmth.
- Reasoning effort tier-matched: e.g. GLM 5.3 and Medium 3.5 get reasoning; Small ("speed tier") doesn't.
- max_tokens 4000, 24000 for reasoning models: same logic as FLOW. Raised from 8000 in October 2026 after GLM 5.3 at "max" spent whole budgets thinking. 
- Streams send an SSE keep-alive comment every 15 s for their whole life: a response with no bytes for ~50 s during a long think was observed being closed in front of the function (the provider read then ends with no finish reason and no text).

---

### Editor actions (Translate, Fix Grammar, Rewrite, Simplify, Expand)

Inline rewrites and proposals from within the editor. Latency-sensitive.

| Model              | Temperature                  | Thinking / Effort                | max_tokens (output) | Notes                                           |
| ------------------ | ---------------------------- | -------------------------------- | ------------------- | ----------------------------------------------- |
| Claude Sonnet 4.6  | 1.0                          | thinking: off, effort: high      | 4000                | Fast inline action.                             |
| Claude Sonnet 5.5  | undefined (rejects any value) | thinking: adaptive, effort: low | 6000                | Low keeps the action snappy.                    |
| Claude Opus 4.8    | undefined (model-controlled) | thinking: adaptive, effort: high | 6000                | Adaptive thinking; raises max_tokens.           |
| Claude Opus 5.5    | undefined (rejects any value) | thinking: always on, effort: low | 6000               | Cannot turn thinking off; low is the lightest. |
| Claude Fable 5.1   | undefined (rejects any value) | thinking: always on, effort: low | 6000               | Same.                                           |
| Mistral Large 3    | 0.7                          | n/a                              | 4000                | Standard.                                       |
| Mistral Medium 3.5 | 0.7                          | reasoning_effort: none           | 4000                | No reasoning — editor actions should be snappy. |
| Mistral Small 4    | 0.7                          | reasoning_effort: none           | 4000                | Same as Medium for editor.                      |
| DeepSeek V4 Flash  | 1.0 (no effect in thinking mode) | provider default thinking mode (not configured) | 4000 | Standard.                            |
| Z.ai GLM 5.3       | 0.7                          | reasoning_effort: low            | 6000                | Third-party via Mistral API; reasoning cannot be disabled, so the lightest level keeps editor actions snappy (reasoning ceiling). |

**Rationale for Editor settings:**

- Reasoning disabled by default (or at the lightest level where the model cannot disable it, GLM 5.3): editor actions are short, standard, latency-sensitive; thinking-chunk overhead isn't justified.
- max_tokens 4000, 6000 with reasoning. NB: The selection window shows a notice (acknowledge to proceed) for selections beyond ~13,600 characters, and a reply the provider cut off at max_tokens arrives flagged `truncated` (through `src/lib/editor-limits.ts`).

---

### Context-prompt (work summarization, Ask/Propose actions)

Provides AI features with context grounded in the written work. Used by Ask/Propose and underlying work summaries.

| Model | Temperature | Thinking / Effort(*) | max_tokens (summary) (output) | max_tokens (response) (output) | Notes |
|---|---|---|---|---|---|
| Claude Sonnet 4.6 | 1.0 | thinking: off, effort: high | 2000 | 4000 | Standard. |
| Claude Sonnet 5.5 | undefined (rejects any value) | thinking: adaptive, effort: medium (summary: low) | 4000 | 24000 | |
| Claude Opus 4.8 | undefined (model-controlled) | thinking: adaptive, effort: high (summary: off) | 2000 | 24000 | Adaptive thinking on the reply; the writing summary no longer thinks (October 2026). |
| Claude Opus 5.5 | undefined (rejects any value) | thinking: always on, effort: medium (summary: low) | 4000 | 24000 | |
| Claude Fable 5.1 | undefined (rejects any value) | thinking: always on, effort: medium (summary: low) | 4000 | 24000 | |
| Mistral Large 3 | 0.7 | n/a | 2000 | 4000 | Standard. |
| Mistral Medium 3.5 | 0.7 | reasoning_effort: high | 4000 | 24000 | Mistral quality tier — reasoning helps with nuanced AI features. |
| Mistral Small 4 | 0.7 | reasoning_effort: none | 2000 | 4000 | Mistral speed tier. |
| DeepSeek V4 Flash | 1.0 (no effect in thinking mode) | provider default thinking mode (not configured) | 2000 | 4000 | Standard. |
| Z.ai GLM 5.3 | 0.7 | reasoning_effort: high (summary: low) | 4000 | 24000 | Third-party via Mistral API. |

**Rationale for Context-prompt settings:**

- Matches Chat defaults: context-prompt powers Ask/Propose user-facing features, so quality posture should align with chat.
- max_tokens 4000/24000 for the response and 2000/4000 for the summary (plain / reasoning; `OUTPUT_BUDGETS.CONTEXT_RESPONSE` and `.CONTEXT_SUMMARY`).
- (*)The writing-summary call (Call #1) keeps fixed settings whatever reasoning level the user picked: the Summaries table below for every provider (Claude 4.x without thinking, the 5.5 models and Fable 5.1 at low, GLM at "low"). It runs before the stream starts and is a delta summary, not a reply.

---

### Summaries (document import, conversation memory)

Two small summary calls outside the four functions above, both on the user's chat model: `extract-text` writes the 3–5 sentence summary of an imported document (the index the assistant reads before deciding whether to open the full text), and `_shared/_conversation_memory.ts` maintains the rolling per-thread chat summary (TRANSPARENCY.md §5.5).

| Model | Temperature (document / memory) | Thinking / Effort | max_tokens (document summary) | max_tokens (conversation memory) | Notes |
|---|---|---|---|---|---|
| Claude Sonnet 4.6 | 1.0 / 0.3 | thinking: off, effort: high | 500 | 3000 | Standard. |
| Claude Sonnet 5.5 | undefined (rejects any value) | thinking: adaptive, effort: low | 2000 | 6000 | Low with the reasoning ceilings. |
| Claude Opus 4.8 | undefined (model-controlled) | thinking: off, effort: high | 500 | 3000 | No thinking on these calls. |
| Claude Opus 5.5 | undefined (rejects any value) | thinking: always on, effort: low | 2000 | 6000 | Cannot turn thinking off; low with the reasoning ceilings. |
| Claude Fable 5.1 | undefined (rejects any value) | thinking: always on, effort: low | 2000 | 6000 | Same. |
| Mistral Large 3 | 0.7 / 0.3 | n/a | 500 | 3000 | Standard. |
| Mistral Medium 3.5 | 0.7 / 0.3 | reasoning_effort: none | 500 | 3000 | Short summaries don't need reasoning. |
| Mistral Small 4 | 0.7 / 0.3 | reasoning_effort: none | 500 | 3000 | Same. |
| DeepSeek V4 Flash | 1.0 / 0.3 (no effect in thinking mode) | provider default thinking mode (not configured) | 500 | 3000 | Standard. |
| Z.ai GLM 5.3 | 0.7 / 0.3 | reasoning_effort: low | 2000 | 6000 | Reasoning cannot be disabled; lightest level with the reasoning ceilings. |

**Rationale for Summary settings:**

- Document summaries reuse the chat temperature table; conversation memory uses `SUMMARY_TEMPERATURE` (0.3 — faithful carry-over over prose variety).
- max_tokens 500 / 2000 (document) and 3000 / 6000 (memory), plain / reasoning (`OUTPUT_BUDGETS.DOC_SUMMARY` and `.MEMORY`).
- The Claude settings live in `SUMMARY_THINKING` / `SUMMARY_EFFORT` (October 2026), which the context-prompt writing summary uses too: a model that cannot turn thinking off would otherwise think at its own default inside the small plain ceilings and return nothing (the GLM 5.3 lesson).

---

### User-selectable reasoning (chat and Ask/Propose)

Settings → Models lets each user pick a reasoning level for the selected chat model. It applies to chat replies and to the Ask/Propose reply call, replacing the default from the Chat and Context-prompt tables above; FLOW, editor actions, the Ask/Propose writing-summary call and the summary calls keep their fixed settings. The level in force is shown next to the model name above the chat. The stored choice (`profiles.preferred_chat_reasoning`, a per-model map) is validated server-side against `CHAT_REASONING_OPTIONS` in `_shared/_thinking.ts`; an unknown or missing entry means the default. The picker labels come from the mirror in `src/lib/models.ts`.

| Model | Options (default in bold) | Wire mapping |
|---|---|---|
| Claude Sonnet 4.6 | **Off**, Low, Medium, High | Off = thinking off, effort high; the others = adaptive thinking with that effort |
| Claude Sonnet 5.5 | Off, Low, **Medium**, High, Extra, Max (slow) | Off = `thinking: {type: "between_tools"}` at effort high; Extra = effort xhigh; Max = effort max |
| Claude Opus 4.8 | Off, Low, Medium, **High**, Extra, Max (slow) | as Sonnet 4.6; Extra = effort xhigh; Max = effort max (until October 2026 "Max" meant xhigh) |
| Claude Opus 5.5 | Low, **Medium**, High, Extra, Max (slow) | adaptive thinking cannot be turned off, so no Off; Extra = xhigh, Max = max |
| Claude Fable 5.1 | Low, **Medium**, High, Extra, Max (slow) | same |
| Mistral Medium 3.5 | Off, **High** | reasoning_effort omitted / high |
| Mistral Small 4 | **Off**, High | reasoning_effort omitted / high |
| Z.ai GLM 5.3 | Low, **High**, Max (slow) | reasoning_effort low / high / max |
| Mistral Large 3, DeepSeek V4 Flash | — | no reasoning control |

The max_tokens ceiling follows the choice: the reasoning ceiling applies whenever a level other than Off is in force. "Max (slow)" says slow because the delay is what the user sees; the thinking tokens are billed as output (a 30k-token think costs $0.30 on Sonnet 5.5, $0.60 on Opus 5.5, $1.50 on Fable 5.1) and can exhaust the 24k reasoning ceiling, which surfaces as an empty reply.

---

## Where to find these settings in code

| Setting                                       | File                                          | Notes                                                                                             |
| --------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Model registry (which models exist)           | `src/lib/models.ts`                           | Pricing, labels, default chat model, the `flowRecommended` flag and the groupings behind the Settings pickers (by API for chat, by FLOW recommendation for FLOW). |
| Temperature per function × model              | `supabase/functions/_shared/_temperatures.ts` | Five tables: `FLOW_TEMPERATURE`, `CHAT_TEMPERATURE`, `EDITOR_TEMPERATURE`, `CONTEXT_TEMPERATURE`, `SUMMARY_TEMPERATURE` (conversation-memory consolidation, 0.3 — faithful carry-over over prose variety). |
| Claude thinking + effort per function × model | `supabase/functions/_shared/_thinking.ts`     | Tables: `*_THINKING`, `*_EFFORT`.                                                                 |
| Mistral reasoning_effort per function × model | `supabase/functions/_shared/_thinking.ts`     | Tables: `*_MISTRAL_EFFORT` (FLOW, CHAT, EDITOR, CONTEXT, SUMMARY).                                                                       |
| Reasoning-supported Mistral models            | `supabase/functions/_shared/_thinking.ts`     | `MISTRAL_REASONING_MODELS` set.                                                                   |
| max_tokens ceilings (plain / reasoning pairs) | `supabase/functions/_shared/_models.ts`       | `OUTPUT_BUDGETS`; `resolveMaxTokens()` in `_thinking.ts` picks the member that applies.           |
| User-selectable reasoning (chat, Ask/Propose) | `supabase/functions/_shared/_thinking.ts`     | `CHAT_REASONING_OPTIONS`, `resolveReasoning()`; UI mirror `CHAT_REASONING_OPTIONS` in `src/lib/models.ts`. |
| Anthropic models without temperature          | `supabase/functions/_shared/_temperatures.ts` | `NO_TEMPERATURE_MODELS` set.                                                                      |
| Claude thinking rules per model               | `supabase/functions/_shared/_models.ts`       | `CLAUDE_ALWAYS_THINKING` (thinking cannot be turned off; forced on by `resolveThinking`), `CLAUDE_THINKING_OFF_BETWEEN_TOOLS` ("off" is sent as `between_tools`). |
| Refusal message                               | `supabase/functions/_shared/_llm.ts`          | `fallbackReplyText` (an explicit message on `stop_reason: "refusal"`, no fallback model). |
| Server-side model allowlist + input limits    | `supabase/functions/_shared/_models.ts`       | `ALLOWED_MODELS` (gates the `model` request override), `INPUT_LIMITS` (request text ceilings), `CONTEXT_LIMIT_TOKENS` (per-model context windows, mirrors the registry). |
| FLOW imported-documents budget                | `supabase/functions/analysis/index.ts`        | `FLOW_IMPORTED_DOCS_BUDGET_TOKENS` cost ceiling; effective allowance = min(policy, model-window remainder after the never-truncated sections). |
| Provider request timeout                      | `supabase/functions/_shared/_llm.ts`          | `callLLM` `timeoutMs` — default 120s; analysis passes 145s (hosted request-idle limit is 150s); Brave web-search fetches use a 10s `AbortSignal.timeout`. |
| Body-level wire format (per provider)         | `supabase/functions/_shared/_llm.ts`          | `toAnthropicBody`, `toOpenAIBody`.                                                                |

---

## Known model-specific constraints

- **Claude Opus 4.7 and later, Sonnet 5.5, Fable 5.1**: Return 400 if `temperature` (or any sampling parameter) is set to a non-default value. Must omit the field entirely via `NO_TEMPERATURE_MODELS`.
- **Claude Opus 5.5 and Fable 5.1**: Thinking cannot be turned off (`disabled` and `budget_tokens` are 400s); effort is the only control, and Opus 5.5's API default is medium, so Sylou always sends effort explicitly. Fable 5.1 additionally requires an Anthropic organisation with 30-day data retention (zero-data-retention accounts get a 400) and has the slowest turns.
- **Claude Sonnet 5.5**: `thinking: {type: "disabled"}` is a 400; the lowest setting is `between_tools` (effort high or below, no other field), which Sylou sends for "Off".
- **Claude Sonnet 5.5, Opus 5.5, Fable 5.1**: Forced tool choice (`any`, a named tool) is a 400; Sylou's Anthropic FLOW path uses Structured Outputs and sends none. Inside a tool loop their thinking blocks are bound to the exact prefix that produced them (preserved thinking): Sylou echoes assistant turns as received and keeps the tool list on the final call with `tool_choice: none`.
- **Claude refusals**: a safety-classifier decline is an HTTP 200 with `stop_reason: "refusal"`; chat, Ask/Propose and editor actions show an explicit message, FLOW returns its own error, and no other model is tried.
- **Mistral Large 3**: Returns 422 if `reasoning_effort` is set. Field guarded by `MISTRAL_REASONING_MODELS` in `toOpenAIBody`.
- **Z.ai GLM 5.3**: Reasoning-only. `reasoning_effort` accepts "low" | "high" | "max"; omitting the field means the model's own default ("max"), and reasoning cannot be disabled.
- **Mistral Magistral models**: Reason natively; reject `reasoning_effort` parameter (not currently in Sylou's registry but worth noting if added).
- **Anthropic Structured Outputs**: Strips most JSON Schema constraints (`maxItems`, `minLength`, `maximum`, etc.). Schema sanitizer in `_llm.ts` handles this transparently.

---

## Checklist: Adding a New Model to Sylou

1. Register the model in the frontend
   
    Add entry to MODELS array in src/lib/models.ts (id, label, provider, pricing, contextLimit, note).
    Add legacy alias to MODEL_LABELS if this model replaces an existing ID (so historical reports/chat messages still render a friendly label).
    Update DEFAULT_CHAT_MODEL and/or DEFAULT_FLOW_MODEL in src/lib/models.ts if this model becomes a new default.

2. Register the model in edge functions
   
    Add the model id to ALLOWED_MODELS in supabase/functions/_shared/_models.ts — requests naming a model not in this set are rejected with 400, so a model missing here is selectable in Settings but unusable via the request override.
   
    Add the model's context window to CONTEXT_LIMIT_TOKENS in the same file (a mirror of contextLimit in src/lib/models.ts): the FLOW imported-documents budget and the report's token-usage disclosure read it. A missing id falls back to a conservative 200k window.
   
    Update fallback model strings in each edge function that references a default:
   
        supabase/functions/chat/index.ts
        supabase/functions/analysis/index.ts
        supabase/functions/editor-action/index.ts
        supabase/functions/context-prompt/index.ts
        supabase/functions/extract-text/index.ts
   
    Add temperature entries in supabase/functions/_shared/_temperatures.ts for every function where behavior should differ from the provider default.
   
        For FLOW_TEMPERATURE, always use 0.0.
        For other functions, use the conservative provider default (e.g., 0.7 for Mistral, 1.0 for Claude/DeepSeek).
        If a model rejects any non-default temperature with HTTP 400, add it to NO_TEMPERATURE_MODELS.
   
    Add reasoning/effort entries in supabase/functions/_shared/_thinking.ts if the model supports configurable reasoning:
   
        Claude: add to every *_THINKING and *_EFFORT table (FLOW, CHAT, EDITOR, CONTEXT, SUMMARY; a test checks every Claude model is in every table). If the model cannot turn thinking off, add it to CLAUDE_ALWAYS_THINKING in _models.ts; if its "off" is `between_tools`, to CLAUDE_THINKING_OFF_BETWEEN_TOOLS.
        Mistral: add to the *_MISTRAL_EFFORT tables (FLOW, CHAT, EDITOR, CONTEXT, SUMMARY) and to the MISTRAL_REASONING_MODELS allowlist. A reasoning-only model needs an explicit level in every table (never "none").
        DeepSeek: deepseek-v4-flash is served in thinking mode by default (V4.1 Flash); its thinking / reasoning_effort fields are not configured yet (follow-up).
   
    Check NO_TEMPERATURE_MODELS in _temperatures.ts (Anthropic Opus 4.7+ rejects temperature).

    If users may pick the reasoning level, add the model's options to CHAT_REASONING_OPTIONS in _thinking.ts and to the mirror in src/lib/models.ts (ids, labels, default); the chat/context tables must name a combination one of the options covers (a test checks this).

3. Adjust token budgets (if needed)
   
    Review the `OUTPUT_BUDGETS` pairs in `_shared/_models.ts`. Only change these if the new model has a hard output limit lower than a current ceiling.
   
        resolveMaxTokens() picks the `reasoning` ceiling automatically when reasoning/thinking is enabled for the model, so the pairs typically stay the same.

4. Update schema defaults (if this is a new system default)
   
    Add a Supabase migration to update column defaults on profiles.preferred_chat_model and/or profiles.preferred_flow_model so new users inherit the new default.

5. Update documentation
   
    Add a row to the configuration tables (FLOW, Chat, Editor, Context-prompt) in this document.

6. Verify and test
   
    Deploy and inspect [callLLM] outbound logs for a test call. Verify:
   
        temperature matches the table value.
        thinking / effort / reasoning_effort are present and correct.
        max_tokens is scaled appropriately when reasoning is on.
        For Mistral at temperature: 0, top_p: 1 is auto-injected (avoids greedy-sampling errors).

---

## References

- Anthropic thinking (adaptive thinking, effort, preserved thinking): https://platform.claude.com/docs/en/build-with-claude/thinking
- Anthropic Claude migration guide: https://platform.claude.com/docs/en/about-claude/models/migration-guide
- Anthropic Structured Outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Mistral adjustable reasoning: https://docs.mistral.ai/capabilities/reasoning/adjustable
- Mistral model overview: https://docs.mistral.ai/getting-started/models/models_overview/
- Mistral model card, Z.ai GLM 5.3: https://docs.mistral.ai/models/zai-glm-5-3
- Z.ai GLM-5.3 guide (reasoning levels, reasoning-only): https://docs.z.ai/guides/llm/glm-5.3
