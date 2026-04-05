

## Plan: Add Export Functionality (PDF, DOCX, JSON)

### Summary

Add an export dropdown to the editor toolbar with three options: "Export Writing as PDF", "Export Writing as DOCX", and "Export Project as JSON". PDF uses `window.print()`. DOCX uses `html-to-docx` with `editor.getHTML()`. JSON aggregates full project data. Tier enforcement is stubbed (PDF for all, DOCX/JSON gated for free tier).

### Changes

#### 1. Install dependencies

- `html-to-docx` (converts HTML string to DOCX buffer)
- `file-saver` + `@types/file-saver` (trigger downloads)

#### 2. `src/components/EditorToolbar.tsx`

- Add `FileDown` icon from Lucide after the Find & Replace toggle
- Wrap it in a `DropdownMenu` with three items:
  - "Export Writing as PDF" (always enabled)
  - "Export Writing as DOCX" (lock icon for free tier)
  - "Export Project as JSON" (lock icon for free tier)
- New props: `onExportPDF`, `onExportDOCX`, `onExportJSON`, `subscriptionTier?: string`

#### 3. `src/components/WritingEditor.tsx`

- Query `profiles.subscription_tier` for current user (via existing auth context)
- Implement three handlers:
  - **PDF**: Call `window.print()` — CSS handles the rest
  - **DOCX**: Call `editor.getHTML()`, pass to `html-to-docx`, save blob via `file-saver`
  - **JSON**: Call `exportProjectAsJson(projectId)`, save blob
- Pass handlers + tier to `EditorToolbar`

#### 4. New file: `src/lib/export-docx.ts`

```typescript
import htmlToDocx from "html-to-docx";
import { saveAs } from "file-saver";

export async function exportWritingAsDocx(html: string, projectName: string) {
  const blob = await htmlToDocx(html, null, {
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true,
  });
  saveAs(blob as Blob, `${projectName}.docx`);
}
```

#### 5. New file: `src/lib/export-json.ts`

- `exportProjectAsJson(projectId: string): Promise<void>`
- Fetches from Supabase in parallel:
  - `projects` (name, template, language, tutor_mode, created_at)
  - `writing_content` (content)
  - `chat_threads` + `chat_messages` (full history)
  - `chat_bookmarks` (all fields)
  - `post_its` (all fields)
  - `flow_reports` — explicit select excluding: `share_token`, `provenance_snapshot`
  - `project_stats` (all fields)
  - `imported_documents` (metadata only: id, file_name, file_size_bytes, uploaded_at, summary — no extracted_text, no file_path)
- Wraps in `{ exported_at, version: "1.0", project: { ... } }`
- Saves as `{projectName}_export.json` via Blob URL download

#### 6. `src/index.css` — Print styles

Add `@media print` block at the end:
- Hide everything except the TipTap editor content area (sidebar, toolbar, status bar, chat panel, AI buttons, dialogs)
- Set editor content to fill the page with standard margins
- Remove background colors, borders

#### 7. Tier enforcement

- PDF: always allowed
- DOCX/JSON: if `subscription_tier === 'free'`, show toast "Upgrade to Starter or above to export as DOCX/JSON" and return early
- Actual upgrade flow deferred to later

### Files Changed

| File | Change |
|------|--------|
| `package.json` | Add `html-to-docx`, `file-saver`, `@types/file-saver` |
| `src/components/EditorToolbar.tsx` | Add export dropdown menu with three labeled items |
| `src/components/WritingEditor.tsx` | Export handlers, tier query, pass props |
| `src/lib/export-docx.ts` | New — HTML to DOCX via html-to-docx |
| `src/lib/export-json.ts` | New — full project data aggregation and download |
| `src/index.css` | Print media styles |

