

## Fix: Include Editor Action Text Details in FLOW Prompt

### Problem

When a user writes text themselves and then uses Grammar/Rewrite/Translate, the provenance system correctly marks the result as `[ai]`. However, the FLOW analysis LLM only receives aggregate statistics from `ai_editor_actions` (e.g., "grammar=3, rewrite=1, accepted=4"). It never sees:

- The **original text** the user wrote before the AI action
- The **AI result** that replaced it
- The **action type** and **outcome** per action

This means the LLM has no evidence that the user authored the underlying content. A fully user-written document that was grammar-checked gets scored as if the AI wrote everything, because the provenance says `[ai]` and the LLM sees no counterevidence.

### Solution

**File: `supabase/functions/analysis/index.ts`**

1. **Expand the query** — add `selected_text_preview`, `ai_response_preview`, and `instruction_text` to the `ai_editor_actions` select:
   ```
   .select("action_type, outcome, char_count_original, char_count_result, selected_text_preview, ai_response_preview, instruction_text")
   ```

2. **Build a detailed editor actions section** — update `buildEditorStatsString` to append a per-action log after the summary statistics. For each action, include:
   - Action type and outcome
   - The user's original text (`selected_text_preview`)
   - The AI result (`ai_response_preview`)
   - Instruction text if present (e.g., translation target)

   Format example:
   ```
   --- Action 1: grammar (accepted) ---
   Original (user-written): "The quick brown fox jump over the lazy dogs..."
   AI result: "The quick brown fox jumps over the lazy dogs..."
   ```

3. **Cap the output** — to avoid blowing up the prompt with too many actions, limit the detailed log to the most recent ~20 actions. Keep the aggregate statistics for all actions.

### Why this is safe

- `selected_text_preview` and `ai_response_preview` are already capped at 500 chars each at insert time
- The `ai_response_full` field (uncapped) is intentionally NOT included — previews are sufficient for the LLM to understand the nature of the edit
- Ask/Propose actions are already visible via chat history, so this primarily helps Grammar, Rewrite, Shorten, Expand, and Translate actions

### Result

The FLOW LLM will see that the user wrote the original text and merely used AI for surface-level corrections, allowing it to assign appropriate human contribution scores rather than treating everything as AI-generated.

