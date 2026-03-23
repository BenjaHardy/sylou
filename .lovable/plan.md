

## Fix: Save provenance_snapshot in FLOW report

### Problem
The "View Highlighted Text" button never appears because the `provenance_snapshot` column is never populated. The analysis edge function (`supabase/functions/analysis/index.ts`) inserts the flow report at line 715 without including `provenance_snapshot`. The `segmentMap` variable (the reclassified provenance segments) is already computed and available at that point in the function — it just needs to be included in the insert.

### Fix (single change)

**`supabase/functions/analysis/index.ts`** — Add `provenance_snapshot: segmentMap` to the flow_reports insert object (around line 723, after `flow_meta`).

This stores the reclassified segment map alongside the report so the frontend can render the highlighted text view. No database migration needed — the `provenance_snapshot` jsonb column already exists on `flow_reports`.

### Result
After re-analyzing a project, the report will have `provenance_snapshot` populated, the button will appear, and both Write Mode and Clipboard Mode highlighting will work using the stored segment data.

