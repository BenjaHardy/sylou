## Remove the unused "Checks" (sanity check) badge from the activity bar

### UI change

In `src/components/ProjectActivityBar.tsx`:
- Drop the `Shield` import from `lucide-react`.
- Remove the `Checks` entry from `ACTIVITY_TOOLTIPS`.
- Remove the `{ icon: Shield, label: "Checks", ... }` item from the `items` array.

The remaining three badges (Active, Writing, Prompts) stay unchanged.

### Other "sanity check" references (left in place)

The feature isn't wired to any UI other than the badge above, but the data plumbing still exists. None of these need to change for this request — flagging for awareness:

- `src/hooks/useProjectStats.ts` — selects `sanity_check_count` from the stats table; type field still exposed.
- `src/hooks/useFlowAnalysis.ts` — `sanity_check_count` field on the analysis type.
- `supabase/functions/analysis/index.ts:1027` — copies `sanity_check_count` into the analysis payload.
- `src/integrations/supabase/types.ts` — generated DB column types (Row/Insert/Update).

No FLOW report component, export (DOCX/JSON), or other view reads the value. If you want, a follow-up can prune the field from the hooks, the analysis edge function, and (via migration) the DB column. Not doing that here since the request was scoped to the icon.

### Verification

- Open a project; the activity bar at the bottom of the editor shows only Active / Writing / Prompts. No shield icon, no layout shift.
- Tooltips on the remaining three badges still work.
