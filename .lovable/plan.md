# Fix: Favourite imported documents not persisted

## Root cause

The `imported_documents` table has RLS policies for SELECT, INSERT and DELETE, but **no UPDATE policy**. When the user toggles the star icon, `useImportedDocuments.toggleFavourite` runs:

```ts
supabase.from("imported_documents").update({ is_favourite: next }).eq("id", docId)
```

With RLS enabled and no matching UPDATE policy, PostgREST silently filters the row out — 0 rows updated, no error returned. The UI shows the star as filled (optimistic update), but the column stays `false` in the DB.

Confirmed: every row in `imported_documents` currently has `is_favourite = false`, even for documents the user has starred.

Downstream consequence: in `chat/index.ts` and `context-prompt/index.ts`, `favourites = allDocs.filter(d => d.is_favourite && d.extracted_text)` is always empty, so the "REFERENCE DOCUMENTS (ALWAYS AVAILABLE)" full-text block is never injected — the LLM only sees the summary in the index and must call `read_imported_document`.

## Fix

Add an UPDATE policy mirroring the other policies on the table (owner-scoped via `owns_project`):

```sql
CREATE POLICY "update_own_imported_documents"
ON public.imported_documents
FOR UPDATE
TO authenticated
USING (owns_project(project_id))
WITH CHECK (owns_project(project_id));
```

No code changes required — the existing `toggleFavourite` call will start persisting immediately once the policy exists.

## Verification

1. Star a document → reload the page → star stays filled.
2. `select id, file_name, is_favourite from imported_documents` → row shows `true`.
3. Ask the chat a question whose answer is in the favourited document → response uses the content directly (no `read_imported_document` tool call visible in edge function logs).
4. Confirm the toast warning ("high favourite document load") still triggers when crossing the soft cap.

## Not in scope

- No changes to `chat`, `context-prompt`, or `editor-action` — their favourite-injection logic is already correct and will start working as soon as the column is actually `true`.
- No backfill needed: the user can re-star the documents they want.
