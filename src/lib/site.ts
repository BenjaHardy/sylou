// Canonical public base URL for user-facing share links.
// Always points to the production domain so links work for non-logged-in viewers,
// regardless of whether the app is opened via the Lovable preview/editor.
export const PUBLIC_SITE_URL =
  (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.replace(/\/$/, "") ||
  "https://sylou.eu";
