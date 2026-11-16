// Accounts, through the sign-in service's admin API on the internal network.
//
// Sign-ups are closed on a Sylou Local install, so an account is made here.
// No password is ever typed in a terminal or kept in its history (D8): the
// commands print a one-time link, and the password is typed in the browser,
// on the app's own page, which asks for at least 15 characters — the same
// minimum the sign-in service enforces.

/** Inside Docker; the admin API is never reachable through the front door. */
const AUTH_URL = "http://auth:9999";

/** Where the link should land: the app's own page for setting a password. */
export function setPasswordUrl(publicUrl = Deno.env.get("SYLOU_PUBLIC_URL") ?? "http://localhost:8080"): string {
  return `${publicUrl.replace(/\/+$/, "")}/auth/set-password`;
}

function serviceKey(): string {
  return Deno.readTextFileSync("/run/secrets/service_role_key").trim();
}

export function adminRequest(path: string, key: string, body: unknown): Request {
  return new Request(`${AUTH_URL}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      apikey: key,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** The one-time link out of a generate_link answer, whatever it is called. */
export function linkFrom(answer: unknown): string | undefined {
  if (typeof answer !== "object" || answer === null) return undefined;
  const record = answer as Record<string, unknown>;
  for (const key of ["action_link", "actionLink"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

type Fetcher = (request: Request) => Promise<Response>;

async function call(request: Request, fetcher: Fetcher): Promise<{ status: number; body: unknown }> {
  const response = await fetcher(request);
  let body: unknown = undefined;
  try {
    body = await response.json();
  } catch {
    // An empty or unreadable answer is reported by its status alone.
  }
  return { status: response.status, body };
}

/** The sign-in service's own word for an address that already has an account.
 *  It answers 422 for other refusals too - an address it cannot use, say -
 *  and those must not be taken for an account that exists. */
function alreadyRegistered(body: unknown): boolean {
  // `error_code` in the answer these requests get; `code` in the one GoTrue
  // gives when asked for its 2024-01-01 API.
  const { error_code, code } = (body ?? {}) as { error_code?: unknown; code?: unknown };
  return [error_code, code].some((value) => value === "email_exists" || value === "user_already_exists");
}

/** The sign-in service's own explanation, when it gives one. */
function reasonOf(body: unknown): string {
  const { msg, message } = (body ?? {}) as { msg?: unknown; message?: unknown };
  const text = typeof msg === "string" ? msg : typeof message === "string" ? message : "";
  return text ? `: ${text}` : "";
}

export interface UserOptions {
  fetcher?: Fetcher;
  key?: string;
}

/** Makes the account, then prints a link for setting its password. */
export async function addUser(email: string, options: UserOptions = {}): Promise<number> {
  if (!looksLikeEmail(email)) {
    console.error("add-user: give the email address for the new account, for example\n  sylou add-user you@example.com");
    return 2;
  }
  const fetcher = options.fetcher ?? ((request) => fetch(request));
  const key = options.key ?? serviceKey();

  const created = await call(
    adminRequest("/admin/users", key, { email, email_confirm: true }),
    fetcher,
  );
  if (created.status === 422 && alreadyRegistered(created.body)) {
    console.log(`add-user: ${email} already has an account; sending it a link to set a new password.`);
  } else if (created.status >= 300) {
    console.error(`add-user: the sign-in service refused (${created.status}${reasonOf(created.body)}).`);
    return 1;
  }

  return await printLink("add-user", email, key, fetcher);
}

/** A link for an account that exists: the way back in without an email. */
export async function resetPassword(email: string, options: UserOptions = {}): Promise<number> {
  if (!looksLikeEmail(email)) {
    console.error("reset-password: give the account's email address, for example\n  sylou reset-password you@example.com");
    return 2;
  }
  const fetcher = options.fetcher ?? ((request) => fetch(request));
  const key = options.key ?? serviceKey();
  return await printLink("reset-password", email, key, fetcher);
}

async function printLink(command: string, email: string, key: string, fetcher: Fetcher): Promise<number> {
  const generated = await call(
    adminRequest("/admin/generate_link", key, {
      type: "recovery",
      email,
      redirect_to: setPasswordUrl(),
    }),
    fetcher,
  );
  const link = linkFrom(generated.body);
  if (generated.status >= 300 || !link) {
    console.error(`${command}: the sign-in service made no link (${generated.status}).`);
    return 1;
  }
  console.log(`\n${command}: open this once, in your browser, to set the password for ${email}:\n`);
  console.log(`  ${link}\n`);
  console.log("It works once and expires in an hour. The password needs at least 15 characters.");
  return 0;
}
