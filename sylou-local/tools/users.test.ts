// Making an account and getting back in: that the admin API is asked on the
// inside, that a password is never typed in a terminal, and that a failure
// says so instead of printing a half-made link.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { addUser, adminRequest, linkFrom, looksLikeEmail, resetPassword } from "./users.ts";

const KEY = "test-service-role-key";
const LINK = "http://localhost:8080/auth/v1/verify?token=abc&type=recovery";

/** Answers the admin API would give, recording what was asked. */
function fakeAuth(answers: Record<string, { status: number; body?: unknown }>) {
  const asked: { path: string; body: unknown; authorization: string | null }[] = [];
  const fetcher = async (request: Request) => {
    const path = new URL(request.url).pathname;
    asked.push({
      path,
      body: JSON.parse(await request.clone().text()),
      authorization: request.headers.get("authorization"),
    });
    const answer = answers[path] ?? { status: 404 };
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
  };
  return { asked, fetcher };
}

function quiet<T>(run: () => Promise<T>): Promise<T> {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  return run().finally(() => {
    console.log = log;
    console.error = error;
  });
}

Deno.test("the admin API is asked inside Docker, with the service key", () => {
  const request = adminRequest("/admin/users", KEY, { email: "you@example.com" });
  assertEquals(new URL(request.url).host, "auth:9999");
  assertEquals(request.headers.get("authorization"), `Bearer ${KEY}`);
  assertEquals(request.headers.get("apikey"), KEY);
  assertEquals(request.method, "POST");
});

Deno.test("a link is found whatever the service calls it", () => {
  assertEquals(linkFrom({ action_link: LINK }), LINK);
  assertEquals(linkFrom({ actionLink: LINK }), LINK);
  assertEquals(linkFrom({}), undefined);
  assertEquals(linkFrom(null), undefined);
  assertEquals(linkFrom("nope"), undefined);
});

Deno.test("an address that is not one is refused before anything is asked", async () => {
  const { asked, fetcher } = fakeAuth({});
  assertEquals(await quiet(() => addUser("not-an-address", { fetcher, key: KEY })), 2);
  assertEquals(await quiet(() => resetPassword("", { fetcher, key: KEY })), 2);
  assertEquals(asked.length, 0);
  assert(looksLikeEmail("you@example.com"));
  assert(!looksLikeEmail("you@example"));
});

Deno.test("adding an account makes it, then prints one link and no password", async () => {
  const { asked, fetcher } = fakeAuth({
    "/admin/users": { status: 200, body: { id: "1" } },
    "/admin/generate_link": { status: 200, body: { action_link: LINK } },
  });
  const printed: string[] = [];
  const log = console.log;
  console.log = (...parts: unknown[]) => printed.push(parts.join(" "));
  try {
    assertEquals(await addUser("you@example.com", { fetcher, key: KEY }), 0);
  } finally {
    console.log = log;
  }
  assertEquals(asked.map((call) => call.path), ["/admin/users", "/admin/generate_link"]);
  assertEquals((asked[0].body as Record<string, unknown>).email_confirm, true);
  assertEquals((asked[1].body as Record<string, unknown>).type, "recovery");
  // The link lands on the page that asks for the new password, not on the
  // front page already signed in.
  assertEquals((asked[1].body as Record<string, unknown>).redirect_to, "http://localhost:8080/auth/set-password");
  const output = printed.join("\n");
  assert(output.includes(LINK));
  assert(output.includes("15 characters"));
  assert(!/password\s*[:=]\s*\S+/i.test(output), "a password was printed");
});

Deno.test("an account that already exists gets a link rather than an error", async () => {
  const { asked, fetcher } = fakeAuth({
    "/admin/users": {
      status: 422,
      body: { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" },
    },
    "/admin/generate_link": { status: 200, body: { action_link: LINK } },
  });
  assertEquals(await quiet(() => addUser("you@example.com", { fetcher, key: KEY })), 0);
  assertEquals(asked.length, 2);
});

Deno.test("a 422 for any other reason is a refusal, not an account that exists", async () => {
  const { asked, fetcher } = fakeAuth({
    "/admin/users": {
      status: 422,
      body: { code: 422, error_code: "validation_failed", msg: "Unable to validate email address: invalid format" },
    },
    "/admin/generate_link": { status: 200, body: { action_link: LINK } },
  });
  assertEquals(await quiet(() => addUser("you@example.com", { fetcher, key: KEY })), 1);
  // No link is made for an account that was never created.
  assertEquals(asked.length, 1);
});

Deno.test("a refusal from the sign-in service is reported, not papered over", async () => {
  const refused = fakeAuth({ "/admin/users": { status: 500 } });
  assertEquals(await quiet(() => addUser("you@example.com", { fetcher: refused.fetcher, key: KEY })), 1);

  const noLink = fakeAuth({
    "/admin/users": { status: 200 },
    "/admin/generate_link": { status: 200, body: {} },
  });
  assertEquals(await quiet(() => addUser("you@example.com", { fetcher: noLink.fetcher, key: KEY })), 1);
});

Deno.test("resetting a password asks for a link and nothing else", async () => {
  const { asked, fetcher } = fakeAuth({
    "/admin/generate_link": { status: 200, body: { action_link: LINK } },
  });
  assertEquals(await quiet(() => resetPassword("you@example.com", { fetcher, key: KEY })), 0);
  assertEquals(asked.map((call) => call.path), ["/admin/generate_link"]);
});
