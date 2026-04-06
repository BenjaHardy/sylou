

## Plan: Characters Diagram + Timeline View

### Summary

Replace Characters and Timeline placeholders with full implementations. Characters gets a draggable canvas with relationship lines and a relationship types manager. Timeline gets a vertical sortable event list. Both reference World-Building categories for color-coding. Cross-tool cleanup on character deletion removes references from timeline events.

### Dependencies

Install `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.

### Data Shapes

```typescript
// Characters
interface CharactersData {
  characters: Character[];
  relationshipTypes: RelationshipType[];
  relationships: Relationship[];
}
interface Character {
  id: string; name: string; description: string;
  traits: string[]; category_id: string | null;
  position: { x: number; y: number };
}
interface RelationshipType { id: string; label: string; color: string; }
interface Relationship {
  id: string; from_id: string; to_id: string;
  type_id: string; notes: string;
}

// Timeline
interface TimelineData { events: TimelineEvent[]; }
interface TimelineEvent {
  id: string; title: string; description: string;
  date: string; order: number;
  character_ids: string[]; category_id: string | null;
}
```

### Interaction Model (addressing the three-conflict issue)

**Normal mode**: Cards are draggable via `@dnd-kit` `PointerSensor` with `activationConstraint: { distance: 8 }` — a stationary click opens the edit modal, a deliberate move starts a drag. SVG relationship lines update live during drag by reading the active drag item's `transform` from `useDndMonitor` and applying it to the dragged character's line endpoints.

**"Add Relationship" mode**: Toggled via a toolbar button. When active:
- A visible banner at top: "Click two characters to create a relationship. Press Escape or Cancel to exit."
- Drag is disabled (PointerSensor removed from `sensors` array)
- Click on a card selects it (first click = source highlighted, second click = target → opens type picker dialog → creates relationship → exits mode)
- Escape key or Cancel button exits mode, clears selection

### Live SVG Lines During Drag

- Lines rendered from committed `character.position` values
- `useDndMonitor` provides `onDragMove` with the active item ID and `delta`
- Store `activeDragId` and `activeDragDelta` in state
- When rendering lines, if an endpoint character matches `activeDragId`, add `activeDragDelta` to its position
- On `onDragEnd`, commit new position to data, clear active drag state

### Cross-Tool Cleanup on Character Deletion

When a character is deleted in `CharactersDiagram`:
- Remove all relationships involving that character
- Call a `onCharacterDeleted(characterId)` callback passed from `ProjectContentArea`
- `ProjectContentArea` handles removing the character ID from all timeline events' `character_ids` arrays and calls `timeline.save()`

### Hook Integration in `ProjectContentArea.tsx`

```tsx
const characters = useCreativeData<CharactersData>(project?.id ?? null, "characters");
const timeline = useCreativeData<TimelineData>(project?.id ?? null, "timeline");
```

Add `characters.flush()` and `timeline.flush()` to the flush chain. Pass `data`, `save`, `loading` as props plus `worldCategories` from worldbuilding data.

**Character deletion handler** at ProjectContentArea level:
```tsx
const handleCharacterDeleted = useCallback((charId: string) => {
  const events = timeline.data.events;
  if (!events?.length) return;
  const cleaned = events.map(e => ({
    ...e,
    character_ids: e.character_ids.filter(id => id !== charId),
  }));
  timeline.save({ events: cleaned });
}, [timeline.data, timeline.save]);
```

### New Files

**`src/lib/creative-tools-utils.ts`** — `getCategoryColor(categories, categoryId)` and `getCategoryLabel(categories, categoryId)` helpers.

**`src/components/creative-tools/CharactersDiagram.tsx`**

Props: `data`, `save`, `loading`, `worldCategories`, `onCharacterDeleted`

- Top toolbar: "Add Character" button, "Add Relationship" toggle, "Relationship Types" button, category filter dropdown
- Canvas: absolutely positioned character cards, SVG overlay for relationship lines
- Card: colored border from world-building category, name, truncated description, trait chips
- Edit modal (Dialog): name, description, traits tag input, category dropdown, delete button
- Default seed on empty data: 5 default relationship types (Family/red, Friend/green, Enemy/orange, Ally/blue, Mentor/purple), empty characters array
- Relationship line click → popover to view/edit notes/delete
- Multiple relationships between same pair offset by 8px

**`src/components/creative-tools/RelationshipTypesModal.tsx`**

Dialog to CRUD relationship types with color picker. Deleting a type removes all relationships of that type.

**`src/components/creative-tools/TimelineView.tsx`**

Props: `data`, `save`, `loading`, `worldCategories`, `characters` (from characters data for name chips)

- Top toolbar: "Add Event" button, category filter
- Vertical timeline with central line, event cards sorted by `order`
- `@dnd-kit/sortable` for reordering, recomputes `order` on drag end
- Event card: date, title, description (truncated), category color border, character name chips
- Edit modal: title, date, description, multi-select characters, category dropdown, delete
- Empty state message when no events

### Changes to `ProjectContentArea.tsx`

- Import `CharactersDiagram`, `TimelineView`, remove placeholder imports
- Add `useCreativeData` for characters and timeline
- Add flushes to flush chain (parallel with worldbuilding flush)
- Wire `handleCharacterDeleted` callback
- Pass props including `worldCategories` and cross-tool data
- Replace placeholder divs with real components

### Files Changed

| File | Change |
|------|--------|
| `package.json` | Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| `src/lib/creative-tools-utils.ts` | New — category color/label helpers |
| `src/components/creative-tools/CharactersDiagram.tsx` | New — full characters tool |
| `src/components/creative-tools/RelationshipTypesModal.tsx` | New — relationship types CRUD dialog |
| `src/components/creative-tools/TimelineView.tsx` | New — full timeline tool |
| `src/components/ProjectContentArea.tsx` | Replace placeholders, add hooks, flush chain, cross-tool cleanup, pass props |

