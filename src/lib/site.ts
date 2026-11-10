// Canonical public base URL for user-facing share links.
// Prefer VITE_PUBLIC_SITE_URL when set (useful when the public origin differs
// from the deployed origin, e.g. reverse proxies). Otherwise fall back to the
// current browser origin so self-hosted instances generate share links that
// point to their own domain rather than the upstream maintainer's.
export const PUBLIC_SITE_URL =
  (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.replace(/\/$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");

/** Whether a host name is this computer's own address (localhost, a
 *  *.localhost name, 127.x.x.x or [::1]): a link to it opens only on the
 *  computer it was made on. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(host) ||
    host === "[::1]" || host === "::1";
}

/** Whether a URL points at this computer (see isLoopbackHost); false when it
 *  does not parse. */
export function isLoopbackUrl(url: string): boolean {
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}
