## Problem

In `src/components/FlowReportView.tsx` (line 204), the share URL is built as:

```ts
const shareUrl = shareToken ? `${window.location.origin}/report/${shareToken}` : "";
```

`window.location.origin` returns whatever host the user is currently browsing — so when you open the app through the Lovable preview/editor URL, the generated share link points to `id-preview--…lovable.app/report/<token>`, which requires a Lovable login. The share token itself is fine; only the base URL is wrong.

Note: existing reports already saved in the database don't store the URL — the link is reconstructed every time. So this is a pure frontend fix, no migration or data backfill needed. Old reports will automatically use the new link as soon as the change is published.

## Fix

Introduce a canonical public base URL and use it instead of `window.location.origin` when building share links.

1. Add a constant `PUBLIC_SITE_URL = "https://sylou.eu"` (single source of truth, e.g. in `src/lib/utils.ts` or a new `src/lib/site.ts`).
2. In `FlowReportView.tsx`, replace the `shareUrl` line with:
   ```ts
   const shareUrl = shareToken ? `${PUBLIC_SITE_URL}/report/${shareToken}` : "";
   ```
3. Grep for any other `window.location.origin` usages tied to share/report/certificate links and migrate them the same way (quick check; likely only this one).

Optional hardening (recommended but small): also read from an env override `VITE_PUBLIC_SITE_URL` so non-production environments can override it, falling back to `https://sylou.eu`.

## Verification

- Open the HEC project's FLOW report from the Lovable preview, click Share → copy link → confirm it now starts with `https://sylou.eu/report/…`.
- Open that link in a private window (not logged into Lovable) → the shared report loads via the public `flow_reports_public` view.
- Existing already-shared reports work without any DB change since the link is rebuilt on each render.
