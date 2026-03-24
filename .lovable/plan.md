

## Fix: Add 'pending' to ai_editor_actions outcome check constraint

### Problem
The `editor-action` edge function inserts rows with `outcome: "pending"`, but the database check constraint only allows `'accepted'`, `'modified'`, `'rejected'`. Every insert fails, so no editor actions are ever saved.

### Fix
**Database migration** — Drop and recreate the check constraint to include `'pending'`:

```sql
ALTER TABLE public.ai_editor_actions
  DROP CONSTRAINT ai_editor_actions_outcome_check;

ALTER TABLE public.ai_editor_actions
  ADD CONSTRAINT ai_editor_actions_outcome_check
  CHECK (outcome = ANY (ARRAY['accepted', 'modified', 'rejected', 'pending']));
```

No code changes needed.

