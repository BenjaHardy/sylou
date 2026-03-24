

## Cleanup: Remove Dead Code Artifacts

The codebase has three categories of dead code left over from the refactoring:

### 1. Dead legacy no-op methods in `src/lib/provenance-tracker.ts`
- **`handleTransaction()`** (lines 328-334) — no-op stub, never called
- **`handleSingleChange()`** (lines 339-347) — no-op stub, never called

Both reference the old `preserveSource` types (`'within' | 'tail'`) that no longer exist anywhere in the codebase. Safe to remove entirely.

### 2. Dead `threeGramOverlap` function in `supabase/functions/analysis/index.ts`
- **`threeGramOverlap()`** (lines 314-334) — defined but never called after the 50% reclassification rule was removed

Safe to remove. The `normalise()` and `ngrams()` functions (lines 336-351) are still used by `computeSimilarityPct`, so those stay.

### 3. Everything else is clean
- `WritingEditor.tsx` — no leftover substring-matching code, no `preserveSource` references
- All clipboard/classification logic in the tracker is actively used
- No unused imports detected

### Summary of changes
| File | Action |
|------|--------|
| `src/lib/provenance-tracker.ts` | Remove `handleTransaction` and `handleSingleChange` no-op methods (~20 lines) |
| `supabase/functions/analysis/index.ts` | Remove `threeGramOverlap` function (~21 lines) |

No functional impact — purely dead code removal.

