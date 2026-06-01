Update Claude Opus model from 4.7 to 4.8 in the model registry and token estimation map.

## Changes

1. **`src/lib/models.ts`**
   - Change the `MODELS` entry: `id` from `"claude-opus-4-7"` to `"claude-opus-4-8"`, `label` from `"Claude Opus 4.7"` to `"Claude Opus 4.8"`.
   - Add `"claude-opus-4-7": "Claude Opus 4.7"` to the `MODEL_LABELS` legacy fallback map so historical records still render correctly.

2. **`src/lib/estimateTokens.ts`**
   - Update the `MODEL_CONTEXT_LIMITS` key from `"claude-opus-4-7"` to `"claude-opus-4-8"` (limit stays `1_000_000`).

No edge function references to `"claude-opus-4-7"` were found; the inline `callLLM` helpers use `"claude-opus-4-8"` already or are model-agnostic.