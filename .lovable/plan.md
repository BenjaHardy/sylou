

## Plan: Fix HTML Rendering in Cards + FLOW Prompt Stripping

### Why

MiniTipTapEditor now saves HTML for character descriptions, relationship notes, and event descriptions. Two downstream consumers still treat these as plain text.

### Changes

**1. Character cards & event cards — strip HTML for display**

For compact card displays, strip to plain text (not `dangerouslySetInnerHTML`) since these are truncated single-line previews.

Add a small `stripHtml` utility (reuse or add to `creative-tools-utils.ts`):
```ts
export function stripHtml(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}
```

- **`CharactersDiagram.tsx` line 124**: Change `{character.description}` to `{stripHtml(character.description)}`
- **`TimelineView.tsx` line 133**: Change `{event.description}` to `{stripHtml(event.description)}`

**2. FLOW analysis prompt — apply `stripHtmlDeno` to character/timeline fields**

In `supabase/functions/analysis/index.ts`:
- Line 475: `c.description` → `stripHtmlDeno(c.description)`
- Line 486: `r.notes` → `stripHtmlDeno(r.notes)`
- Line 503: `e.description` → `stripHtmlDeno(e.description)`

### Files Changed

| File | Change |
|------|--------|
| `src/lib/creative-tools-utils.ts` | Add `stripHtml` helper |
| `src/components/creative-tools/CharactersDiagram.tsx` | Strip HTML on card description display |
| `src/components/creative-tools/TimelineView.tsx` | Strip HTML on event card description display |
| `supabase/functions/analysis/index.ts` | Apply `stripHtmlDeno` to character descriptions, relationship notes, event descriptions |

