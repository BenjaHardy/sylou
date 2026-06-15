# Diagnostic: confirm `thinking` + `effort` actually reach Anthropic

## Goal

Prove (or disprove) that `thinking: { type: "adaptive" }` and `output_config.effort: "high"` are present in the outgoing Anthropic request body for FLOW on Opus 4.8. Existing logs truncate inside `messages`, so the top-level keys are invisible.

## Change

Single file: `supabase/functions/_shared/_llm.ts`, inside `callLLM` (around line 487), immediately after the body is assembled and before `fetch`:

```ts
// Diagnostic: log the top-level keys + the reasoning-control fields
// of the outgoing body. Skipped for streaming requests to avoid log
// spam on token deltas. Excludes `messages` / `system` / `tools` so
// the line stays well under the 8KB log truncation limit.
if (!opts.stream) {
  const { messages: _m, system: _s, tools: _t, ...preview } = body as Record<string, unknown>;
  console.log("[callLLM] outbound", {
    provider,
    model: opts.model,
    top_level_keys: Object.keys(body),
    thinking: (body as any).thinking ?? null,
    output_config: (body as any).output_config ?? null,
    reasoning_effort: (body as any).reasoning_effort ?? null,
    preview,
  });
}
```

This affects all four edge functions that use `callLLM` (analysis, chat, editor-action, context-prompt) but only for non-streaming calls. FLOW analysis is always non-streaming, so the next FLOW run will emit one diagnostic line per attempt.

## How you verify

1. Wait for deploy.
2. Run one FLOW analysis on Opus 4.8.
3. Open Edge Function logs → `analysis` → search `[callLLM] outbound`.
4. Expected line:
   ```
   { provider: "anthropic", model: "claude-opus-4-8",
     top_level_keys: ["model","max_tokens","system","messages","temperature","output_config"],
     thinking: { type: "adaptive" },
     output_config: { format: {...}, effort: "high" }, ... }
   ```
5. Interpretation:
   - **Both present** → wiring is correct; the absence of thinking blocks in the previous response was Opus's adaptive decision (no bug, just dynamic).
   - **`thinking: null`** → bug in the path between `resolveThinking` and `toAnthropicBody`. We'll trace from there.
   - **`output_config.effort` missing** → same kind of bug for effort.
   - **Line doesn't appear at all** → the deployed analysis function is stale / didn't pick up the build. Forces redeploy investigation.

## Out of scope

- The parked Mistral Medium 3.5 / Small reasoning work — explicitly held per your message.
- Any behavior change. This is log-only; no functional impact.

## Rollback

Trivial — delete the inserted block. Safe to leave in indefinitely (one short log line per non-streaming call).
