

## Plan: Compact Timeline Event Cards

### Change

Consolidate each event card into a single-line layout with date, title, category, and character badges all on one row. Description becomes a subtle truncated line below only if present.

### `SortableEventCard` — new layout (lines 78–132)

Replace the current multi-line card body with:

```
┌─[dot]─ [date] · [title]                    [category badge] [char badges] ─┐
│        [description — single line, truncated]                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Top row**: date (inline, muted, small), separator dot, title (semibold), then right-aligned category label + character badges — all in one `flex` row
- **Bottom row** (optional): description as a single `line-clamp-1` line, only rendered if non-empty
- Reduce padding from `p-3` to `px-3 py-1.5`, reduce `mb-3` to `mb-1.5`
- Timeline dot size stays the same, reduce min-height of connector line

### Files Changed

| File | Change |
|------|--------|
| `src/components/creative-tools/TimelineView.tsx` | Refactor `SortableEventCard` render to compact single-row layout |

