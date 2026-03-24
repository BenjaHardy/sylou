

## Fix: Per-Step Processing & Within/Tail Distinction

### Problem
Two bugs cause AI text to be reclassified as `[t]` when deleting lines:

1. **Collapsed match type**: `preserveSource` is collapsed from `'within'|'tail'` to a boolean before reaching the tracker. The `'tail'` case needs different handling — pure delete, no insert — but gets the same "delete only the difference" logic as `'within'`.

2. **Multi-step coordinate drift**: All steps in a transaction are collected into a flat array and sorted. But each step's coordinates are relative to the doc state *after* the previous step. Processing them together with a sort corrupts the segment map.

### Changes

**File 1: `src/components/WritingEditor.tsx`** (lines ~106-200)

- Replace batch-collect-then-process with **per-step immediate processing**:
  - For each step in `transaction.steps`, extract its changes, then immediately call `tracker.handleSingleChange(...)` for each change
  - Pass the actual `preserveSource` subtype (`'within' | 'tail' | false`) instead of collapsing to boolean
  - Remove the `changes` array accumulation and the final `tracker.handleTransaction()` call
  - Call `scheduleSave()` once after all steps are processed
- Remove all `console.log('[PROVENANCE DEBUG]')` statements

**File 2: `src/lib/provenance-tracker.ts`** (lines ~227-264)

- Add a new public method `handleSingleChange(change)` that processes one change at a time:
  ```
  handleSingleChange(change: {
    from: number; to: number;
    insertLength: number; insertedText: string;
    preserveSource: 'within' | 'tail' | false;
  })
  ```
- Logic branches:
  - `preserveSource === 'within'`: delete only `[from, from + netDeleted]` — surviving text within the deleted range keeps its provenance
  - `preserveSource === 'tail'`: pure delete `[from, to]`, skip insert entirely — segments after `to` shift left naturally with their original provenance
  - `false`: current behavior — classify and delete+insert
- Call `mergeAdjacent()` at the end of each single change
- Keep `handleTransaction` as-is for backward compatibility (unused but harmless)

### Why this fixes both issues

- Per-step processing ensures each step's coordinates match the tracker's current state — no drift
- The `'tail'` case correctly does a pure delete, letting the surviving AI segments shift left with their `[ai]` source intact

### No other changes needed
No DB, edge function, or UI changes.

