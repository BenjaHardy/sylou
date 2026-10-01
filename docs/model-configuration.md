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
| Claude Opus 4.8    | Anthropic | $5.00 / $25.00          | 1M                          | `claude-opus-4-8`    |
| Mistral Large 3    | Mistral   | $0.50 / $1.50           | 256K                        | `mistral-large-2512` |
| Mistral Medium 3.5 | Mistral   | $1.50 / $7.50           | 256K                        | `mistral-medium-3-5` |
| Mistral Small 4    | Mistral   | $0.15 / $0.60           | 256K                        | `mistral-small-2603` |
| DeepSeek V4 Flash  | DeepSeek  | $0.14 / $0.28           | 1M                          | `deepseek-v4-flash`  |
| Z.ai GLM 5.3       | Mistral*  | $1.40 / $4.40           | 1M                          | `zai-glm-5-3`        |

*Pricing as of July 2026 (GLM 5.3: September 2026); verify against provider pricing pages before publishing.*

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
| Claude Opus 4.8    | undefined (model-controlled) | thinking: adaptive, effort: high                       | 16000               | Adaptive thinking; consumes more tokens than Sonnet, not recommended by default except for specific scenarios.         |
| Mistral Large 3    | 0.0                          | n/a (no reasoning support)                             | 8192                | *Not* recommended, strong inherent bias towards the user.                                       |
| Mistral Medium 3.5 | 0.0                          | reasoning_effort: off                                  | 8192                | *Not* recommended. Good repeatability, but strong Write pillar and provenance data lead to user-bias on other pillars. |
| Mistral Small 4    | 0.0                          | reasoning_effort: high                                 | 16000               | *Not* recommended, bias towards the user, poor repeatability.  |
| DeepSeek V4 Flash  | 0.0                          | n/a                                                    | 8192                | *Not* recommended, bias towards the user, poor repeatability.  |
| Z.ai GLM 5.3       | 0.0                          | reasoning_effort: high                                 | 16000               | *Recommended* for FLOW; quality and repeatability. |

**Rationale for FLOW settings:**

- max_tokens 16000 for reasoning models: thinking chunks consume output budget; insufficient headroom causes truncation and validation failures.
- GLM 5.3 at "high", not "max": at "max" it spent the whole 16000 thinking and never called the submit tool (both attempts, staging 2026-10-01); at "high" it thinks briefly and answers.
- Opus 4.7+ excluded from temperature setting (returns 400 if non-default temperature is sent).

---

### Chat

Conversational responses. Quality matters; reasoning effort calibrated per model tier.

| Model              | Temperature                  | Thinking / Effort                | max_tokens (output) | Notes                                                                 |
| ------------------ | ---------------------------- | -------------------------------- | ------------------- | --------------------------------------------------------------------- |
| Claude Sonnet 4.6  | 1.0                          | thinking: off, effort: high      | 4000                | Default chat behavior.                                                |
| Claude Opus 4.8    | undefined (model-controlled) | thinking: adaptive, effort: high | 24000               | Adaptive thinking; raises max_tokens.                                 |
| Mistral Large 3    | 0.7                          | n/a                              | 4000                | Standard chat.                                                        |
| Mistral Medium 3.5 | 0.7                          | reasoning_effort: high           | 24000               | Mistral "Quality tier" — reasoning enabled.                           |
| Mistral Small 4    | 0.7                          | reasoning_effort: none           | 4000                | Mistral "Speed tier" — no thinking chunk; ideal for cheap, fast chat. |
| DeepSeek V4 Flash  | 1.0                          | n/a                              | 4000                | Standard, cheap chat.                                                 |
| Z.ai GLM 5.3       | 0.7                          | reasoning_effort: high           | 24000               | Third-party (Z.ai) via Mistral API; 1M context. "max" is its deep-reasoning level: a minute or more of thinking before the first answer token. |

**Rationale for Chat settings:**

- Temperature at provider default: 1.0 for Claude Sonnet and DeepSeek, 0.7 for Mistral; allows natural variation for conversational warmth.
- Reasoning effort tier-matched: e.g. GLM 5.3 and Medium 3.5 get reasoning; Small ("speed tier") doesn't.
- max_tokens 4000, 24000 for reasoning models: same logic as FLOW. Raised from 8000 in October 2026 after GLM 5.3 at "max" spent whole budgets thinking (a direct capture showed ~15k tokens of thinking before the first answer token); a ceiling costs nothing until it is hit. Sized for a Pro plan's 400 s wall clock: on the free plan (150 s) a "max" think can outrun the limit before it reaches the ceiling, which drops the request instead of truncating the reply — the option is labelled "Max (slow)" for that reason.
- Streams send an SSE keep-alive comment every 15 s for their whole life: a response with no bytes for ~50 s during a long think was observed being closed in front of the function (the provider read then ends with no finish reason and no text).

---

### Editor actions (Translate, Fix Grammar, Rewrite, Simplify, Expand)

Inline rewrites and proposals from within the editor. Latency-sensitive.

| Model              | Temperature                  | Thinking / Effort                | max_tokens (output) | Notes                                           |
| ------------------ | ---------------------------- | -------------------------------- | ------------------- | ----------------------------------------------- |
| Claude Sonnet 4.6  | 1.0                          | thinking: off, effort: high      | 4000                | Fast inline action.                             |
| Claude Opus 4.8    | undefined (model-controlled) | thinking: adaptive, effort: high | 6000                | Adaptive thinking; raises max_tokens.           |
| Mistral Large 3    | 0.7                          | n/a                              | 4000                | Standard.                                       |
| Mistral Medium 3.5 | 0.7                          | reasoning_effort: none           | 4000                | No reasoning — editor actions should be snappy. |
| Mistral Small 4    | 0.7                          | reasoning_effort: none           | 4000                | Same as Medium for editor.                      |
| DeepSeek V4 Flash  | 1.0                          | n/a                              | 4000                | Standard.                                       |
| Z.ai GLM 5.3       | 0.7                          | reasoning_effort: low            | 6000                | Third-party via Mistral API; reasoning cannot be disabled, so the lightest level keeps editor actions snappy (reasoning ceiling). |

**Rationale for Editor settings:**

- Reasoning disabled by default (or at the lightest level where the model cannot disable it, GLM 5.3): editor actions are short, standard, latency-sensitive; thinking-chunk overhead isn't justified.
- max_tokens 4000, 6000 with reasoning. NB: The selection window shows a notice (acknowledge to proceed) for selections beyond ~13,600 characters, and a reply the provider cut off at max_tokens arrives flagged `truncated` (through `src/lib/editor-limits.ts`).

---

### Context-prompt (work summarization, Ask/Propose actions)

Provides AI features with context grounded in the written work. Used by Ask/Propose and underlying work summaries.

| Model | Temperature | Thinking / Effort | max_tokens (summary) (output) | max_tokens (response) (output) | Notes |
|---|---|---|---|---|---|
| Claude Sonnet 4.6 | 1.0 | thinking: off, effort: high | 2000 | 4000 | Standard. |
| Claude Opus 4.8 | undefined (model-controlled) | thinking: adaptive, effort: high | 4000 | 24000 | Adaptive thinking. |
| Mistral Large 3 | 0.7 | n/a | 2000 | 4000 | Standard. |
| Mistral Medium 3.5 | 0.7 | reasoning_effort: high | 4000 | 24000 | Mistral quality tier — reasoning helps with nuanced AI features. |
| Mistral Small 4 | 0.7 | reasoning_effort: none | 2000 | 4000 | Mistral speed tier. |
| DeepSeek V4 Flash | 1.0 | n/a | 2000 | 4000 | Standard. |
| Z.ai GLM 5.3 | 0.7 | reasoning_effort: high | 4000 | 24000 | Third-party via Mistral API. |

**Rationale for Context-prompt settings:**

- Matches Chat defaults: context-prompt powers Ask/Propose user-facing features, so quality posture should align with chat.
- max_tokens 4000/24000 for the response and 2000/4000 for the summary (plain / reasoning; `OUTPUT_BUDGETS.CONTEXT_RESPONSE` and `.CONTEXT_SUMMARY`).
- The writing-summary call (Call #1) keeps fixed settings whatever reasoning level the user picked: Claude as in the table, Mistral / GLM per the Summaries table (GLM at "low"). It runs before the stream starts and is a delta summary, not a reply.

---

### Summaries (document import, conversation memory)

Two small summary calls outside the four functions above, both on the user's chat model: `extract-text` writes the 3–5 sentence summary of an imported document (the index the assistant reads before deciding whether to open the full text), and `_shared/_conversation_memory.ts` maintains the rolling per-thread chat summary (TRANSPARENCY.md §5.5).

| Model | Temperature (document / memory) | Thinking / Effort | max_tokens (document summary) | max_tokens (conversation memory) | Notes |
|---|---|---|---|---|---|
| Claude Sonnet 4.6 | 1.0 / 0.3 | thinking: off | 500 | 3000 | Standard. |
| Claude Opus 4.8 | undefined (model-controlled) | thinking: off | 500 | 3000 | No thinking requested on these calls. |
| Mistral Large 3 | 0.7 / 0.3 | n/a | 500 | 3000 | Standard. |
| Mistral Medium 3.5 | 0.7 / 0.3 | reasoning_effort: none | 500 | 3000 | Short summaries don't need reasoning. |
| Mistral Small 4 | 0.7 / 0.3 | reasoning_effort: none | 500 | 3000 | Same. |
| DeepSeek V4 Flash | 1.0 / 0.3 | n/a | 500 | 3000 | Standard. |
| Z.ai GLM 5.3 | 0.7 / 0.3 | reasoning_effort: low | 2000 | 6000 | Reasoning cannot be disabled; lightest level with the reasoning ceilings. |

**Rationale for Summary settings:**

- Document summaries reuse the chat temperature table; conversation memory uses `SUMMARY_TEMPERATURE` (0.3 — faithful carry-over over prose variety).
- max_tokens 500 / 2000 (document) and 3000 / 6000 (memory), plain / reasoning (`OUTPUT_BUDGETS.DOC_SUMMARY` and `.MEMORY`).

---

### User-selectable reasoning (chat and Ask/Propose)

Settings → Models lets each user pick a reasoning level for the selected chat model. It applies to chat replies and to the Ask/Propose reply call, replacing the default from the Chat and Context-prompt tables above; FLOW, editor actions, the Ask/Propose writing-summary call and the summary calls keep their fixed settings. The level in force is shown next to the model name above the chat. The stored choice (`profiles.preferred_chat_reasoning`, a per-model map) is validated server-side against `CHAT_REASONING_OPTIONS` in `_shared/_thinking.ts`; an unknown or missing entry means the default. The picker labels come from the mirror in `src/lib/models.ts`.

| Model | Options (default in bold) | Wire mapping |
|---|---|---|
| Claude Sonnet 4.6 | **Off**, Low, Medium, High | Off = thinking off, effort high; the others = adaptive thinking with that effort |
| Claude Opus 4.8 | Off, Low, Medium, **High**, Max | as above; Max = effort xhigh |
| Mistral Medium 3.5 | Off, **High** | reasoning_effort omitted / high |
| Mistral Small 4 | **Off**, High | reasoning_effort omitted / high |
| Z.ai GLM 5.3 | Low, **High**, Max (slow) | reasoning_effort low / high / max |
| Mistral Large 3, DeepSeek V4 Flash | — | no reasoning control |

The max_tokens ceiling follows the choice: the reasoning ceiling applies whenever a level other than Off is in force.

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
| Server-side model allowlist + input limits    | `supabase/functions/_shared/_models.ts`       | `ALLOWED_MODELS` (gates the `model` request override), `INPUT_LIMITS` (request text ceilings), `CONTEXT_LIMIT_TOKENS` (per-model context windows, mirrors the registry). |
| FLOW imported-documents budget                | `supabase/functions/analysis/index.ts`        | `FLOW_IMPORTED_DOCS_BUDGET_TOKENS` cost ceiling; effective allowance = min(policy, model-window remainder after the never-truncated sections). |
| Provider request timeout                      | `supabase/functions/_shared/_llm.ts`          | `callLLM` `timeoutMs` — default 120s; analysis passes 145s (hosted request-idle limit is 150s); Brave web-search fetches use a 10s `AbortSignal.timeout`. |
| Body-level wire format (per provider)         | `supabase/functions/_shared/_llm.ts`          | `toAnthropicBody`, `toOpenAIBody`.                                                                |

---

## Known model-specific constraints

- **Claude Opus 4.7+ family**: Returns 400 if `temperature` is set to any non-default value. Must omit the field entirely via `NO_TEMPERATURE_MODELS`.
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
   
        Claude: add to *_THINKING and *_EFFORT tables (Sonnet, Opus).
        Mistral: add to the *_MISTRAL_EFFORT tables (FLOW, CHAT, EDITOR, CONTEXT, SUMMARY) and to the MISTRAL_REASONING_MODELS allowlist. A reasoning-only model needs an explicit level in every table (never "none").
        DeepSeek: only if routing to v4-flash's thinking mode; deepseek-v4-flash (non-thinking) has no reasoning toggle.
   
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

- Anthropic Claude migration guide: https://platform.claude.com/docs/en/about-claude/models/migration-guide
- Anthropic Structured Outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Mistral adjustable reasoning: https://docs.mistral.ai/capabilities/reasoning/adjustable
- Mistral model overview: https://docs.mistral.ai/getting-started/models/models_overview/
- Mistral model card, Z.ai GLM 5.3: https://docs.mistral.ai/models/zai-glm-5-3
- Z.ai GLM-5.3 guide (reasoning levels, reasoning-only): https://docs.z.ai/guides/llm/glm-5.3
