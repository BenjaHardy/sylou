// The rules of the image check (T62), on paths and text made up here: a rule
// that let everything through would leave every image looking clean.
//
// Run with: deno task test  (from sylou-local/)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { problems, secretsIn } from "./image-check.ts";

Deno.test("a settings file, a secret, a checkout or a sign-in in an image is named", () => {
  const found = problems([
    "app/.env",
    "app/.env.local",
    "./home/deno/sylou-local/config/settings.env",
    "home/deno/sylou-local/config/secrets/jwt_secret",
    "app/.git/config",
    "root/.ssh/id_ed25519",
    "root/.docker/config.json",
    "app/.npmrc",
    "src/supabase/.temp/project-ref",
    "app/.claude/settings.local.json",
  ], "65534:65534");
  assertEquals(found.length, 11);
});

Deno.test("an image's ordinary files are left alone", () => {
  assertEquals(
    problems([
      "etc/ssl/certs/ca-certificates.crt",
      "usr/share/ca-certificates/mozilla/ISRG_Root_X1.crt",
      "usr/share/nginx/html/assets/index-4f2a.js",
      "app/tools/main.ts",
      "migrations/20260316163828_cc058202.sql",
      "home/deno/eszip/chat.eszip",
      "app/settings.example.env",
    ], "101"),
    [],
  );
});

Deno.test("root, or no user at all, is a problem", () => {
  assertEquals(problems([], "").length, 1);
  assertEquals(problems([], "root").length, 1);
  assertEquals(problems([], "0:0").length, 1);
  assertEquals(problems([], "65534:65534"), []);
});

Deno.test("text shaped like a key or a signed token is found, and ordinary code is not", () => {
  const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLW9mLWVub3VnaC1sZW5ndGg";
  assertEquals(secretsIn(`const key = "${token}";`), ["a signed token"]);
  assertEquals(secretsIn("ANTHROPIC=sk-ant-api03-abcdefghijklmnopqrstuvwxyz"), ["an Anthropic key"]);
  assertEquals(secretsIn("-----BEGIN OPENSSH PRIVATE KEY-----"), ["a private key"]);
  assertEquals(secretsIn('import { createClient } from "npm:@supabase/supabase-js"; const role = "service_role";'), []);
});
