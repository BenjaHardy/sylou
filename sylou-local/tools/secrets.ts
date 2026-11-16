// This install's secrets: one file each, made here and never printed.
//
// Supabase's own recipe ships an example file with fixed demo values and
// gives five database roles the same password. Here every role has its own
// random password, the signing secret is new on every install, and the two
// API keys are signed with it rather than copied from anywhere.

/** 32 characters of randomness, from the system's own source. */
export function randomSecret(characters = 32): string {
  const bytes = new Uint8Array(Math.ceil((characters * 3) / 4));
  crypto.getRandomValues(bytes);
  return base64url(bytes).slice(0, characters);
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlText(text: string): string {
  return base64url(new TextEncoder().encode(text));
}

/**
 * A key for the data API, signed with this install's own secret. The shape
 * is the one Supabase's services expect: a role, an issuer and a long life.
 */
export async function signKey(role: "anon" | "service_role", jwtSecret: string, now = Date.now()): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const header = base64urlText(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64urlText(
    JSON.stringify({
      role,
      iss: "supabase",
      iat: issuedAt,
      // Ten years: an install is not a service with a key rotation desk.
      // `sylou rotate` makes a new set when you want one.
      exp: issuedAt + 10 * 365 * 24 * 60 * 60,
    }),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwtSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

/** The provider keys: made empty, because an empty file means "not set". */
export const PROVIDER_KEY_FILES = [
  "anthropic_api_key",
  "mistral_api_key",
  "deepseek_api_key",
  "brave_search_api_key",
];

/** Every file an install needs, with the values it starts life with. */
export async function newSecrets(now = Date.now()): Promise<Record<string, string>> {
  const jwtSecret = randomSecret(64);
  const authenticator = randomSecret(32);
  const files: Record<string, string> = {
    jwt_secret: jwtSecret,
    pg_supabase_admin_password: randomSecret(32),
    pg_postgres_password: randomSecret(32),
    pg_authenticator_password: authenticator,
    pg_auth_admin_password: randomSecret(32),
    pg_storage_admin_password: randomSecret(32),
    anon_key: await signKey("anon", jwtSecret, now),
    service_role_key: await signKey("service_role", jwtSecret, now),
    // PostgREST reads its whole connection string from a file, so the
    // password never becomes a setting of its own.
    pgrst_db_uri: `postgres://authenticator:${authenticator}@db:5432/postgres`,
  };
  for (const name of PROVIDER_KEY_FILES) files[name] = "";
  return files;
}

export interface SecretsOptions {
  dir: string;
  force?: boolean;
  now?: number;
}

/**
 * Writes the files, and refuses to write over an install that already has
 * them: those secrets are the only way into its database.
 */
export async function makeSecrets(options: SecretsOptions): Promise<number> {
  const secrets = await newSecrets(options.now);
  const existing: string[] = [];
  for (const name of Object.keys(secrets)) {
    try {
      const current = await Deno.readTextFile(`${options.dir}/${name}`);
      // An empty provider key file is a placeholder, not something to keep.
      if (current.trim() !== "" || !PROVIDER_KEY_FILES.includes(name)) existing.push(name);
    } catch {
      // Not there yet, which is the normal case.
    }
  }

  if (existing.length > 0 && !options.force) {
    console.error(
      `secrets: this install already has ${existing.length} secret file(s): ${existing.join(", ")}.\n` +
        "Writing new ones would lock you out of the database and every account in it.\n" +
        "Use `sylou rotate` to change them, or run this again with --force if you are\n" +
        "setting up a fresh install and mean to throw the old one away.",
    );
    return 1;
  }

  await Deno.mkdir(options.dir, { recursive: true });
  for (const [name, value] of Object.entries(secrets)) {
    await Deno.writeTextFile(`${options.dir}/${name}`, value);
  }

  console.log(`secrets: ${Object.keys(secrets).length} files written to ${options.dir}`);
  for (const [name, value] of Object.entries(secrets)) {
    console.log(`  ${name.padEnd(28)} ${value.length === 0 ? "(empty — paste your key here)" : `${value.length} characters`}`);
  }
  return 0;
}
