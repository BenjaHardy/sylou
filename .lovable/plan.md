

## Fix: Highlighted Text Layout, Color Offset & Tag Cleanup

### Problems
1. **Color offset**: Provenance positions use TipTap's ProseMirror counting (block boundaries add +1 each for open/close). The current code strips HTML to plain text via `textContent`, losing those structural offsets, so segment colors drift by a few characters per paragraph.
2. **Lost layout**: Stripping to plain text removes all paragraph breaks and formatting.
3. **Visible segment tags**: The `[t]`, `[cc]`, `[ce]`, `[ai]` markers appear in the legend and tooltips — redundant given the color coding.

### Solution

**Single file change: `src/components/FlowHighlightedText.tsx`**

**A) HTML-aware rendering with TipTap position tracking**
- Replace `plainText = div.textContent` with a recursive DOM walker that parses the `writingContent` HTML
- The walker tracks a position counter matching TipTap's model: +1 when entering a block node, +1 when leaving (so `<p>Hello</p><p>World</p>` counts as positions 0→enter(1)→H(2)e(3)l(4)l(5)o(6)→leave(7)→enter(8)→W(9)...)
- For each text node, split it at segment boundaries and wrap each piece in a colored `<span>` (reusing existing `SegmentSpan` tooltip logic)
- Preserve block elements (`<p>`, `<h1>`, etc.) as React elements so paragraphs render naturally
- Total text length for percentage stats recalculated using the same position-aware counting

**B) Remove segment identifier tags**
- Legend items: `"Typed [t]"` → `"Typed"`, `"AI Chat [cc]"` → `"AI Chat"`, etc.
- Tooltip: remove `{style.tag}` from the write-mode tooltip content

### What stays the same
- Mode toggle (Write / Clipboard), stats bar, close button, all color mappings, tooltip percentage display

