

## Fix: Pass `concise_mode` to Context-Prompt Calls

### Problem
The `concise_mode` toggle lives in `ChatPanel` state but is never passed to the `context-prompt` edge function. The `TextSelectionWindow` component calls `context-prompt` without `concise_mode` in the body (line 192-201), so `body.concise_mode` always evaluates to `false` on the server side. The edge function logic itself is correct — it just never receives `true`.

### Fix

1. **`TextSelectionWindow.tsx`** — Accept a `conciseMode` prop and include `concise_mode: conciseMode` in the `context-prompt` invocation body (line ~194).

2. **`ProjectContentArea.tsx`** (or wherever `TextSelectionWindow` is rendered) — Pass the `conciseMode` value down. This requires either:
   - Lifting the `conciseMode` state up from `ChatPanel` to the parent component, or
   - Reading `conciseMode` from a shared source (e.g., project settings or a context provider)

   The simplest approach: lift `conciseMode` state to the parent that renders both `ChatPanel` and `TextSelectionWindow`, then pass it as a prop to both.

### Steps

1. Move `conciseMode` / `setConciseMode` state from `ChatPanel` to `ProjectContentArea`
2. Pass `conciseMode` and `setConciseMode` as props to `ChatPanel`
3. Pass `conciseMode` as a prop to `TextSelectionWindow`
4. In `TextSelectionWindow`, add `concise_mode: conciseMode` to the edge function call body

