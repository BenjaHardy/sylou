## Changes

**1. `.gitignore`** — append at end of file:

```
# This project uses npm. Do not commit Bun lockfiles.
bun.lockb
bun.lock
```

**2. `package.json` sanity check** — confirmed: `"remark-gfm": "^4.0.1"` is present in `dependencies`. No change needed.

## Out of scope
- Not deleting committed `bun.lockb` / `bun.lock` from the repo (gitignore only prevents future commits; removing tracked copies is a separate `git rm` step you'll do at open-source time).
- Not deleting `package-lock.json`.
- No source file changes.