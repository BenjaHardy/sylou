## Goal

Prevent Claude from emitting multiple `tool_use` blocks in a single response for the FLOW analysis call, which is a likely cause of the intermittent schema-validation failures.

## Change

Scope the fix to `supabase/functions/analysis/` only. Do not touch `chat/`, `editor-action/`, or `context-prompt/` copies of `_llm.ts` — chat in particular may legitimately want parallel tool use.

### 1. `supabase/functions/analysis/_llm.ts`

Add an optional `disableParallelToolUse?: boolean` to both `toAnthropicBody` and `callLLM` opts. In `toAnthropicBody`, when `tool_choice` is set, include `disable_parallel_tool_use: true` when the flag is on:

```ts
body.tool_choice = {
  type: "tool",
  name: opts.forceTool,
  ...(opts.disableParallelToolUse ? { disable_parallel_tool_use: true } : {}),
};
```

Thread the flag through `callLLM` → `toAnthropicBody`. OpenAI-shape path is unaffected (Mistral/DeepSeek don't use this).

### 2. `supabase/functions/analysis/index.ts`

At the single `callLLM` call (line ~978) that forces `SUBMIT_FLOW_TOOL`, pass `disableParallelToolUse: true` alongside the existing `forceTool`.

## Why this is safe

- Only the Anthropic branch and only when `tool_choice` is already a forced tool.
- Anthropic ignores unknown fields silently for non-supporting models, but `claude-sonnet-4-*` supports this per the linked docs.
- No frontend, schema, or DB changes.

## Verification

After deploy, trigger a FLOW analysis run; confirm Claude returns exactly one `tool_use` block (visible via the existing raw-response logging added earlier). The intermittent multi-block failure mode should be eliminated.
