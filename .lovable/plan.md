

## Fix: Provenance Data Mismatch in FLOW Analysis

### Problem

The analysis edge function reads provenance segments using the wrong field name and wrong values:

- **Field**: reads `seg.type` but the DB stores `seg.source`
- **Values**: expects `copy_chat`, `copy_external`, `ai` but the DB stores `chat_ai`, `external`, `ai_editor`

This means `buildProvenanceAnnotatedWriting` and `computeProvenanceStats` can't match any segment types, so gaps between segments default to `typed` — explaining why the FLOW analysis reports ~5% typed / 0% AI even when the highlighted text view (which reads `seg.source` correctly) shows the text is entirely AI-generated.

### Fix

**Single file: `supabase/functions/analysis/index.ts`**

Update both `buildProvenanceAnnotatedWriting` and `computeProvenanceStats` to:

1. Read `seg.source` instead of `seg.type` (with fallback to `seg.type` for any legacy data)
2. Map the actual stored values to the display tags:
   - `typed` / `chat_user` → `[t]` / `typed`
   - `chat_ai` → `[cc]` / `copy_chat`
   - `ai_editor` → `[ai]` / `ai`
   - `external` → `[ce]` / `copy_external`

3. Update the reclassification block (line ~465) to also read `seg.source` instead of `seg.type`

No database or frontend changes needed — the stored data is correct, only the analysis function misreads it.

