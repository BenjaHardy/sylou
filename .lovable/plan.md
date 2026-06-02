## Move chat bookmark bars/icons inward from the right edge

The bookmark colored bar and the hover bookmark icon on chat messages are anchored at `right-0`, which puts them flush against the panel's right edge — overlapping the resizable panel's drag handle and making them hard to click.

### Change

In `src/components/ChatPanel.tsx`, shift both the bookmark bar and the hover bookmark icon ~8px inward (from `right-0` to `right-2`). This applies in both spots where they're rendered:

- The `writing_summary` bubble branch (≈ lines 104–121)
- The standard chat bubble branch (≈ lines 229–246)

Specifically:
- Hover `BookmarkIcon` button: `right-0` → `right-2`
- Bookmark colored bar: `right-0` → `right-2`, and drop `rounded-r` in favor of `rounded` so the now-detached bar looks intentional on both sides.

No logic, hook, or styling-token changes — pure positioning tweak in the presentation layer.

### Verification

- Hover a non-bookmarked message: icon sits clear of the resize handle and is clickable.
- Bookmarked message: colored bar sits slightly inset, fully clickable, opens the popover.
- Resize the chat panel: bookmark elements stay clear of the drag handle at all widths.
