# Mistral reasoning + model pinning + effort cleanup

Shipped together as a single deploy.

## What changed

### `_thinking.ts`
- `EffortLevel` renamed to `ClaudeEffort` (legacy alias retained for any out-of-tree imports).
- New `MistralEffort = "high" | "none"`.
- New `MISTRAL_REASONING_MODELS = { "mistral-medium-3-5", "mistral-small-2603" }` allowlist.
- Four new per-function tables: `FLOW_MISTRAL_EFFORT`, `CHAT_MISTRAL_EFFORT`, `EDITOR_MISTRAL_EFFORT`, `CONTEXT_MISTRAL_EFFORT`.
  - FLOW: both reasoning models at `"high"` (determinism wins).
  - CHAT: Medium 3.5 `"high"`, Small `"none"` (latency).
  - EDITOR: both `"none"`.
  - CONTEXT: Medium 3.5 `"high"`, Small `"none"`.
- `resolveMistralEffort()`: returns `undefined` for non-reasoning models OR when value is `"none"`. Callers that get `undefined` must omit the field — sending `reasoning_effort` to `mistral-large-2512` is a hard HTTP 422.
- `resolveMaxTokens` extended with `mistralEffortOn` flag so Mistral reasoning calls get the same headroom (4000 chat, 16000 FLOW) as Claude+thinking.

### `_llm.ts`
- `toAnthropicBody.effort` typed as `ClaudeEffort`.
- `toOpenAIBody` gains `reasoning_effort?: MistralEffort`; emitted only when truthy and `!== "none"`.
- `callLLM` gains `mistral_effort?: MistralEffort`; passed through to `toOpenAIBody` only when provider is Mistral.
- Diagnostic `[callLLM] outbound` log no longer emits `reasoning_effort: null` for Anthropic — the field is included only when actually present in the body.

### `_temperatures.ts`
- All `"mistral-large-latest"` keys renamed to `"mistral-large-2512"`.
- All three Mistral models are now EXPLICIT in every table:
  - CHAT / EDITOR / CONTEXT: Large, Medium 3.5, Small all at `0.7`.
  - FLOW: Large, Medium 3.5, Small all at `0.0`.

### `src/lib/models.ts`
- Replaced `mistral-large-latest` → `mistral-large-2512` (label "Mistral Large 3", pricing $0.50 / $1.50).
- Added `mistral-medium-3-5` ($1.50 / $7.50) and `mistral-small-2603` ($0.15 / $0.60).
- `isRollingLatest` dropped from all three (every Mistral model now pinned by dated alias).
- `DEFAULT_CHAT_MODEL` → `"mistral-large-2512"`.
- `MODEL_LABELS` now carries legacy aliases for `mistral-large-latest` and `mistral-small-latest` so historical rows still render a label.

### Edge functions (wire-up)
- `analysis/`, `chat/`, `editor-action/`, `context-prompt/` all compute `mistralEffort = resolveMistralEffort(...)` next to the existing `effort = resolveEffort(...)` line, pass it via `mistral_effort:` into every `callLLM` site, and update `resolveMaxTokens` with the new `mistralEffort !== undefined` flag.
- `context-prompt`'s `callChatModel` helper gained a trailing `mistralEffort?: MistralEffort` arg; all three call sites updated.
- Hardcoded fallback `|| "mistral-large-latest"` replaced with `|| "mistral-large-2512"` in chat / editor-action / context-prompt.
- `extract-text` summarizer model pinned to `mistral-large-2512`.
- `estimateTokens.ts` context-limit map gains entries for all three new IDs (256k each).

## Out of scope

- DB migration to rewrite `profiles.preferred_chat_model = 'mistral-large-latest'` rows or change the column default. Existing rows fall through to the hardcoded `"mistral-large-2512"` fallback in each function and render correctly via `MODEL_LABELS`. New users get the column default (`mistral-large-latest`), which immediately falls back to the pinned ID at request time.
- Mistral Large 3 (`mistral-large-2512`) is NOT in `MISTRAL_REASONING_MODELS` and never sends `reasoning_effort`.

## Verification matrix (post-deploy)

| Function | Model | `temperature` | `reasoning_effort` | `thinking` |
|---|---|---|---|---|
| FLOW | `mistral-large-2512` | `0` | absent | absent |
| FLOW | `mistral-medium-3-5` | `0` | `"high"` | absent |
| FLOW | `mistral-small-2603` | `0` | `"high"` | absent |
| FLOW | `claude-opus-4-8` | absent | absent | `{type:"adaptive"}` + `output_config.effort:"high"` |
| Chat | `mistral-large-2512` | `0.7` | absent | absent |
| Chat | `mistral-medium-3-5` | `0.7` | `"high"` | absent |
| Chat | `mistral-small-2603` | `0.7` | absent | absent |

Inspect via Edge Function logs → search `[callLLM] outbound`.

## Rollback

- Latency on FLOW Mistral Medium 3.5 > 100s avg → flip `FLOW_MISTRAL_EFFORT["mistral-medium-3-5"]` to `"none"`.
- Any HTTP 422 on Large 3 → confirm `MISTRAL_REASONING_MODELS` doesn't contain it (it should not).
