

## Revised Plan: Creative Writing Tools — Foundation + World-Building Notes

### Summary

Same as previous plan with one key architectural correction: `useCreativeData('worldbuilding')` is called **once** in `ProjectContentArea`, and `data`, `save`, `loading` are passed down as props to `WorldBuildingNotes`. The `flush` function from that same instance joins the flush chain. `WorldBuildingNotes` never calls the hook itself.

### Database Migration

```sql
CREATE TABLE public.project_creative_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tool_type TEXT NOT NULL CHECK (tool_type IN ('worldbuilding', 'characters', 'timeline')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, tool_type)
);
ALTER TABLE public.project_creative_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own creative data" ON project_creative_data
  FOR ALL USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
```

### New Hook: `src/hooks/useCreativeData.ts`

- `useCreativeData(projectId, toolType)` returns `{ data, loading, save(newData), flush() }`
- Debounced save (2s), ref-based pattern matching `useWritingContent`
- `flush()` clears timer and saves immediately
- Uses `upsert` with `(project_id, tool_type)` unique constraint

### Hook Ownership in `ProjectContentArea.tsx`

```tsx
// Called ONCE at ProjectContentArea level
const worldbuilding = useCreativeData(project?.id ?? null, 'worldbuilding');

// Flush chain (lines 114-118) — add worldbuilding flush:
const flush = async () => {
  await flushProvenanceRef.current?.();
  await worldbuilding.flush();
};

// Pass down as props:
<WorldBuildingNotes
  data={worldbuilding.data}
  save={worldbuilding.save}
  loading={worldbuilding.loading}
/>
```

- Tab bar (Writing / World-Building / Characters / Timeline) visible only for `project.template === 'creative'`
- CSS-hide pattern: all tab contents stay mounted, toggled via `style={{ display }}`
- State: `activeCreativeTab` defaults to `'writing'`

### `WorldBuildingNotes.tsx` Props

```typescript
interface WorldBuildingNotesProps {
  data: WorldBuildingData;
  save: (data: WorldBuildingData) => void;
  loading: boolean;
}
```

- **No hook call inside** — receives everything via props
- Two-panel layout: sidebar (categories with color + note count) and main panel (notes for selected category)
- Category CRUD: add/rename/recolor/delete with confirmation
- Note CRUD: subcategory dropdown, title, minimal TipTap editor (bold/italic/lists/headings), delete with confirmation
- All mutations call `save(updatedData)` via props
- Default categories seeded on first load: Setting, History, Culture, Rules/Systems, Other

### Placeholder Components

- `CharactersPlaceholder.tsx` / `TimelinePlaceholder.tsx` — "Coming soon" centered message

### Export Integration: `src/lib/export-json.ts`

Add fetch for `project_creative_data` to existing `Promise.all`, include under `creative_data` key.

### Files Changed

| File | Change |
|------|--------|
| Migration | New `project_creative_data` table + RLS |
| `src/hooks/useCreativeData.ts` | New — generic fetch/save/flush hook |
| `src/components/creative-tools/WorldBuildingNotes.tsx` | New — receives data/save/loading as props |
| `src/components/creative-tools/CharactersPlaceholder.tsx` | New — placeholder |
| `src/components/creative-tools/TimelinePlaceholder.tsx` | New — placeholder |
| `src/components/ProjectContentArea.tsx` | Call hook once, tab bar, CSS-hide, flush chain, pass props |
| `src/lib/export-json.ts` | Fetch + include `project_creative_data` |

