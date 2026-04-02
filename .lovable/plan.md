

## Plan: Project-Level Document Import with Tool-Use Chat Integration

Given the complexity, this will be split into **two implementation phases** as you suggested.

---

### Phase 1: Upload, Extraction, Summary Pipeline

#### Database Migration

1. **`imported_documents` table**:
   - Columns: `id`, `project_id` (FK → projects, CASCADE), `file_name`, `file_path`, `extracted_text`, `summary`, `file_size_bytes`, `uploaded_at`
   - RLS: SELECT/INSERT/DELETE using `owns_project(project_id)` (consistent with bookmarks, post-its)

2. **`chat_messages.documents_referenced`** — add nullable JSONB column for future use by Phase 2

#### Storage

- Create `imports` bucket (not public — RLS-controlled)
- RLS policies on `storage.objects`: owner can INSERT/SELECT/DELETE under path `{user_id}/{project_id}/`

#### Edge Function: `extract-text`

- Receives `{ file_path, project_id, file_name }` (the Supabase Storage path)
- Downloads file from storage using service role
- Extracts text:
  - `.txt` / `.md`: read directly as UTF-8
  - `.pdf`: use `pdf-parse` (npm package via esm.sh)
  - `.docx`: use `mammoth` (npm package via esm.sh)
- If extracted text < 500 chars → use full text as summary (no LLM call)
- Otherwise → call Mistral with summarization prompt (first 10,000 chars), log token usage
- Updates `imported_documents` row with `extracted_text` and `summary`
- Returns success/error

#### UI: Imported Documents Panel

- Add an "Imported Documents" collapsible section inside `ProjectContentArea`, accessible via a button in the project header bar (next to Post-its)
- Panel shows list of imported docs: file name, size, date, delete button (with confirmation)
- Upload button accepting `.pdf`, `.txt`, `.md`, `.docx` (max 10MB)
- Upload flow:
  1. Client uploads to Supabase Storage `imports/{user_id}/{project_id}/{file_name}`
  2. Inserts row into `imported_documents` (without `extracted_text`/`summary` yet)
  3. Calls `extract-text` edge function
  4. On success, refetch document list (summary now populated)
  5. Loading indicator during extraction/summary

#### New Files
| File | Purpose |
|------|---------|
| `src/hooks/useImportedDocuments.ts` | CRUD hook for imported_documents table + upload logic |
| `src/components/ImportedDocumentsPanel.tsx` | UI panel with list + upload |
| `supabase/functions/extract-text/index.ts` | Text extraction + summary generation |

#### Modified Files
| File | Change |
|------|--------|
| `src/components/ProjectContentArea.tsx` | Add documents button in header, render panel |
| `supabase/config.toml` | Add `[functions.extract-text]` with `verify_jwt = false` |

---

### Phase 2: Chat Integration via Tool Use

#### Chat Edge Function Changes (`supabase/functions/chat/index.ts`)

The two-pass flow (analogous to context-prompt's summary → response pattern):

1. **Before LLM call**: Fetch `imported_documents` for the project (id, file_name, summary only). If documents exist, append document index to system prompt and add tool definition.

2. **LLM Call #1** (non-streaming): Send messages with tool available. Check response:
   - If **text response** (no tool use): emit all tokens as rapid SSE sequence, then done. Simple path.
   - If **tool call** (`read_imported_document`): fetch `extracted_text` from DB, send tool result back to LLM. Loop up to 5 tool calls.

3. **LLM Call #2+** (streaming): After resolving all tool calls, make final streaming call. Pipe to client as today.

4. **Phase event**: Send `data: {"phase":"reading_documents"}` to client before document retrieval so UI can show "Reading imported documents..."

5. **Persistence**: Store `documents_referenced` (array of doc IDs) on assistant message. Accumulate token usage across all calls in the chain.

#### Tool-use adapter

Add `extractToolCalls(response, provider)` helper that normalizes Mistral's `tool_calls` format (OpenAI-compatible: `response.choices[0].message.tool_calls`).

#### Client Changes

- `useChatMessages.ts`: Handle `phase` events in SSE stream (already supported by `consumeSSEStream` via `onPhase`)
- `ChatPanel.tsx`: Show "Reading imported documents..." loading state when `phase === "reading_documents"`

#### What NOT to change (per spec)
- Context-prompt (Ask/Propose): no document integration
- FLOW analysis: no changes now, just ensure `documents_referenced` is stored
- Projects without documents: zero changes to chat behavior

---

### Technical Notes

- **Model**: Mistral (existing provider) — supports OpenAI-compatible tool calling format with `tools` parameter and `tool_calls` in response
- **RLS**: Uses `owns_project()` function (confirmed exists in DB)
- **Token budget**: All LLM calls in the chain (extraction summary + tool-use calls) deducted from user budget
- **File size validation**: Client-side 10MB check before upload
- **Duplicate file names**: Append timestamp suffix if file already exists

