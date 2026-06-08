## Goal

Make it visible in Settings → Models which model IDs are *rolling aliases* (always resolve to the provider's latest version) vs *pinned* versions.

## Background (verified)

- `mistral-large-latest` — Mistral's official rolling alias. Always latest Large generation.
- `deepseek-chat` — DeepSeek's rolling alias for their current non-reasoning chat model (V3 line). Always latest.
- `claude-sonnet-4-6` / `claude-opus-4-8` — pinned Anthropic version IDs. Do NOT auto-upgrade; require a manual ID bump when 4.7 / 4.9 ship. Leave unmarked (per your choice).

## Changes

Two files, presentation only. No edge function, no DB, no behavior change.

### 1. `src/lib/models.ts`
- Add optional field `isRollingLatest?: boolean` to `ModelInfo`.
- Set `isRollingLatest: true` on the `mistral-large-latest` and `deepseek-chat` entries.

### 2. `src/components/SettingsDialog.tsx` (`ModelOption` component)
- When `model.isRollingLatest` is true, render `· latest version` as a muted inline suffix next to the model label (same `text-muted-foreground` tone already used for pricing). Simplest possible implementation — no new component, no Badge.

Example rendered row:
```
Mistral Large · latest version              ~$2.00 in · ~$6.00 out / 1M tok
DeepSeek Chat · latest version  [experimental]   ~$0.14 in · ~$0.28 out / 1M tok
Claude Sonnet 4.6                           ~$3.00 in · ~$15.00 out / 1M tok
```

## Out of scope

- No marker on Claude rows.
- No change to the FLOW model selector logic (it reuses the same `MODELS` list, so it inherits the labels automatically — that's fine and desired).
- No change to the underlying model IDs sent to providers.

## Verification

- Typecheck passes.
- Open Settings → Models in the preview: confirm "· latest version" appears on Mistral Large and DeepSeek Chat rows only, in both the Chat model and FLOW analysis model sections.
