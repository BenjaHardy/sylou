

## Plan: Delete malformed flow_report row

### What

One row in `flow_reports` (id: `ee960cde-4b35-4983-b6a7-89af7db3e6e0`, created 2026-03-20 21:27:51) has XML-like strings stored in `ai_find`, `ai_lead`, `ai_organize`, and `ai_write` instead of proper JSON objects. This row causes a blank screen when viewing that report because the frontend's `ScoreCard` component crashes on `pillar.evidence`.

The backend validation fix (the `isValidPillar` guard) prevents new malformed rows from being stored, and the frontend defensive rendering prevents crashes even if malformed data exists. So the blank screen issue is already fixed for new reports **and** for viewing this old one (thanks to the frontend guards added earlier).

### Recommendation

**Low priority but worth doing.** The frontend guards already prevent the crash, so this row won't cause a blank screen anymore — it will just show "Insufficient data" fallback text for all four pillars. Deleting it keeps the database clean and avoids confusion if the user sees a report with no real scores.

### Action

Delete the single row using the Supabase insert tool:

```sql
DELETE FROM flow_reports WHERE id = 'ee960cde-4b35-4983-b6a7-89af7db3e6e0';
```

### Files changed

None — database data operation only.

