

## Render Chat Messages as Rich Markdown

### Problem
Assistant messages display as plain text — markdown formatting (paragraphs, bold, lists, headings, etc.) is ignored because the content is rendered inside a simple `<p>` tag with `whitespace-pre-wrap`.

### Solution
Use `react-markdown` to render assistant message content as formatted HTML, while keeping user messages as plain text.

### Steps

1. **Install `react-markdown`** — lightweight markdown renderer for React.

2. **Update `ChatBubble` in `src/components/ChatPanel.tsx`**:
   - For assistant messages: replace the `<p className="whitespace-pre-wrap break-words">{message.content}</p>` with a `<ReactMarkdown>` component.
   - For user messages: keep the current plain text rendering.
   - Add a `prose` wrapper class (from Tailwind typography plugin or manual styles) so rendered markdown looks clean — proper paragraph spacing, list styling, inline code, etc.
   - Add scoped CSS or Tailwind classes to keep font size consistent (`text-sm`) and avoid oversized headings inside chat bubbles.

3. **Add minimal markdown styles** — ensure paragraphs have spacing (`mb-2 last:mb-0`), lists are indented, code blocks have background, and links are styled. This can be done via the `components` prop of `react-markdown` to map elements to styled versions.

### What stays the same
- User messages remain plain text
- Writing summary bubbles unchanged
- No backend changes

