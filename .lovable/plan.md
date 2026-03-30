

## Fix: Chat copies tagged as [ce] instead of [cc]

### Root Cause

The `handleCopy` listener in `ChatPanel.tsx` captures the copied text via `sel.toString()`, but the paste handler in `WritingEditor.tsx` reads from `clipboardData.getData("text/plain")`. Browsers serialize rich HTML (from ReactMarkdown rendering) differently for these two APIs — list items, paragraphs, and code blocks produce different whitespace patterns. Even after normalization (`\s+ → single space`), the strings can differ, so `checkChatClipboardRole` fails the exact match and the paste falls through to `[ce]`.

### Fix

Change the `handleCopy` handler in `ChatPanel.tsx` to accept the `ClipboardEvent` and read the text from `event.clipboardData.getData("text/plain")` instead of `sel.toString()`. This ensures the stored text exactly matches what will later arrive through the paste event's `clipboardData`.

### Changes

**`src/components/ChatPanel.tsx`** (lines 166-185):
- Change `handleCopy` signature from `() =>` to `(event: ClipboardEvent) =>`
- Replace `sel.toString()` with `event.clipboardData?.getData("text/plain") ?? ""`
- Keep the rest of the logic (DOM walk for `data-chat-role`, role detection) unchanged

```typescript
const handleCopy = (event: ClipboardEvent) => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const anchor = sel.anchorNode;
  if (!anchor) return;

  let el: HTMLElement | null = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
  while (el && el !== container) {
    if (el.dataset?.chatRole) {
      const role = el.dataset.chatRole as "user" | "assistant";
      const copiedText = event.clipboardData?.getData("text/plain") ?? sel.toString();
      provenanceTracker.setChatClipboard(copiedText, role);
      return;
    }
    el = el.parentElement;
  }
};
```

Single-file, ~2-line change. No other files affected.

