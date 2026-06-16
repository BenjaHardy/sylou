**Goal:** Make the "Chat model" and "FLOW analysis model" section labels in the Settings → Models tab visually distinct by colouring them in Sylou blue, while leaving the model option rows unchanged.

**What will change:**
- In `src/components/SettingsDialog.tsx`, the two `<Label>` elements at lines 118 and 135 ("Chat model" and "FLOW analysis model") will gain the `text-primary` Tailwind class.
- The sub-line descriptions beneath each label will remain `text-muted-foreground`.
- The `ModelOption` rows (labels, pricing, notes, selected/hover states) will keep their existing colours exactly as they are now.

**What will NOT change:**
- No other settings tabs, no model data in `src/lib/models.ts`, no spacing or layout structure other than the label colour.

**Files touched:** `src/components/SettingsDialog.tsx` only.