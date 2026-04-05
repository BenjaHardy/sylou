

## Fix: Dropdown Menu Visible in Print

The Radix `DropdownMenuContent` renders in a portal outside the component tree, so `print:hidden` on the parent doesn't hide it.

### Change

**`src/index.css`** — Add to the `@media print` block:

```css
[data-radix-popper-content-wrapper] {
  display: none !important;
}
```

This catches all Radix popover/dropdown portals (already listed in the CSS but may have been removed in the recent refactor). Single line, covers all dropdown/popover menus during print.

### Files Changed

| File | Change |
|------|--------|
| `src/index.css` | Add `[data-radix-popper-content-wrapper]` hide rule in `@media print` |

