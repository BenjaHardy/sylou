

## Fix: Pass `concise_mode` to Context-Prompt Calls

### Status: ✅ Completed

### Problem
The `concise_mode` toggle lived in `ChatPanel` state but was never passed to the `context-prompt` edge function called by `TextSelectionWindow`.

### Fix Applied
1. Lifted `conciseMode` state from `ChatPanel` to `ProjectContentArea`
2. Passed `conciseMode` and `setConciseMode` as props to `ChatPanel`
3. Passed `conciseMode` through `WritingEditor` to `TextSelectionWindow`
4. Added `concise_mode: conciseMode` to the `context-prompt` invocation body in `TextSelectionWindow`
