// The two email-link flows that land on /auth/set-password: invitations and
// password resets. Both arrive as a Supabase email-template link carrying a
// one-time token hash plus its type; the page verifies the token
// (supabase.auth.verifyOtp) and then lets the user choose a password.
//
// Registration stays closed: sign-ups are disabled at the Supabase level and
// the app never calls signUp. These flows only ever act on accounts the
// operator created (dashboard "Create new user" or "Invite user"), and a
// password-reset request for an unknown address sends nothing — Supabase
// answers the same way either way, so the form cannot probe for accounts.
// Operator setup (Site URL, redirect allow-list, email templates, SMTP):
// docs/setup.md, "Managing users".

export type SetPasswordLinkType = "invite" | "recovery";

export interface SetPasswordLink {
  tokenHash: string;
  type: SetPasswordLinkType;
}

const LINK_TYPES: ReadonlySet<string> = new Set(["invite", "recovery"]);

/** Parse `?token_hash=…&type=invite|recovery` from a location search string. */
export function parseSetPasswordLink(search: string): SetPasswordLink | null {
  const params = new URLSearchParams(search);
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (!tokenHash || !type || !LINK_TYPES.has(type)) return null;
  return { tokenHash, type: type as SetPasswordLinkType };
}

/** Where password-reset emails send the user — must be listed under the
 *  project's Redirect URLs (docs/setup.md). */
export function setPasswordRedirectUrl(origin: string): string {
  return `${origin}/auth/set-password`;
}

/** Floor for passwords chosen through the set-password page. Supabase's own
 *  minimum (Authentication → Providers → Email) applies on top of it. */
export const MIN_PASSWORD_LENGTH = 8;
