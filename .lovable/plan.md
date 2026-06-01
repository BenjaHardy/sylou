Remove the "Sanity Check" action from the text selection window ("Interact with AI").

Scope
- File: `src/components/TextSelectionWindow.tsx`

Changes
1. Remove `"sanity-check"` from the `ActionId` union type.
2. Remove the `{ id: "sanity-check", label: "Sanity Check", row: 2 }` entry from `NORMAL_ACTIONS`.
3. Remove the `{ id: "sanity-check", label: "Sanity Check", row: 1 }` entry from `TUTOR_ACTIONS`.
4. Remove the no-op `if (actionId === "sanity-check") { return; }` block inside `handleAction`.

No other files or edge functions reference this action.