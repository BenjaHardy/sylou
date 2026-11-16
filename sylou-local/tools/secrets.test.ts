// This install's secrets: that they are random, long enough, signed with the
// install's own secret, never printed, and never written over an install that
// already has them.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { makeSecrets, newSecrets, PROVIDER_KEY_FILES, randomSecret, signKey } from "./secrets.ts";

Deno.test("a secret is as long as asked, and never the same twice", () => {
  assertEquals(randomSecret(32).length, 32);
  assertEquals(randomSecret(64).length, 64);
  const seen = new Set(Array.from({ length: 50 }, () => randomSecret(32)));
  assertEquals(seen.size, 50);
  // Nothing that needs quoting in a connection string or a shell.
  assert(/^[A-Za-z0-9_-]+$/.test(randomSecret(64)));
});

Deno.test("an install gets its own password for every role", async () => {
  const secrets = await newSecrets();
  const passwords = [
    secrets.pg_supabase_admin_password,
    secrets.pg_postgres_password,
    secrets.pg_authenticator_password,
    secrets.pg_auth_admin_password,
    secrets.pg_storage_admin_password,
  ];
  assertEquals(new Set(passwords).size, 5, "two roles share a password");
  for (const password of passwords) assertEquals(password.length, 32);
  assertEquals(secrets.jwt_secret.length, 64);
});

Deno.test("the two API keys are signed with this install's own secret", async () => {
  const secrets = await newSecrets();
  for (const [name, role] of [["anon_key", "anon"], ["service_role_key", "service_role"]] as const) {
    const [header, payload, signature] = secrets[name].split(".");
    assert(header && payload && signature, `${name} is not a signed key`);
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    assertEquals(claims.role, role);
    assertEquals(claims.iss, "supabase");
    assert(claims.exp > claims.iat);

    // The signature really is this install's: the same secret makes it again.
    const again = await signKey(role, secrets.jwt_secret, claims.iat * 1000);
    assertEquals(again, secrets[name]);
    const other = await signKey(role, "a-different-secret-entirely", claims.iat * 1000);
    assertNotEquals(other, secrets[name]);
  }
});

Deno.test("the data API's connection string carries its own password and no other", async () => {
  const secrets = await newSecrets();
  assert(secrets.pgrst_db_uri.includes(secrets.pg_authenticator_password));
  for (const name of ["pg_postgres_password", "pg_supabase_admin_password", "pg_auth_admin_password", "pg_storage_admin_password"]) {
    assert(!secrets.pgrst_db_uri.includes(secrets[name]), `the connection string carries ${name}`);
  }
  assert(secrets.pgrst_db_uri.startsWith("postgres://authenticator:"));
});

Deno.test("the provider key files start empty, because empty means not configured", async () => {
  const secrets = await newSecrets();
  for (const name of PROVIDER_KEY_FILES) assertEquals(secrets[name], "");
});

Deno.test("writing them prints names and lengths, never a value", async () => {
  const dir = await Deno.makeTempDir({ prefix: "sylou-secrets-" });
  const printed: string[] = [];
  const log = console.log;
  console.log = (...parts: unknown[]) => printed.push(parts.join(" "));
  try {
    assertEquals(await makeSecrets({ dir }), 0);
    const written = [...Deno.readDirSync(dir)].map((entry) => entry.name).sort();
    assertEquals(written.length, 13);
    const output = printed.join("\n");
    for (const name of written) {
      const value = await Deno.readTextFile(`${dir}/${name}`);
      assert(output.includes(name), `${name} was not reported`);
      if (value.length > 0) assert(!output.includes(value), `${name}'s value was printed`);
    }
  } finally {
    console.log = log;
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an install that already has secrets is never written over by accident", async () => {
  const dir = await Deno.makeTempDir({ prefix: "sylou-secrets-" });
  const errors: string[] = [];
  const error = console.error;
  const log = console.log;
  console.error = (...parts: unknown[]) => errors.push(parts.join(" "));
  console.log = () => {};
  try {
    assertEquals(await makeSecrets({ dir }), 0);
    const first = await Deno.readTextFile(`${dir}/jwt_secret`);

    // Second run: refused, and nothing changed.
    assertEquals(await makeSecrets({ dir }), 1);
    assertEquals(await Deno.readTextFile(`${dir}/jwt_secret`), first);
    assert(errors.join("\n").includes("already has"));

    // Only when asked outright.
    assertEquals(await makeSecrets({ dir, force: true }), 0);
    assertNotEquals(await Deno.readTextFile(`${dir}/jwt_secret`), first);
  } finally {
    console.error = error;
    console.log = log;
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an empty provider key file does not count as an install to protect", async () => {
  const dir = await Deno.makeTempDir({ prefix: "sylou-secrets-" });
  const log = console.log;
  console.log = () => {};
  try {
    await Deno.writeTextFile(`${dir}/anthropic_api_key`, "");
    assertEquals(await makeSecrets({ dir }), 0);
  } finally {
    console.log = log;
    await Deno.remove(dir, { recursive: true });
  }
});
