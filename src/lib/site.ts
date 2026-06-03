// Canonical public base URL for user-facing share links.
// Prefer VITE_PUBLIC_SITE_URL when set (useful when the public origin differs
// from the deployed origin, e.g. reverse proxies). Otherwise fall back to the
// current browser origin so self-hosted instances generate share links that
// point to their own domain rather than the upstream maintainer's.
export const PUBLIC_SITE_URL =
  (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.replace(/\/$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");
