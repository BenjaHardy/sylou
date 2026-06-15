Switch the default chat **and** FLOW model to **Mistral Medium 3.5**. No data backfill (single-user project). Verification queries cover all four tables to confirm no stale `mistral-large-latest` / `mistral-large-3` strings remain anywhere.

## A. Schema migration (column defaults)

Single migration:

```sql
ALTER TABLE public.profiles
  ALTER COLUMN preferred_chat_model SET DEFAULT 'mistral-medium-3-5';

ALTER TABLE public.profiles
  ALTER COLUMN preferred_flow_model SET DEFAULT 'mistral-medium-3-5';
```

(Will confirm via `supabase--read_query` that `preferred_flow_model` exists and is the correct column name before running.)

## B. Data migration

**Skipped** — single user, will manually re-pick models in Settings if desired.

## C. Code changes

**`src/lib/models.ts`** — two-line flip:

```ts
export const DEFAULT_CHAT_MODEL = "mistral-medium-3-5";   // was "mistral-large-2512"
export const DEFAULT_FLOW_MODEL = "mistral-medium-3-5";   // was "claude-sonnet-4-6"
```

**Edge-function fallback chains** — flip hardcoded `|| "mistral-large-2512"` to `|| "mistral-medium-3-5"` in:
- `supabase/functions/chat/index.ts`
- `supabase/functions/editor-action/index.ts`
- `supabase/functions/context-prompt/index.ts`
- `supabase/functions/analysis/index.ts` (FLOW fallback)

This keeps NULL-`preferred_*_model` rows resolving to the same model as fresh signups.

**`.lovable/plan.md`** — append a short note recording the default flip.

## D. UI

No change. `SettingsDialog` already lists Medium 3.5 in both pickers.

## Verification after deploy

### 1. Schema check
```sql
SELECT column_name, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'profiles'
  AND  column_name IN ('preferred_chat_model', 'preferred_flow_model');
```
Expect both defaults = `'mistral-medium-3-5'::text`.

### 2. Completeness check — no `mistral-large-latest` / `mistral-large-3` strings remain across the four user-facing tables. Run each:
```sql
SELECT preferred_chat_model, COUNT(*) FROM profiles
 WHERE preferred_chat_model LIKE 'mistral-large%' GROUP BY 1;

SELECT preferred_flow_model, COUNT(*) FROM profiles
 WHERE preferred_flow_model LIKE 'mistral-large%' GROUP BY 1;

SELECT model_used, COUNT(*) FROM chat_messages
 WHERE model_used LIKE 'mistral-large%' GROUP BY 1;

SELECT model_used, COUNT(*) FROM flow_reports
 WHERE model_used LIKE 'mistral-large%' GROUP BY 1;

SELECT model_used, COUNT(*) FROM token_usage
 WHERE model_used LIKE 'mistral-large%' GROUP BY 1;
```

Expected outcomes:
- `profiles.preferred_chat_model` / `preferred_flow_model`: zero rows, or only `mistral-large-2512` rows if you've deliberately picked Large 3 in Settings. Any `mistral-large-latest` or `mistral-large-3` row = the schema default never got applied — investigate.
- `chat_messages` / `flow_reports` / `token_usage`: any `mistral-large%` rows here are **historical** (logs of what the model actually was at message time) and intentionally preserved. Not a bug — `MODEL_LABELS` renders friendly labels for the legacy IDs. The query is a completeness check on the migration tooling, not a regression signal for these three tables.

### 3. Runtime check
- Fresh chat call → `[callLLM] outbound` log shows `model: "mistral-medium-3-5"`, `temperature: 0.7`, `reasoning_effort: "high"`.
- Fresh FLOW run → `[callLLM] outbound` shows `model: "mistral-medium-3-5"`, `temperature: 0`, `reasoning_effort: "high"`, no `thinking` field (not Claude).

## Rollback

- `ALTER TABLE public.profiles ALTER COLUMN preferred_chat_model SET DEFAULT 'mistral-large-2512';`
- `ALTER TABLE public.profiles ALTER COLUMN preferred_flow_model SET DEFAULT 'claude-sonnet-4-6';`
- Revert `DEFAULT_CHAT_MODEL` / `DEFAULT_FLOW_MODEL` constants and the four edge-function fallback strings.

## Risk note

FLOW on Medium 3.5 with `reasoning_effort: "high"` is the new default analysis path. If you later observe FLOW runs >100 s avg or quality regressions vs Claude Sonnet 4.6, flip `DEFAULT_FLOW_MODEL` back to `"claude-sonnet-4-6"` (and the analysis fallback string) — your Mistral bias-test results will be the deciding signal here.