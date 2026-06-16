Update model list descriptions and footer notes in the Settings dialog.

### Changes to `src/lib/models.ts`

1. **Mistral Small 4** (`mistral-small-2603`):
   - Remove `isExperimental: true` (keep experimental on DeepSeek only).
   - Remove `note: "Reasoning model — fastest Mistral tier"`.

2. **Mistral Medium 3.5** (`mistral-medium-3-5`):
   - Change `note` from `"Reasoning model"` to `"Recommended for FLOW analysis"`.

3. **Claude Opus 4.8** (`claude-opus-4-8`):
   - Remove `note: "Recommended for FLOW analysis"`.

### Changes to `src/components/SettingsDialog.tsx`

1. Update the italic footer note: change `"Indicative provider rates as of April 2026"` to `"Indicative provider rates as of June 2026"`.

2. Add a second note paragraph directly below the existing italic footer:
   > "Check the Model Configuration Reference on GitHub for more details on model configurations and behavior across functions."

No other UI or logic changes. The document referenced in the new note will be maintained separately by the user.