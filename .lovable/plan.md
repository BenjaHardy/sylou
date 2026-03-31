

## Plan: Add Bookmark Functionality to Chat Panel (revised)

### Addressing Your Comments

1. **`owns_project` function**: Already exists in the database (confirmed in db-functions). The RLS policies will use it directly — consistent with `chat_threads`, `provenance_events`, `project_stats`, etc.

2. **Scroll-to-bookmark timing**: Will use a `useEffect`-based approach — set a `pendingScrollTarget` ref, then watch for the target `message.id` appearing in the loaded messages array before triggering `scrollIntoView`. No fixed timeouts.

3. **Thread name prominence in bookmark list**: Grouping headers will use bold thread names with a separator line, not subtle labels.

---

### Database

**Migration: create `chat_bookmarks` table**

```sql
CREATE TABLE public.chat_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  message_id uuid NOT NULL,
  char_offset int DEFAULT 0,
  color text DEFAULT 'blue',
  annotation text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_bookmarks" ON public.chat_bookmarks FOR SELECT TO authenticated USING (owns_project(project_id));
CREATE POLICY "insert_own_bookmarks" ON public.chat_bookmarks FOR INSERT TO authenticated WITH CHECK (owns_project(project_id));
CREATE POLICY "update_own_bookmarks" ON public.chat_bookmarks FOR UPDATE TO authenticated USING (owns_project(project_id)) WITH CHECK (owns_project(project_id));
CREATE POLICY "delete_own_bookmarks" ON public.chat_bookmarks FOR DELETE TO authenticated USING (owns_project(project_id));
```

### New Files

| File | Purpose |
|------|---------|
| `src/hooks/useBookmarks.ts` | CRUD hook: fetch by project, create/update/delete via Supabase client |
| `src/components/BookmarkPopover.tsx` | Color picker (5 colors), annotation text field, delete button |
| `src/components/BookmarkListPanel.tsx` | All bookmarks grouped by thread with bold thread name headers; click navigates |

### Modified Files

| File | Change |
|------|--------|
| `src/components/ChatPanel.tsx` | Add `data-message-id` to ChatBubble wrappers; pass bookmarks + handlers to ChatBubble; add bookmark list toggle button in header; scroll-to-bookmark logic via `useEffect` watching messages array |

### Key Implementation Details

**ChatBubble bookmark UI:**
- Wrapper div gets `data-message-id={msg.id}` and `group/msg` class
- On hover: small `Bookmark` icon appears at right edge (absolute positioned)
- If bookmarked: persistent 3px colored bar on right edge (color from bookmark record)
- Click unbookmarked icon → `createBookmark(projectId, threadId, messageId)`
- Click bookmarked bar → opens `BookmarkPopover`

**Scroll-to-bookmark (no timeouts):**
```typescript
// In ChatPanel:
const pendingScrollTarget = useRef<string | null>(null);

// When bookmark clicked in list:
const handleBookmarkNavigate = (threadId: string, messageId: string) => {
  pendingScrollTarget.current = messageId;
  onActiveThreadChange(threadId); // switches thread, triggers fetch
};

// useEffect watches messages:
useEffect(() => {
  if (!pendingScrollTarget.current) return;
  const targetId = pendingScrollTarget.current;
  const found = messages.find(m => m.id === targetId);
  if (found) {
    pendingScrollTarget.current = null;
    const el = document.querySelector(`[data-message-id="${targetId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Brief highlight ring via temporary class
    el?.classList.add('ring-2', 'ring-primary/50');
    setTimeout(() => el?.classList.remove('ring-2', 'ring-primary/50'), 2000);
  }
}, [messages]);
```

**Bookmark list panel:**
- Toggle via `Bookmark` icon in chat header (next to concise toggle)
- Groups by thread with visually prominent headers:
  ```
  ┌─────────────────────────┐
  │ 🔖 Bookmarks            │
  ├─────────────────────────┤
  │ ■ Research Thread        │  ← bold, with thread color
  │   🔵 "The main argum…"  │
  │   🟢 "Check source on…" │
  │                         │
  │ ■ Main                  │
  │   🟡 "Draft intro par…" │
  └─────────────────────────┘
  ```
- Each entry: colored dot + first ~50 chars of message content + annotation preview
- Click → `handleBookmarkNavigate(threadId, messageId)`

**useBookmarks hook:**
- Fetches all bookmarks for `projectId` on mount
- `createBookmark(threadId, messageId)` → insert with default color "blue"
- `updateBookmark(id, { color?, annotation? })` → partial update
- `deleteBookmark(id)` → delete
- Local state updates optimistically for snappy UI

