# Fix tables in the chat pane

## Root cause

`src/components/ChatPanel.tsx` renders assistant messages with `ReactMarkdown` using only the default CommonMark parser. CommonMark does not define table syntax, so when the LLM returns a GitHub-flavored pipe table like:

```
| Col A | Col B |
| ----- | ----- |
| 1     | 2     |
```

react-markdown parses the whole thing as one paragraph of literal `|` and `-` characters — exactly the "single blurb of text" symptom. No `<table>` ever reaches the DOM.

The same component already maps custom renderers for `p`, `ul`, `ol`, `code`, etc., but has no `table`/`thead`/`tbody`/`tr`/`th`/`td` mappings either, so even if a table node existed it would render unstyled.

`MiniTipTapEditor` and other surfaces are unrelated — this is purely the chat bubble renderer.

## Change

Scope: frontend-only, single component file plus one dependency.

1. Add `remark-gfm` so react-markdown parses GFM features (tables, strikethrough, task lists, autolinks).
   - Install with **Bun** (`bun add remark-gfm`) — the Lovable build pipeline uses Bun and `bun.lockb` is the canonical lockfile in this repo. This will update `package.json` and `bun.lockb` together.
   - Import in `ChatPanel.tsx`: `import remarkGfm from "remark-gfm";`
   - Pass `remarkPlugins={[remarkGfm]}` to the `<ReactMarkdown>` instance in `ChatBubble`.

2. Add table component mappings to the existing `components={{ ... }}` map in `ChatBubble`, themed with semantic tokens only and made horizontally scrollable so wide tables don't break the bubble's `max-w-[80%]` constraint. Inline `<table>` with Tailwind classes (no shadcn `Table` import — keeps the streamed-markdown renderer self-contained):
   - `table`: wrap in `<div className="overflow-x-auto my-2">` and render `<table className="w-full text-xs border-collapse">`.
   - `thead`: `<thead className="border-b border-border">`.
   - `tbody`: `<tbody>`.
   - `tr`: `<tr className="border-b border-border/50 last:border-0">`.
   - `th`: `<th className="text-left font-semibold px-2 py-1.5 align-top">`.
   - `td`: `<td className="px-2 py-1.5 align-top">`.

3. Leave the `prose-chat` wrapper and all other component mappings untouched. User messages stay as plain `<p>` with `whitespace-pre-wrap` (not markdown-parsed).

## Out of scope (flagged, not fixed here)

- **Dual lockfiles.** The repo currently commits both `bun.lockb` (+ `bun.lock`) and `package-lock.json`. Before open-sourcing, you'll want to pick one and delete the other so contributors get reproducible installs from a single source of truth. Not part of this fix — but worth a separate cleanup pass.
- No edge function changes — the LLM already produces valid GFM tables; only the renderer was wrong.
- No changes to other markdown surfaces (FLOW report, creative tools, editor). The same `remark-gfm` fix can be applied there later if needed.

## Verification

- Ask Sylou: "reply with a small markdown table of 3 rows comparing X and Y" — confirm the bubble renders an actual `<table>` with borders, not a wall of `|` characters.
- Confirm a wide table scrolls horizontally inside the bubble instead of overflowing the chat pane.
- Confirm non-table assistant messages (lists, code, bold, links) still render identically.
- Confirm `package.json` and `bun.lockb` are both updated together by the `bun add` step.
