# Plan — Diagnostic logging + two UI fixes

Three things to ship. (1) and (2) are UX fixes that stand on their own. (3) adds the full-prompt + raw-response logging the user needs before we can plan a real fix for Issue A.

## 1. Accept button: loading state + re-entrancy guard

File: `src/components/TextSelectionWindow.tsx`

- Add `const [accepting, setAccepting] = useState(false)` and `const acceptingRef = useRef(false)`.
- Wrap `handleAccept` body in a re-entrancy guard:
  ```
  if (acceptingRef.current) return;
  acceptingRef.current = true;
  setAccepting(true);
  try { ...existing body, including the awaited context-prompt call and onAccept... }
  finally { acceptingRef.current = false; setAccepting(false); }
  ```
- In the result-phase render (lines 680–697), set `disabled={accepting}` on both Accept and Reject buttons; swap the Accept icon for `<Loader2 className="h-3.5 w-3.5 animate-spin" />` and label `"Inserting…"` while `accepting` is true.

File: `src/components/WritingEditor.tsx`

- Add `const isInsertingRef = useRef(false)` (module-scope inside the component).
- At top of `handleAcceptProposal`: `if (isInsertingRef.current) return; isInsertingRef.current = true;`, with `try/finally` releasing in `finally`. Defense in depth so any other caller of `onAccept` is also protected.

## 2. ErrorBoundary around the provenance panel

New file: `src/components/ProvenanceErrorBoundary.tsx`

- Class component with `state = { hasError: false, error: null }`.
- `componentDidCatch(error, info)` logs `[ProvenanceErrorBoundary]` with `error.message`, `error.stack`, and `info.componentStack` so the underlying walker crash is captured.
- Fallback UI: small muted card with text "Provenance display temporarily unavailable." and a Retry button that resets `hasError` and calls an `onRetry` prop.
- Props: `children`, `onRetry?: () => void`.

File: `src/components/ProjectContentArea.tsx`

- Wrap the existing `<FlowHighlightedText ... />` block (around lines 496–501) in `<ProvenanceErrorBoundary onRetry={() => setProvenanceKey((k) => k + 1)}>...</ProvenanceErrorBoundary>`. Retry both resets the boundary and bumps the key so `FlowHighlightedText` remounts with current segments.

## 3. Full FLOW prompt + raw response logging

File: `supabase/functions/analysis/index.ts`

Three new log statements, all gated on `flowModel` matching the failing project (just emit unconditionally — these only fire once per analysis call and edge logs are private).

- **Before the model call**, immediately before `await callLLM(...)`: log the full request body that will be sent. Include `model`, `system` prompt, full `messages` array, and the `tools` block — exactly the payload `toAnthropicBody` (or the OpenAI equivalent) produces. Since these structures can be deep, stringify them so Supabase logs don't truncate nested objects:
  ```
  console.log("FLOW prompt sent", {
    model: flowModel,
    provider: providerFor(flowModel),
    request_body: JSON.stringify(requestBody),
  });
  ```
  The exact local variable name depends on where the body is assembled — locate the call site of `callLLM` and log whatever object is being passed (or build it once into a local for logging).

- **After the model call**, immediately after `rawData` is parsed (line 980): log the full raw response including `stop_reason`, content blocks, tool blocks, usage:
  ```
  console.log("FLOW raw response", {
    model: flowModel,
    stop_reason: rawData?.stop_reason ?? rawData?.choices?.[0]?.finish_reason ?? null,
    raw_response: JSON.stringify(rawData),
  });
  ```

- **Inside the failure branch** (line 1023 `if (validPillarCount < 3 || !hasSummary)`): keep the existing structured log, and additionally log the full extracted `flowResult` so we see the hybrid shape directly:
  ```
  console.error("FLOW raw tool input (full)", {
    model: flowModel,
    raw_tool_input: JSON.stringify(flowResult),
  });
  ```

All three are diagnostics-only. Once the user pastes the logs back, we remove them in a follow-up.

## How the user retrieves the logs

After this ships, on sylou.eu:
1. Trigger one failing FLOW analysis with Claude Sonnet 4.6 on the affected project.
2. Open the edge function logs for `analysis`.
3. Look for the three new entries from the same invocation (`FLOW prompt sent`, `FLOW raw response`, `FLOW raw tool input (full)`) and paste them back.

## Out of scope

- No FLOW schema or prompt changes — diagnose first.
- No changes to the markdown parser, the editor insertion path, the provenance tracker, or the walker in `FlowHighlightedText`. The ErrorBoundary catches the symptom; the underlying walker fix waits until we see the actual thrown error in the console.
- No revert attempts.
