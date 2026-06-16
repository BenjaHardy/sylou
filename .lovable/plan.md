# Fix: Mistral "none" effort missing from FLOW report footer

## Problem

For `mistral-medium-3-5` (FLOW default, effort set to `"none"` to avoid connection timeouts), the FLOW report footer shows only temperature — no reasoning disclosure at all. The `flow_meta` for these reports has `reasoning_provider: null, reasoning_thinking: null, reasoning_effort: null`.

## Root cause

`resolveMistralEffort` returns `undefined` when the configured value is `"none"` (correct for the wire call — we omit the field from the Mistral API request), but `analysis/index.ts:1360` uses that same value to populate `flow_meta.reasoning_effort`, so `"none"` is silently lost.

## Fix (one file, one inline expression)

### `supabase/functions/analysis/index.ts`

Import `MISTRAL_REASONING_MODELS` alongside the existing imports from `_shared/_thinking.ts` (line 15).

In the reasoning-disclosure block (lines 1350–1361), change the Mistral branch to read the **raw configured effort** for disclosure:

```ts
} else if (MISTRAL_REASONING_MODELS.has(flowModel)) {
  reasoningProvider = "mistral";
  reasoningThinking = null;
  reasoningEffort = FLOW_MISTRAL_EFFORT[flowModel] ?? "none";   // "high" | "none"
}
```

Replace the previous `else if (mistralEffort !== undefined)` condition. The `mistralEffort` variable (line 989) stays unchanged and continues to drive the wire call correctly.

Net effect:
- `mistral-medium-3-5` at `"none"` → `flow_meta` contains `{ reasoning_provider: "mistral", reasoning_thinking: null, reasoning_effort: "none" }` → footer displays `, reasoning_effort none`.
- `mistral-small-2603` at `"high"` → unchanged, still displays `, reasoning_effort high`.
- Claude paths unchanged.
- Mistral API requests still omit `reasoning_effort` when `"none"` (driven by `mistralEffort` variable, untouched).

## Verification check after implementation

Eyeball-confirm in the edited file that:
- The `mistralEffort` variable (line ~989, drives the wire call) and the new `reasoningEffort` variable (drives `flow_meta`) are clearly separate in the code.
- No accidental overlap or reuse between them.

This confirms the "Mistral API requests still omit `reasoning_effort` when `"none"`" claim.

## Validation

- No DB migration or client code changes needed.
- After auto-deploy, trigger a new FLOW analysis with `mistral-medium-3-5`; footer should read `temperature 0, reasoning_effort none`.
- Old reports remain as-is (legacy `flow_meta`).
