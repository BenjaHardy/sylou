## Add `generator_info` JSONB column to `flow_reports`

Single schema change — no code edits, no backfill, no RLS changes.

### Migration

```sql
ALTER TABLE public.flow_reports
  ADD COLUMN generator_info JSONB;
```

### Notes

- Nullable, no default. Existing rows remain `NULL` and will render "generator info unavailable" in a follow-up prompt.
- Existing RLS policies on `flow_reports` (scoped via `owns_project(project_id)`) already cover the new column — no policy changes needed.
- Existing GRANTs on `flow_reports` cover all columns — no GRANT changes needed.
- No application/Edge Function code changes in this step. Populating `generator_info` from the `analysis` Edge Function and rendering it in shared reports will be handled in later prompts.

### Expected populated shape (for reference, not enforced)

```json
{
  "instance_label": "official" | "self-hosted",
  "instance_domain": "sylou.eu",
  "version": "v1.4.2",
  "commit_hash": "a1b2c3d",
  "is_modified": false
}
```
