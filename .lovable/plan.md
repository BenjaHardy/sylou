## Goal
Show the Sylou dog logo as the browser-tab favicon on sylou.eu.

## Plan
1. Copy `src/assets/sylou-shiba.png` to `public/favicon.png` so it's served at the site root.
2. Delete `public/favicon.ico` (browsers auto-request `/favicon.ico` and it would otherwise override the new PNG).
3. Update `index.html` `<link rel="icon">` to point at `/favicon.png` with `type="image/png"`.

## Notes
- The PNG is square and already used as the in-app logo, so it should render cleanly at favicon sizes. If it looks fuzzy at 16/32px we can generate a multi-size `.ico` in a follow-up.
- No code logic changes; pure static asset + one tag in `index.html`.
- Republish required for sylou.eu to pick up the new favicon (and users may need a hard refresh due to browser favicon caching).