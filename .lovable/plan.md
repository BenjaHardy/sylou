## Goal

Change the default behavior of `PUBLIC_SITE_URL` in `src/lib/site.ts` so that, when `VITE_PUBLIC_SITE_URL` is not set, it falls back to `window.location.origin` instead of the hardcoded `"https://sylou.eu"`.

## Why

The current default points to the maintainer's domain. A self-hoster who forgets to set `VITE_PUBLIC_SITE_URL` generates shared FLOW report links that redirect to the maintainer's instance rather than their own. Using `window.location.origin` as the runtime default eliminates this footgun.

## Changes

### `src/lib/site.ts`

Replace the current export:

```ts
export const PUBLIC_SITE_URL =
  (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.replace(/\/$/, "") ||
  "https://sylou.eu";
```

With:

```ts
export const PUBLIC_SITE_URL =
  (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.replace(/\/$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");
```

## Behavior

- `VITE_PUBLIC_SITE_URL` set and non-empty → use the env var (preserves reverse-proxy and custom-domain overrides).
- `VITE_PUBLIC_SITE_URL` not set, running in browser → use `window.location.origin`.
- `VITE_PUBLIC_SITE_URL` not set, running in non-browser context (SSR, tests) → empty string (no crash, no misleading fallback).

## Out of scope

- No changes to `FlowReportView.tsx` or any other caller — the default change is sufficient.
- `VITE_PUBLIC_SITE_URL` remains a valid override; no env var is removed.
