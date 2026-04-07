

## Revised Plan: Creative Tools AI + FLOW Integration (Prompt 3 of 3)

### Summary

Wire creative writing tools into the AI text selection system (Ask only), the writing summary mechanism, and the FLOW analysis prompt. Creative template projects get a dedicated FLOW prompt with creative-specific pillar definitions. No truncation of creative data. A lightweight `CreativeAIContext` avoids deep prop threading.

---

### Feedback Incorporated

1. **Ask only** — no Sanity Check. `CREATIVE_ACTIONS` = `[{ id: "ask", label: "Ask", row: 2 }]`.
2. **CreativeAIContext** — new context provided at `ProjectContentArea` level, consumed by `CreativeAITextField`. Holds `projectId`, `threadId`, `tutorMode`, `conciseMode`, `webSearchEnabled`, `chatSetMessages`, `onChatRefresh`, `onAskComplete`. Creative tool components pass zero AI-related props.
3. **HTML stripping** — use Deno's DOMParser (`new DOMParser().parseFromString(html, "text/html").body.textContent`) in edge functions. This handles tag removal and entity decoding in one step.
4. **No truncation** — all creative data is included in full. No truncation logic, no `creative_data_truncated` flag.
5. **Character name Map** — build `Map<id, name>` once, O(1) lookups per event.
6. **flow_meta naming** — use `template: "creative"` (mirrors the project field).

---

### Part 1: CreativeAIContext + CreativeAITextField

**New file: `src/contexts/CreativeAIContext.tsx`**
- Context with: `projectId`, `threadId`, `tutorMode`, `conciseMode`, `webSearchEnabled`, `chatSetMessages` (ref-based), `onChatRefresh`, `onAskComplete`
- Provider wraps creative tool tabs in `ProjectContentArea`

**New file: `src/components/CreativeAITextField.tsx`**
- Props: `sourceModule: 'worldbuilding' | 'character_chart' | 'timeline'`, `children`
- Wraps children in a positioned container
- Listens to `selectionchange`, shows floating "Interact with AI" button when text selected within its children
- On click, opens `TextSelectionWindow` with `sourceModule` prop, consuming all other props from `CreativeAIContext`
- No provenance tracker, no `selectionFrom`/`selectionTo`

**`src/components/TextSelectionWindow.tsx` changes:**
- Add optional prop `sourceModule?: string` (default `'editor'`)
- New constant: `CREATIVE_ACTIONS = [{ id: "ask", label: "Ask", row: 2 }]`
- When `sourceModule !== 'editor'`, render `CREATIVE_ACTIONS` instead of `NORMAL_ACTIONS`/tutor actions
- Skip provenance tracker usage when `sourceModule !== 'editor'`
- `onAccept` becomes a no-op (Ask doesn't use it; Propose not available)
- Pass `source_module` from prop into `context-prompt` call body

**Creative tool component changes** (WorldBuildingNotes, CharactersDiagram, TimelineView):
- Wrap AI-eligible fields (note TipTap content, character description textarea, relationship notes, event description) in `<CreativeAITextField sourceModule="...">` 
- No new props needed — context handles everything

**`src/components/ProjectContentArea.tsx`:**
- Import and render `CreativeAIContextProvider` wrapping the creative tool tab area
- Pass required values to the provider

---

### Part 2: Writing Summary — Include Creative Data

**`supabase/functions/context-prompt/index.ts`:**

1. Add `template` to the project select: `"id, tutor_mode, language, template"`
2. When `template === 'creative'`, fetch creative data after writing content:
   ```typescript
   const { data: creativeRows } = await supabase
     .from("project_creative_data")
     .select("tool_type, data")
     .eq("project_id", project_id);
   ```
3. Format creative data into sections using a `formatCreativeForSummary()` helper:
   - World-building: categories with notes (title + plain text content via DOMParser)
   - Characters: name, description, traits, relationships (resolved to names)
   - Timeline: events in order with dates, titles, descriptions, character names
4. Update `buildSummaryPrompt` to accept optional `creativeDataSection: string` parameter
5. Insert `=== CREATIVE WRITING TOOLS (if applicable) ===` section between writing content and existing summary in the prompt
6. For non-creative projects, pass empty string (section omitted)

---

### Part 3: FLOW Analysis — Creative FLOW Prompt

**`supabase/functions/analysis/index.ts`:**

1. Add `template` to project select: `"id, language, tutor_mode, name, template"`
2. Add `CREATIVE_FLOW_PROMPT_TEMPLATE` as a new constant (from attached Ethos_Creative_Prompts.docx) — uses creative-specific pillar definitions referencing world-building, characters, timeline
3. When `template === 'creative'`, add to the `Promise.all` fetch block:
   ```typescript
   supabase.from("project_creative_data")
     .select("tool_type, data").eq("project_id", projectId)
   ```
4. New helper functions:
   - `stripHtmlDeno(html: string): string` — uses `new DOMParser().parseFromString(html, "text/html").body.textContent` for proper entity decoding
   - `formatWorldBuildingForPrompt(data)` — categories with notes as plain text
   - `formatCharactersForPrompt(data)` — characters with traits, descriptions, relationships (name-resolved via Map)
   - `formatTimelineForPrompt(data, characterNameMap: Map<string, string>)` — events with character name resolution using pre-built Map
5. Build `=== CREATIVE TOOLS CONTENT ===` section with three subsections (World-Building, Characters, Timeline) — **no truncation**
6. Insert between Writing Content and Chat History in the user prompt
7. Use `CREATIVE_FLOW_PROMPT_TEMPLATE` instead of `FLOW_PROMPT_TEMPLATE` when `template === 'creative'`
8. Add to `flowMeta`: `template: "creative"` (only for creative projects)

---

### Files Changed

| File | Change |
|------|--------|
| `src/contexts/CreativeAIContext.tsx` | New — context for AI props in creative tools |
| `src/components/CreativeAITextField.tsx` | New — selection detection wrapper, consumes context |
| `src/components/TextSelectionWindow.tsx` | Add `sourceModule` prop; `CREATIVE_ACTIONS` (Ask only); skip provenance for creative |
| `src/components/creative-tools/WorldBuildingNotes.tsx` | Wrap note editors in `CreativeAITextField` |
| `src/components/creative-tools/CharactersDiagram.tsx` | Wrap description/relationship fields in `CreativeAITextField` |
| `src/components/creative-tools/TimelineView.tsx` | Wrap event description in `CreativeAITextField` |
| `src/components/ProjectContentArea.tsx` | Add `CreativeAIContextProvider` wrapping creative tabs |
| `supabase/functions/context-prompt/index.ts` | Fetch creative data; update `buildSummaryPrompt` with creative sections |
| `supabase/functions/analysis/index.ts` | Add Creative FLOW prompt; fetch/format creative data; `flowMeta.template` |

### No new dependencies needed

