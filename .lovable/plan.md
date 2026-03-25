

## Fix: Insertion Range Calculation Bug in Step 2

### Root Cause

Three bugs on lines 266-271 of `provenance-tracker.ts` prevent insertion ranges from being detected correctly:

1. **Wrong mapping bias** (line 269): `mapping.map(oldStart, 1)` uses bias `1` (right), which maps `oldStart` to the **end** of the replacement, not the beginning. For a paste of 3976 chars at position 1, `mapping.map(1, 1)` returns `3977` — the finalStart is past the entire insertion, so the insertion range `[3977, 7953]` is outside the doc and never matches any segment.

2. **Only counting net excess** (line 270): `insertionLength = newLen - oldLen` only captures the difference. For a replacement (select 10 chars, paste 15), only 5 chars are treated as "inserted" — the other 10 new chars inherit the old segment's source incorrectly.

3. **Skipping replacements where newLen ≤ oldLen** (line 266): `newLen > oldLen` skips cases where you select 10 chars and paste 5. Those 5 new chars also need classification.

### Fix

**File: `src/lib/provenance-tracker.ts`** (lines 266-272)

Change three things in the step map forEach callback:

```
if (newLen > 0) {                                    // was: newLen > oldLen
  const finalStart = mapping.map(oldStart, -1);      // was: bias 1
  const insertionLength = newLen;                     // was: newLen - oldLen
  const finalEnd = finalStart + insertionLength;
  insertionRanges.push({ start: finalStart, end: finalEnd });
}
```

- **Bias -1**: maps `oldStart` to the position *before* the inserted content — the correct start of the insertion range
- **Full newLen**: the entire new content range needs classification, not just the excess
- **newLen > 0**: catches all insertions including replacements where fewer chars replace more

### Why this works

| Scenario | Old code | Fixed code |
|----------|----------|------------|
| Paste 3976 chars at pos 1 | `finalStart=3977` (past doc!) | `finalStart=1`, range `[1, 3977]` ✓ |
| Paste 17 chars at pos 8 in [0,32] | `finalStart=25` (wrong) | `finalStart=8`, range `[8, 25]` ✓ |
| Select [20,30] in [ai], paste 15 chars | `finalStart=35` (wrong) | `finalStart=20`, range `[20, 35]` ✓ |
| Select [20,30] in [ai], paste 5 chars | Skipped entirely | `finalStart=20`, range `[20, 25]` ✓ |
| Pure deletion | newLen=0, skipped | newLen=0, skipped ✓ |

The existing segment-splitting logic (lines 297-340) and gap classification (lines 342-384) work correctly once they receive the right insertion ranges. No other changes needed.

