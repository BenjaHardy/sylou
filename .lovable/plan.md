# Add AI editor actions to JSON export

## Problem
The JSON export (`src/lib/export-json.ts`) currently captures chat messages and the FLOW report's `ai_editor_summary`, but not the per-action rows in the `ai_editor_actions` table. That table is where all context-prompt and editor-action uses are logged — including the ones that never appear as chat messages (Expand, Simplify, Rewrite, Translate, Fix Grammar), as well as Ask / Propose. These rows are an input to FLOW analysis but are missing from the export.

## Change
Extend `exportProjectAsJson` to also fetch `ai_editor_actions` for the project and include them under `project.ai_editor_actions` in the exported JSON.

### Technical details
- Add a parallel query in the existing `Promise.all`:
  ```ts
  supabase
    .from("ai_editor_actions")
    .select("id, action_type, outcome, instruction_text, selected_text_preview, ai_response_preview, ai_response_full, char_count_original, char_count_result, created_at")
    .eq("project_id", projectId)
    .order("created_at")
  ```
- Add `ai_editor_actions: editorActionsRes.data ?? []` to the `project` object in `exportData`.
- No schema, RLS, or UI changes. Existing `select_own_ai_editor_actions` RLS policy already allows the owner to read these rows.

## Out of scope
- No changes to PDF or DOCX exports (user asked specifically about JSON).
- No new fields added to the table; we surface what's already stored.
