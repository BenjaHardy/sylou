## Goal

Disclose the reasoning/thinking/effort settings alongside the existing temperature line at the bottom of FLOW reports (owner view, shared view, exports).

## Storage shape (provider-agnostic)

Three new optional fields on `flow_meta`:

- `reasoning_provider: string | null` — e.g. `"anthropic"`, `"mistral"`. `null` when the model has no reasoning controls (DeepSeek, non-reasoning Mistral).
- `reasoning_thinking: boolean | null` — adaptive thinking on/off. `null` when not applicable to the provider.
- `reasoning_effort: string | null` — loosely typed `string` so new provider enum values don't force a schema change. `null` when not applicable.

Legacy reports lack all three fields → helper returns `""` and the existing temperature line renders unchanged.

## Changes

### 1. Edge function — populate the fields

`supabase/functions/analysis/index.ts`, in the `flow_meta` literal (~line 1360):

- Claude: `reasoning_provider: "anthropic"`, `reasoning_thinking: thinking`, `reasoning_effort: effort ?? null`.
- Mistral reasoning model (`mistralEffort !== undefined`): `reasoning_provider: "mistral"`, `reasoning_thinking: null`, `reasoning_effort: mistralEffort`.
- Otherwise: all three `null`.

### 2. Type — `FlowMeta` in `src/hooks/useFlowAnalysis.ts`

Add the three optional fields with JSDoc explaining provider-agnostic semantics and that `undefined` (vs. `null`) signals a legacy pre-disclosure report.

### 3. Shared helper — `formatReasoningDisclosure(meta)` in `src/components/flow-report/shared-utils.ts`

Returns a leading-comma fragment (e.g. `", thinking on, effort high"`) or `""`. Exhaustive truth table for the helper — defensive against every combination:

| `reasoning_provider` | `reasoning_thinking` | `reasoning_effort` | Output |
|---|---|---|---|
| `undefined` (legacy) | — | — | `""` |
| `null` | — | — | `""` |
| `"anthropic"` | `true` | `"high"` (any string) | `", thinking on, effort high"` |
| `"anthropic"` | `false` | `"high"` (any string) | `", thinking off, effort high"` |
| `"anthropic"` | `true` | `null` | `", thinking on"` |
| `"anthropic"` | `false` | `null` | `", thinking off"` |
| `"anthropic"` | `null` | `"high"` (any string) | `", effort high"` |
| `"anthropic"` | `null` | `null` | `""` |
| `"mistral"` | — | `"high"`/`"none"`/any string | `", reasoning_effort high"` |
| `"mistral"` | — | `null` | `""` |
| any other string (future provider) | — | `"x"` | `", reasoning_effort x"` (effort-only fallback) |
| any other string | — | `null` | `""` |

Rules in prose:
- Legacy or fully-null reasoning metadata → empty string (no segment, no stray comma).
- Anthropic: emit `thinking {on|off}` only if `reasoning_thinking` is a boolean; emit `effort {value}` only if `reasoning_effort` is a non-empty string; join with `, ` and prepend `, ` to the whole segment; if both pieces are absent → empty string.
- Mistral: emit `reasoning_effort {value}` only if `reasoning_effort` is a non-empty string; `reasoning_thinking` is intentionally ignored even if set.
- Unknown provider with an effort value → fall back to the Mistral-style `reasoning_effort {value}` rendering so future providers degrade gracefully without a code change.
- Empty-string `reasoning_effort` is treated the same as `null` (defensive).

A small inline unit test alongside the helper (vitest, same folder pattern as existing tests) covers each row of the table.

### 4. Display sites

Splice the helper output immediately after the existing temperature parenthetical in:

- `src/components/FlowReportView.tsx` — both disclosure blocks (~lines 432 and 859).
- `src/pages/SharedReport.tsx` — disclosure block (~lines 417–423).
- `src/lib/export-docx.ts` — wherever the model/temperature line is composed.
- `src/lib/export-json.ts` — verify the full `flow_meta` is serialized without an allowlist; if allowlisted, add the three fields.
- PDF: inherits from `FlowReportView` via the browser print path — no separate code path.

A quick read of `export-docx.ts` and `export-json.ts` happens before editing to confirm exact splice points.

## Out of scope

- No DB migration (`flow_meta` is `jsonb`).
- No backfill of historical reports.
- No change to the LLM request itself.
