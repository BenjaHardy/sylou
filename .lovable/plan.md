

## Plan: Add Post-it Notes (revised)

### Addressing Your Comments

1. **`owns_project` function**: Confirmed it exists (see db-functions). RLS policies will use it directly, consistent with bookmarks and other tables.

2. **Editor preservation**: The FLOW report already uses `style={{ display: showingFlowReport ? 'none' : undefined }}` (line 246) to hide the editor without unmounting. Post-its will use the same pattern — a `showPostIts` state that hides the editor/chat via CSS while rendering the PostItsPanel. No early returns, no unmounting.

3. **Drag debounce**: Position updates will use optimistic local state for responsiveness. DB persistence on `onMouseUp` will be debounced at 500ms — rapid nudges only trigger one write after the user stops.

---

### Database

```sql
CREATE TABLE public.post_its (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'yellow',
  position_x int NOT NULL DEFAULT 50,
  position_y int NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.post_its ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_post_its" ON public.post_its FOR SELECT TO authenticated USING (owns_project(project_id));
CREATE POLICY "insert_own_post_its" ON public.post_its FOR INSERT TO authenticated WITH CHECK (owns_project(project_id));
CREATE POLICY "update_own_post_its" ON public.post_its FOR UPDATE TO authenticated USING (owns_project(project_id)) WITH CHECK (owns_project(project_id));
CREATE POLICY "delete_own_post_its" ON public.post_its FOR DELETE TO authenticated USING (owns_project(project_id));
```

### Files

| File | Change |
|------|--------|
| `src/hooks/usePostIts.ts` | **New.** CRUD hook: fetch by project, create/update (debounced position)/delete |
| `src/components/PostItsPanel.tsx` | **New.** Canvas with draggable sticky notes, inline editing, color picker, delete |
| `src/components/ProjectContentArea.tsx` | Add "Post-its" button in header; `showPostIts` state; hide editor/chat via CSS (same `display: none` pattern as FLOW) |

### Implementation Details

- **Drag**: `onMouseDown`/`onMouseMove`/`onMouseUp` on each note. Local state updates immediately. A 500ms debounced function persists `position_x`/`position_y` to DB after the last `onMouseUp`.
- **Colors**: yellow `#FEF3C7`, blue `#DBEAFE`, green `#D1FAE5`, pink `#FCE7F3`, purple `#EDE9FE`
- **Note UI**: ~160×160px card, editable textarea, hover toolbar with color dots + trash icon (with confirmation)
- **"+" button**: Fixed position on canvas, creates note at a staggered default position
- **Close**: Returns to editor view (sets `showPostIts = false`)

