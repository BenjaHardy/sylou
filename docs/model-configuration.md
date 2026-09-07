# Model Configuration Reference

This document tracks how Sylou configures each LLM model across the four edge functions (FLOW analysis, Chat, Editor actions, Context-prompt). It serves as a single source of truth for what's set where, why, and how the models behave in practice.

**When to update this document:**

- A new model is added to `src/lib/models.ts`
- A temperature, effort, or thinking value is changed in `_temperatures.ts` or `_thinking.ts`
- Observed model behavior changes (e.g., a model's response quality changes after a provider update)

**Last updated:** July 2026

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
| Z.ai GLM 5.2       | Mistral*  | $1.40 / $4.40           | 1M                          | `zai-glm-5-2`        |

*Pricing as of July 2026 (GLM 5.2: August 2026); verify against provider pricing pages before publishing.*

\* Z.ai GLM 5.2 is a **third-party open model** (Z.ai, MoE 744B/40B) hosted
unmodified on the Mistral API on EU infrastructure — **public preview since
2026-08**. It routes through Sylou's Mistral path (the id carries no
`claude-`/`deepseek-` prefix) and uses the operator's `MISTRAL_API_KEY`.
Note: "max" reasoning is **GLM-only** — Mistral's own reasoning models
top out at "high" and must never be configured with "max".

> **DeepSeek model-id note:** Sylou uses the pinned `deepseek-v4-flash` id
> (non-thinking mode — context 1M, max output 384K). The legacy rolling
> alias `deepseek-chat`, used until July 2026, is discontinued upstream on
> **2026-07-24**; stored user preferences were migrated by
> `20260703150000_deepseek-v4-flash-preferred-models.sql`.

---

## Configuration by model × function

### FLOW (analysis)

The most analytically demanding function. All models targeted for determinism (temperature 0) when possible, with reasoning enabled where supported.

| Model              | Temperature                  | Thinking / Effort                                      | max_tokens (output) | Notes                                                                                           |
| ------------------ | ---------------------------- | ------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------- |
| Claude Sonnet 4.6  | 0.0                          | thinking: off, effort: high (matches provider default) | 8192                | *Recommended* model for FLOW; quality and repeatability.                                          |
| Claude Opus 4.8    | undefined (model-controlled) | thinking: adaptive, effort: high                       | 16000               | Adaptive thinking; consumes more tokens, not recommended except for specific scenarios.         |
| Mistral Large 3    | 0.0                          | n/a (no reasoning support)                             | 8192                | *Not* recommended, strong inherent bias towards the user.                                       |
| Mistral Medium 3.5 | 0.0                          | reasoning_effort: off                                  | 8192                | *Not* recommended, or with extreme care. Good repeatability, but strong Write pillar and provenance data lead to user-bias on other pillars. |
| Mistral Small 4    | 0.0                          | reasoning_effort: high                                 | 16000               | *Not* recommended, bias towards the user, poor repeatability.  |
| DeepSeek V4 Flash  | 0.0                          | n/a                                                    | 8192                | *Not* recommended, bias towards the user, poor repeatability.  |
| Z.ai GLM 5.2       | 0.0                          | reasoning_effort: max (GLM-native level)               | 16000               | *Not* recommended pending field testing. Max-effort speed experiment (maintainer, 2026-08): watch the 145s in-contract timeout — guardrails in _thinking.ts. |

**Rationale for FLOW settings:**

- max_tokens 16000 for reasoning models: thinking chunks consume output budget; insufficient headroom causes truncation and validation failures.
- Mistral Medium 3.5 reasoning effort set to off, otherwise analysis risks hitting Supabase connection timeouts.
- Opus 4.7+ excluded from temperature setting (returns 400 if non-default temperature is sent).

---

### Chat

Conversational responses. Quality matters; reasoning effort calibrated per model tier.

| Model              | Temperature                  | Thinking / Effort                | max_tokens (output) | Notes                                                                 |
| ------------------ | ---------------------------- | -------------------------------- | ------------------- | --------------------------------------------------------------------- |
| Claude Sonnet 4.6  | 1.0                          | thinking: off, effort: high      | 2000                | Default chat behavior.                                                |
| Claude Opus 4.8    | undefined (model-controlled) | thinking: adaptive, effort: high | 4000                | Adaptive thinking; raises max_tokens.                                 |
| Mistral Large 3    | 0.7                          | n/a                              | 2000                | Standard chat.                                                        |
| Mistral Medium 3.5 | 0.7                          | reasoning_effort: high           | 4000                | Mistral "Quality tier" — reasoning enabled.                           |
| Mistral Small 4    | 0.7                          | reasoning_effort: none           | 2000                | Mistral "Speed tier" — no thinking chunk; ideal for cheap, fast chat. |
| DeepSeek V4 Flash  | 1.0                          | n/a                              | 2000                | Standard, cheap chat.                                                 |
| Z.ai GLM 5.2       | 0.7                          | reasoning_effort: max            | 4000                | Third-party (Z.ai) via Mistral API, public preview; 1M context.       |

**Rationale for Chat settings:**

- Temperature — provider default: 1.0 for Claude Sonnet and DeepSeek, 0.7 for Mistral; allows natural variation for conversational warmth.
- Reasoning effort tier-matched — Medium 3.5 ("quality tier") gets reasoning; Small ("speed tier") doesn't.
- max_tokens 4000 for reasoning models — same logic as FLOW, smaller bump since chat responses are shorter.

---

### Editor actions (Translate, Fix Grammar, Rewrite, Simplify, Expand)

Inline rewrites and proposals from within the editor. Latency-sensitive.

| Model              | Temperature                  | Thinking / Effort                | max_tokens (output) | Notes                                           |
| ------------------ | ---------------------------- | -------------------------------- | ------------------- | ----------------------------------------------- |
| Claude Sonnet 4.6  | 1.0                          | thinking: off, effort: high      | 1000                | Fast inline action.                             |
| Claude Opus 4.8    | undefined (model-controlled) | thinking: adaptive, effort: high | 2500                | Adaptive thinking; raises max_tokens.           |
| Mistral Large 3    | 0.7                          | n/a                              | 1000                | Standard.                                       |
| Mistral Medium 3.5 | 0.7                          | reasoning_effort: none           | 1000                | No reasoning — editor actions should be snappy. |
| Mistral Small 4    | 0.7                          | reasoning_effort: none           | 1000                | Same as Medium for editor.                      |
| DeepSeek V4 Flash  | 1.0                          | n/a                              | 1000                | Standard.                                       |
| Z.ai GLM 5.2       | 0.7                          | reasoning_effort: none           | 1000                | Third-party via Mistral API; reasoning off — editor actions stay snappy. |

**Rationale for Editor settings:**

- Reasoning disabled for Mistral — editor actions are short, latency-sensitive; thinking-chunk overhead isn't justified.
- Lower max_tokens (1000) — proposals are inherently short. The budget lives in `_shared/_models.ts` (`OUTPUT_BUDGETS.EDITOR_ACTION_TOKENS`) and is mirrored by `src/lib/editor-limits.ts`: the selection window shows a notice (acknowledge to proceed) for selections beyond ~3,400 characters, and a reply the provider cut off at max_tokens arrives flagged `truncated` — Accept then asks for confirmation (Ctrl+Z restores). Ask/Propose replies carry the same flag; they get no pre-check, since their length follows the request rather than the selection.

---

### Context-prompt (work summarization, Ask/Propose actions)

Provides AI features with context grounded in the written work. Used by Ask/Propose and underlying work summaries.

| Model | Temperature | Thinking / Effort | max_tokens (summary) (output) | max_tokens (response) (output) | Notes |
|---|---|---|---|---|---|
| Claude Sonnet 4.6 | 1.0 | thinking: off, effort: high | 1000 | 2000 | Standard. |
| Claude Opus 4.8 | undefined (model-controlled) | thinking: adaptive, effort: high | 2500 | 4000 | Adaptive thinking. |
| Mistral Large 3 | 0.7 | n/a | 1000 | 2000 | Standard. |
| Mistral Medium 3.5 | 0.7 | reasoning_effort: high | 2500 | 4000 | Mistral quality tier — reasoning helps with nuanced AI features. |
| Mistral Small 4 | 0.7 | reasoning_effort: none | 1000 | 2000 | Mistral speed tier. |
| DeepSeek V4 Flash | 1.0 | n/a | 1000 | 2000 | Standard. |
| Z.ai GLM 5.2 | 0.7 | reasoning_effort: max | 2500 | 4000 | Third-party via Mistral API, public preview. |

**Rationale for Context-prompt settings:**

- Matches Chat defaults — context-prompt powers Ask/Propose user-facing features, so quality posture should align with chat.

---

## Where settings live in code

| Setting                                       | File                                          | Notes                                                                                             |
| --------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Model registry (which models exist)           | `src/lib/models.ts`                           | Pricing, labels, default chat model.                                                              |
| Temperature per function × model              | `supabase/functions/_shared/_temperatures.ts` | Five tables: `FLOW_TEMPERATURE`, `CHAT_TEMPERATURE`, `EDITOR_TEMPERATURE`, `CONTEXT_TEMPERATURE`, `SUMMARY_TEMPERATURE` (conversation-memory consolidation, 0.3 — faithful carry-over over prose variety). |
| Claude thinking + effort per function × model | `supabase/functions/_shared/_thinking.ts`     | Tables: `*_THINKING`, `*_EFFORT`.                                                                 |
| Mistral reasoning_effort per function × model | `supabase/functions/_shared/_thinking.ts`     | Tables: `*_MISTRAL_EFFORT`.                                                                       |
| Reasoning-supported Mistral models            | `supabase/functions/_shared/_thinking.ts`     | `MISTRAL_REASONING_MODELS` set.                                                                   |
| max_tokens base values + raise rules          | `supabase/functions/_shared/_thinking.ts`     | `resolveMaxTokens()` function.                                                                    |
| Anthropic models without temperature          | `supabase/functions/_shared/_temperatures.ts` | `NO_TEMPERATURE_MODELS` set.                                                                      |
| Server-side model allowlist + input limits    | `supabase/functions/_shared/_models.ts`       | `ALLOWED_MODELS` (gates the `model` request override), `INPUT_LIMITS` (request text ceilings), `CONTEXT_LIMIT_TOKENS` (per-model context windows, mirrors the registry). |
| FLOW imported-documents budget                | `supabase/functions/analysis/index.ts`        | `FLOW_IMPORTED_DOCS_BUDGET_TOKENS` cost ceiling; effective allowance = min(policy, model-window remainder after the never-truncated sections). |
| Provider request timeout                      | `supabase/functions/_shared/_llm.ts`          | `callLLM` `timeoutMs` — default 120s; analysis passes 145s (hosted request-idle limit is 150s); Brave web-search fetches use a 10s `AbortSignal.timeout`. |
| Body-level wire format (per provider)         | `supabase/functions/_shared/_llm.ts`          | `toAnthropicBody`, `toOpenAIBody`.                                                                |

---

## Known model-specific constraints

- **Claude Opus 4.7+ family**: Returns 400 if `temperature` is set to any non-default value. Must omit the field entirely via `NO_TEMPERATURE_MODELS`.
- **Mistral Large 3**: Returns 422 if `reasoning_effort` is set. Field guarded by `MISTRAL_REASONING_MODELS` in `toOpenAIBody`.
- **Mistral Magistral models**: Reason natively; reject `reasoning_effort` parameter. Not currently in Sylou's registry but worth noting if added.
- **Anthropic Structured Outputs**: Strips most JSON Schema constraints (`maxItems`, `minLength`, `maximum`, etc.). Schema sanitizer in `_llm.ts` handles this transparently.

---

## Checklist: Adding a New Model to Sylou

1. Register the model in the frontend
   
    Add entry to MODELS array in src/lib/models.ts (id, label, provider, pricing, contextLimit, note).
    Add legacy alias to MODEL_LABELS if this model replaces an existing ID (so historical reports/chat messages still render a friendly label).
    Update DEFAULT_CHAT_MODEL and/or DEFAULT_FLOW_MODEL in src/lib/models.ts if this model becomes a new default.

2. Register the model in edge functions
   
    Add the model id to ALLOWED_MODELS in supabase/functions/_shared/_models.ts — requests naming a model not in this set are rejected with 400, so a model missing here is selectable in Settings but unusable via the request override.
   
    Add the model's context window to CONTEXT_LIMIT_TOKENS in the same file (a mirror of contextLimit in src/lib/models.ts) — the FLOW imported-documents budget and the report's token-usage disclosure read it. A missing id falls back to a conservative 200k window.
   
    Update fallback model strings in each edge function that references a default:
   
        supabase/functions/chat/index.ts
        supabase/functions/analysis/index.ts
        supabase/functions/editor-action/index.ts
        supabase/functions/context-prompt/index.ts
   
    Add temperature entries in supabase/functions/_shared/_temperatures.ts for every function where behavior should differ from the provider default.
   
        For FLOW_TEMPERATURE, always use 0.0.
        For other functions, use the conservative provider default (e.g., 0.7 for Mistral, 1.0 for Claude/DeepSeek).
        If a model rejects any non-default temperature with HTTP 400, add it to NO_TEMPERATURE_MODELS.
   
    Add reasoning/effort entries in supabase/functions/_shared/_thinking.ts if the model supports configurable reasoning:
   
        Claude: add to *_THINKING and *_EFFORT tables (Sonnet, Opus).
        Mistral: add to *_MISTRAL_EFFORT tables and to the MISTRAL_REASONING_MODELS allowlist.
        DeepSeek: only if routing to v4-flash's thinking mode; deepseek-v4-flash (non-thinking) has no reasoning toggle.
   
    Check NO_TEMPERATURE_MODELS in _temperatures.ts (Anthropic Opus 4.7+ rejects temperature).

3. Adjust token budgets (if needed)
   
    Review base max_tokens values in edge function calls. Only change these if the new model has a hard output limit lower than our current bases.
   
        resolveMaxTokens() automatically scales headroom when reasoning/thinking is enabled, so base values typically stay the same.

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
