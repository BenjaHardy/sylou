## Goal

Add two diagnostic logs so we can see exactly what's being sent to Claude and exactly what Claude returns, before committing to a structural fix.

## Context

The previous diagnostic log confirmed schema drift (not truncation). The pillars are coming back flattened. Before changing the schema, prompt, or fallback logic, we need to verify:

1. The `input_schema` actually transmitted to Claude is the one we expect (no accidental mutation, no `$ref` artefacts after JSON serialization through `toAnthropicBody`).
2. The raw `tool_use.input` object Claude returns, so we can confirm the flattening shape rather than infer it from key names.

## Changes

All in `supabase/functions/analysis/index.ts`.

### 1. Log the transmitted tool schema (once, just before the Claude call)

Just before the `await callLLM(...)` call in the analysis flow, add:

```ts
if (providerFor(flowModel) === "anthropic") {
  console.log("FLOW tool schema sent to Claude", {
    model: flowModel,
    tool_name: SUBMIT_FLOW_TOOL.name,
    input_schema: JSON.stringify(SUBMIT_FLOW_TOOL.input_schema),
  });
}
```

Stringifying ensures the full nested structure is preserved in the log (Supabase log viewer otherwise truncates deep objects).

Gated on `anthropic` so Mistral runs stay quiet.

### 2. Log the full raw tool input from Claude (only on schema failure)

Inside the existing `if (validPillarCount < 3 || !hasSummary) { ... }` block (around line 997–1016), add one more line alongside the current diagnostic:

```ts
console.error("FLOW raw tool input (full)", {
  model: flowModel,
  raw_tool_input: JSON.stringify(flowResult),
});
```

Logged as a separate entry to keep the existing structured log clean and to make it easy to copy-paste.

Kept inside the failure branch — no extra logging on success, no PII risk on Mistral or successful Claude runs.

## What this will tell us

- If `input_schema` in the log shows the four pillars as proper nested `{ type: "object", properties: { reasoning, evidence, score, narrative } }` objects → schema is fine, Claude is the problem → fix path (b) or (c).
- If `input_schema` shows anything collapsed, `$ref`'d, or otherwise ambiguous → fix path (a), restructure the schema.
- The `raw_tool_input` will confirm exactly which fields got promoted/flattened (e.g. whether `evidence/score/narrative` belong to `find` only, or are an averaged single set across all pillars).

## How to retrieve the logs

After this ships, on sylou.eu:

1. Trigger the same failing FLOW analysis with Claude Sonnet 4.6.
2. Open Supabase → Edge Functions → `analysis` → Logs.
3. Look for two entries from the same invocation:
   - `FLOW tool schema sent to Claude` (level: log)
   - `FLOW raw tool input (full)` (level: error)
4. Paste both back here.

## Out of scope

- No schema changes, no prompt changes, no retry logic yet. Diagnose first, fix in the next round.
- No frontend changes.
