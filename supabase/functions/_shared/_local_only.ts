// Local-only mode: a Sylou Local install's own switch, which no hosted
// deployment sets. While it is on, this Sylou runs models on this computer
// only — the cloud providers count as not configured whatever keys are
// present, and web search never runs, because the search words are the
// user's own text leaving the computer.
//
// The switch is read through the handler's deps.env like every other
// setting, so a handler test can turn it on without touching the process.

const LOCAL_ONLY_ENV = "SYLOU_LOCAL_ONLY";
const ON = new Set(["true", "1", "yes", "on"]);

/** Whether this Sylou runs models on this computer only. */
export function localOnly(env: Pick<Deno.Env, "get">): boolean {
  return ON.has((env.get(LOCAL_ONLY_ENV) ?? "").trim().toLowerCase());
}

/** Shown wherever a chat, editor or Ask/Propose call needs a cloud model. */
export const LOCAL_ONLY_MODEL_MESSAGE =
  "Local-only mode is on: this Sylou uses models on this computer only. Pick one in Settings → Models.";

/** Shown for FLOW, which runs on cloud models only — the ones this mode
 *  turns off, so no model on this computer can stand in. */
export const LOCAL_ONLY_FLOW_MESSAGE =
  "Local-only mode is on: this Sylou uses models on this computer only, and FLOW analyses need a cloud model.";

/** What a function answers when its model's provider cannot run: the
 *  local-only sentence where that is the reason, else the operator-facing
 *  message about the missing key, unchanged. */
export function providerUnavailableMessage(
  provider: string,
  env: Pick<Deno.Env, "get">,
  localOnlyMessage: string = LOCAL_ONLY_MODEL_MESSAGE,
): string {
  return localOnly(env) ? localOnlyMessage : `${provider} API key not configured`;
}

/** Whether web search can run at all: the operator set a search key, and
 *  this Sylou is not in local-only mode. */
export function webSearchConfigured(env: Pick<Deno.Env, "get">): boolean {
  return !!env.get("BRAVE_SEARCH_API_KEY") && !localOnly(env);
}
