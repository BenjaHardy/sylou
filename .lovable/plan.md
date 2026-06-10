## Problem

Claude FLOW analysis fails with HTTP 400:
`output_config.format.schema: For 'array' type, 'minItems' values other than 0 or 1 are not supported (got: [2, 5])`

Anthropic's Structured Outputs only permits `minItems` values of `0` or `1`. Our `pillarSchema.evidence` array uses `minItems: 2`, which the API rejects.

## Grep results

```
supabase/functions/analysis/index.ts:219:      minItems: 2,   ← offender
supabase/functions/analysis/index.ts:271:      minItems: 0,   ← compliant
```

Only one offending occurrence. Because `pillarSchema` is reused by `find`/`lead`/`organize`/`write`, fixing it once resolves all four pillars (the API error message `[2, 5]` reflects the schema referenced four times).

Note: `maxItems` values (4 and 5) are unaffected — only `minItems` carries the 0/1 limit.

## Fix

In `supabase/functions/analysis/index.ts`, line 219, change `minItems: 2` to `minItems: 1` on the evidence array, and add an inline comment pointing at the Anthropic Structured Outputs docs so future schema edits don't reintroduce the issue.

```diff
       evidence: {
         type: "array" as const,
         description: "2–4 short quotes or concrete references from the project supporting the assessment.",
         items: { type: "string" as const },
-        minItems: 2,
+        // Anthropic Structured Outputs only allows minItems 0 or 1 for arrays.
+        // The prompt already instructs the model to return 2–4 evidence items.
+        // https://platform.claude.com/docs/en/build-with-claude/structured-outputs
+        minItems: 1,
         maxItems: 4,
       },
```

The prompt text in both `FLOW_PROMPT_TEMPLATE` and `CREATIVE_FLOW_PROMPT_TEMPLATE` already specifies "2-4 evidence items" (lines 97, 140, 156, 199), so behavior should remain unchanged in practice. If a future run returns only 1 evidence item, the existing retry/repair pipeline absorbs it; we can add a post-validation check later if it ever fires.

## Deploy + verify

1. Deploy `analysis` edge function.
2. Run one Claude Sonnet 4.6 FLOW analysis on a real project.
3. Confirm:
   - No 400 from Anthropic
   - `StructuredOutputError` not thrown
   - `[FLOW repair UNEXPECTED]` still silent
   - Evidence arrays contain 2–4 items as instructed

## Out of scope

- No changes to Mistral path (unaffected).
- No changes to `_llm.ts`, `_repair.ts`, or retry layer.
- The previously-parked Anthropic thinking/effort work stays parked.
