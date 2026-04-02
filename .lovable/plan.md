

## Plan: FLOW Analysis — Imported Documents Integration

### Summary

Populate the existing `=== IMPORTED DOCUMENTS ===` placeholder in the FLOW analysis prompt with actual document data, add `documents_referenced` to chat history formatting, implement a 3-tier token budget fallback, store the tier in `flow_meta`, and show an info notice in the report UI.

### Changes

#### 1. Edge Function: `supabase/functions/analysis/index.ts`

**Fetch imported documents** — Add to the parallel data fetch (line ~420):
```typescript
supabase.from("imported_documents")
  .select("id, file_name, extracted_text, summary, file_size_bytes")
  .eq("project_id", projectId)
```

**Include `documents_referenced` in chat history** — Update chat messages query (line ~476) to also select `documents_referenced`. In `buildChatHistoryString`, when a message has `documents_referenced`, look up file names from the imported docs array and append `[Documents referenced: "file1.pdf", "file2.docx"]`.

**3-tier token budget for documents** — After building all prompt sections except imported documents:
1. Estimate total tokens with full `extracted_text` for all docs
2. If within context limit → **Tier 1**: include full text
3. If over → try with `summary` instead → **Tier 2**: include summaries with fallback notice
4. If still over → **Tier 3**: exclude documents, include exclusion notice with count and word estimate

Use 1 token ≈ 4 chars estimation. Context limit: 200k tokens for Claude minus 4k output reserve.

**Build IMPORTED DOCUMENTS section** — Replace the hardcoded `None` (line ~581) with the tiered content.

**Store tier in `flow_meta`** — Add `imported_documents_mode` (`"full_text"` | `"summaries"` | `"excluded"` | `"none"`), `imported_documents_count`, and `imported_documents_total_chars` to the `flowMeta` object.

#### 2. UI: `src/components/FlowReportView.tsx`

Add a small info notice near the token usage section when `flow_meta.imported_documents_mode` is `"summaries"` or `"excluded"`:
- **Summaries**: "Imported documents were included as summaries due to context length limits."
- **Excluded**: "Imported documents ({count}) were excluded from this analysis due to context length limits."

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/analysis/index.ts` | Fetch docs, enrich chat history with `documents_referenced`, 3-tier fallback, populate IMPORTED DOCUMENTS section, store mode in flow_meta |
| `src/components/FlowReportView.tsx` | Show info notice for summaries/excluded tiers |

No database migration needed.

