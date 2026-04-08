

## Plan: FLOW Work Profile System

### New File: `src/lib/flow-work-profiles.ts`

Define `FlowProfile` type and `FLOW_PROFILES` constant array with all 16 profiles exactly as specified. Export two functions:

- `getFlowProfile(scores)` — maps pillar scores to a profile by building a 4-char code (letter if ≥3.0, "-" if <3.0 or null), then looks up from a pre-built `Map<string, FlowProfile>` for O(1) access.
- `getProfileCode(scores)` — returns just the 4-char code string.

The map is built once at module load from the `FLOW_PROFILES` array, keyed by `code`.

### New File: `src/lib/__tests__/flow-work-profiles.test.ts`

Six test cases:
- (4.0, 3.5, 3.0, 4.5) → "The Architect"
- (4.0, 4.0, 1.0, 1.0) → "The Visionary"
- (1.0, 1.0, 1.0, 1.0) → "The Conductor"
- (null, 3.5, null, 4.0) → "The Voice"
- (3.0, 3.0, 3.0, 3.0) → "The Architect" (boundary)
- (2.5, 2.5, 2.5, 2.5) → "The Conductor" (just below)

### Files Changed

| File | Change |
|------|--------|
| `src/lib/flow-work-profiles.ts` | New — type, 16 profiles, `getFlowProfile`, `getProfileCode` |
| `src/lib/__tests__/flow-work-profiles.test.ts` | New — 6 unit tests |

