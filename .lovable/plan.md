

## Color Token Alignment

The left sidebar pane uses `--sidebar-background: 27 18% 92%` which renders as approximately `#EDE8E3` — slightly warmer and more saturated than the target `#EEEBE7`.

The toolbar and chat panel already use `--ethos-surface: 34 12% 92%` which matches `#EEEBE7`.

### Fix

Update `--sidebar-background` in `src/index.css` from `27 18% 92%` to `34 12% 92%` so it matches `--ethos-surface` exactly. This single change aligns all three areas (sidebar, editor toolbar/status bar, chat panel) to the same `#EEEBE7` color.

