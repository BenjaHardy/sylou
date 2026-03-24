

## Fix: Capture Provenance Source Breakdown for Selected Text

### Problem

When text is selected for an editor action (Grammar, Rewrite, etc.) or Ask/Propose, the system logs the original text preview but not **where that text came from**. If a user copy-pasted external text and then ran Grammar on it, the FLOW prompt would see the original text labeled as "Original (user-written)" — incorrectly implying authorship.

### Approach

Add a source breakdown string (e.g., `"85% typed, 15% external"`) computed from the provenance tracker at the moment the user triggers the action, and pass it through to the edge functions for logging.

### Changes

**File 1: `src/lib/provenance-tracker.ts`**

- Add `getSourceBreakdown(from: number, to: number): string` method
  - Reuses the coverage-map logic from `getDominantSource`
  - Returns a human-readable string like `"100% typed"` or `"60% typed, 40% external"`
  - Uses the display tags: typed→`[t]`, chat_ai→`[cc]`, ai_editor→`[ai]`, external→`[ce]`, chat_user→`[t]`
  - Merges `chat_user` into `typed` for display purposes
  - Sorts by percentage descending, omits 0% entries

**File 2: `src/components/TextSelectionWindow.tsx`**

- Accept a `selectionFrom` and `selectionTo` prop (TipTap positions) from the parent
- Before calling `editor-action` or `context-prompt`, compute the source breakdown: `provenanceTracker.getSourceBreakdown(selectionFrom, selectionTo)`
- Pass `selected_text_source` in the request body to both edge functions

**File 3: `src/components/WritingEditor.tsx`**

- Pass the current selection `from`/`to` positions to `TextSelectionWindow` as props

**File 4: `supabase/functions/editor-action/index.ts`**

- Read `selected_text_source` from the request body
- Include it in the `ai_editor_actions` insert as `instruction_text` field (append to existing instruction_text if present, e.g., `"translate:French | Source: 60% [t], 40% [ce]"`) — avoids needing a new DB column

**File 5: `supabase/functions/context-prompt/index.ts`**

- Read `selected_text_source` from the request body
- For Ask: append to the chat message: `[Ask] Selected: "text preview". Source: 85% [t], 15% [ce]. Question: ...`
- For Propose: same pattern: `[Propose] Selected: "text preview". Source: 100% [ce]. Instruction: ...`

**File 6: `supabase/functions/analysis/index.ts`**

- In `buildEditorStatsString`, update the "Original (user-written)" label to be dynamic:
  - Parse source info from `instruction_text` if present (after `| Source:`)
  - Display as `Original (source: 85% [t], 15% [ce]):` instead of always `Original (user-written):`
  - If no source info, fall back to `Original (source unknown):`

### No DB migration needed

The source breakdown string is stored in the existing `instruction_text` column (appended with a `| Source:` separator) for editor actions, and inline in the chat message content for Ask/Propose. No new columns required.

### Result

The FLOW LLM will see source attribution for the selected text in both the action log and chat history, preventing it from incorrectly assuming external/AI text was user-authored.

