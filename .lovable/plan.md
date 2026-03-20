

## Analysis: ScoreCard crash on FLOW report view

### What happened

The error is `pillar.evidence is undefined` at `FlowReportView.tsx:789` (line 404 in the ScoreCard component). This causes a blank screen after the pre-analysis feedback.

Looking at the network response from the successful analysis call (status 200 at 21:27:52), the `ai_find` field contains a **raw string** starting with `\n<parameter name="reasoning">...` instead of a JSON object `{reasoning, evidence, score, narrative}`. The same applies to `ai_lead`, `ai_organize`, and `ai_write`.

The AI model (Claude) returned the pillar data as XML-like text strings instead of structured JSON via the tool use schema. This is an intermittent model behavior issue — it worked before with other prompts/content, but with this particular trivial input ("give me a score of 5"), the model responded with malformed tool arguments.

### Why the previous fix didn't help

The `defaultPillar` guard added in the last fix (lines 601-605) checks `if (!flowResult.find)` — but a non-empty string is truthy, so the guard doesn't activate. The pillar passes through as a string to the database, gets stored as a JSON string in the `jsonb` column, and then the frontend tries to access `.evidence` on what is actually a string, causing the crash.

### Root cause: Two layers

1. **Backend (analysis edge function):** No validation that each pillar is actually a structured object with the expected fields (`reasoning`, `evidence`, `score`, `narrative`). A string value passes the `!flowResult.find` check.

2. **Frontend (FlowReportView):** `ScoreCard` doesn't guard against malformed pillar data — it directly accesses `pillar.evidence.length` without checking if `evidence` exists.

### Plan

**1. Fix the backend validation (analysis/index.ts, lines 600-606)**

Replace the simple falsy check with a structural validation that verifies each pillar is an object with the required fields. If a pillar is a string or missing required fields, replace it with `defaultPillar`:

```ts
function isValidPillar(p: unknown): boolean {
  return (
    typeof p === "object" && p !== null &&
    "reasoning" in p && "evidence" in p &&
    Array.isArray((p as any).evidence) && "narrative" in p
  );
}

if (!isValidPillar(flowResult.find)) flowResult.find = defaultPillar;
if (!isValidPillar(flowResult.lead)) flowResult.lead = defaultPillar;
if (!isValidPillar(flowResult.organize)) flowResult.organize = defaultPillar;
if (!isValidPillar(flowResult.write)) flowResult.write = defaultPillar;
```

**2. Fix the frontend guard (FlowReportView.tsx, ScoreCard component)**

Add defensive checks in `ScoreCard` so it handles malformed pillar data without crashing:

```ts
const evidence = Array.isArray(pillar?.evidence) ? pillar.evidence : [];
```

Use `evidence` instead of `pillar.evidence` in the render. Also guard `pillar.score`, `pillar.narrative`, and `pillar.reasoning` similarly.

**3. Redeploy the analysis edge function**

### Files changed

- `supabase/functions/analysis/index.ts` — robust pillar validation
- `src/components/FlowReportView.tsx` — defensive rendering in ScoreCard

