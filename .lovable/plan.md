

## Fix: Character Traits Not Persisting & Shared Across Characters

### Root Causes

**Persistence:** `useCreativeData.save()` calls `setData(newData)` but `dataRef` is only updated in a `useEffect` (post-render). When `flush()` fires (e.g., on project switch or page unload), it reads `dataRef.current` which is stale — saving old data and cancelling the debounce timer that held the correct data.

**Shared traits:** `updateData` in `CharactersDiagram` captures `data` in its closure. While `data` is in the `useCallback` deps, if two saves happen in close succession (e.g., closing a dialog auto-saves, then another state update triggers), the second call can use stale `data` that doesn't reflect the first save's changes.

### Fix 1: `src/hooks/useCreativeData.ts`

Add `dataRef.current = newData` synchronously inside the `save` function, right after `setData(newData)`. This ensures `flush()` always has the latest data.

```typescript
const save = useCallback(
  (newData: T) => {
    setData(newData);
    dataRef.current = newData;          // ← ADD: sync ref immediately
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => saveNow(newData), 2000);
  },
  [saveNow]
);
```

### Fix 2: `src/components/creative-tools/CharactersDiagram.tsx`

Replace the `useCallback`-based `updateData` with a ref-based pattern. Store `data` in a ref (updated synchronously every render) and read from the ref inside `updateData`. This makes `updateData` stable (only depends on `save`) while always reading the latest data.

```typescript
// Add ref for latest data (replaces useCallback closure capture)
const latestDataRef = useRef(data);
latestDataRef.current = data;

const updateData = useCallback(
  (updater: (d: CharactersData) => CharactersData) => {
    save(updater(latestDataRef.current));
  },
  [save]
);
```

### Files Changed

| File | Change |
|------|--------|
| `src/hooks/useCreativeData.ts` | Add `dataRef.current = newData` in `save` |
| `src/components/creative-tools/CharactersDiagram.tsx` | Ref-based `updateData` pattern |

