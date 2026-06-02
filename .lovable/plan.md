## Goal
Remove the "Modify" option entirely from the AI text-selection window. After this change, every action (Propose, Fix grammar, Rewrite, Simplify, Expand, Translate, Ask) will only offer Accept / Reject on its result. Accept and Reject behaviour is unchanged.

## Changes — `src/components/TextSelectionWindow.tsx`

1. **Streaming phase UI** (lines ~692–705): remove the disabled "Modify" `<Button>` from the placeholder action row.
2. **Result phase UI** (lines ~736–747): remove the "Modify" `<Button>` that switches to the modify phase.
3. **Modify phase block** (lines ~761–801): delete the entire `{phase === "modify" && (...)}` JSX block.
4. **Type `Phase`** (line 21): drop the `"modify"` literal from the union.
5. **Dead code cleanup**:
   - Remove `editableText` state and its `useState`.
   - Remove `handleAcceptModified` callback (lines ~525–567).
   - Remove the unused `Pencil` import from `lucide-react` (line 2).
6. **Comment update** in `src/lib/provenance-tracker.ts` line 21: change `(Accept/Modify)` to `(Accept/Reject)` to keep documentation accurate.

## Not changed
- `handleAccept` and `handleReject` are untouched — Accept/Reject paths for both predefined editor actions and Propose continue to work exactly as before.
- Backend (`context-prompt`, `editor-action`) is untouched. The `outcome: "modified"` value in `ai_editor_actions` becomes unreachable from the UI but the column/values are left as-is for historical records.

## Verification
- Trigger each action (Fix grammar, Rewrite, Simplify, Expand, Translate, Propose); confirm the result phase shows only Accept and Reject.
- Accept replaces the selection as before; Reject closes the panel and (for Propose) logs the rejection.
- Streaming phase no longer shows a disabled Modify placeholder.
- No TypeScript errors from the removed `"modify"` phase or unused imports.