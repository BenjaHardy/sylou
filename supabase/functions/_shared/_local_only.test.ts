// Local-only mode: the switch only a Sylou Local install sets, what counts
// as on, and the sentences the functions answer with while it is.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LOCAL_ONLY_FLOW_MESSAGE,
  LOCAL_ONLY_MODEL_MESSAGE,
  localOnly,
  providerUnavailableMessage,
  webSearchConfigured,
} from "./_local_only.ts";

const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] });

Deno.test("off unless the switch is set, and a plain yes in any spelling turns it on", () => {
  assert(!localOnly(env({})));
  for (const value of ["", " ", "false", "no", "off", "0", "maybe", "TRUE later"]) {
    assert(!localOnly(env({ SYLOU_LOCAL_ONLY: value })), `"${value}" must not turn it on`);
  }
  for (const value of ["true", "TRUE", " True ", "1", "yes", "on"]) {
    assert(localOnly(env({ SYLOU_LOCAL_ONLY: value })), `"${value}" must turn it on`);
  }
});

Deno.test("a provider that cannot run: the mode's own sentence while it is on, the operator's otherwise", () => {
  assertEquals(providerUnavailableMessage("mistral", env({})), "mistral API key not configured");
  assertEquals(
    providerUnavailableMessage("mistral", env({ SYLOU_LOCAL_ONLY: "true" })),
    LOCAL_ONLY_MODEL_MESSAGE,
  );
  // FLOW's caller passes its own sentence: no local model can stand in.
  assertEquals(
    providerUnavailableMessage("anthropic", env({ SYLOU_LOCAL_ONLY: "true" }), LOCAL_ONLY_FLOW_MESSAGE),
    LOCAL_ONLY_FLOW_MESSAGE,
  );
  assertEquals(
    providerUnavailableMessage("anthropic", env({}), LOCAL_ONLY_FLOW_MESSAGE),
    "anthropic API key not configured",
  );
});

Deno.test("both sentences say the mode is on and where to pick a model", () => {
  for (const message of [LOCAL_ONLY_MODEL_MESSAGE, LOCAL_ONLY_FLOW_MESSAGE]) {
    assert(message.startsWith("Local-only mode is on:"), message);
  }
  assert(LOCAL_ONLY_MODEL_MESSAGE.includes("Settings → Models"));
  assert(LOCAL_ONLY_FLOW_MESSAGE.includes("cloud model"));
});

Deno.test("web search needs the operator's key and a Sylou that is not local-only", () => {
  assert(webSearchConfigured(env({ BRAVE_SEARCH_API_KEY: "brave-key" })));
  assert(!webSearchConfigured(env({})));
  assert(!webSearchConfigured(env({ BRAVE_SEARCH_API_KEY: "brave-key", SYLOU_LOCAL_ONLY: "true" })));
});
