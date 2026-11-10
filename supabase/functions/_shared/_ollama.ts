// The local provider: models served by an Ollama server on the operator's
// own machine, offered as `ollama/<name>`. Off unless OLLAMA_URL and
// OLLAMA_MODELS are both set (supabase/functions/.env.example). Ollama
// answers on the OpenAI-shape path, with the differences ollamaBody applies.

type Env = Pick<Deno.Env, "get">;

export const OLLAMA_PREFIX = "ollama/";

export function isOllamaModel(model: string): boolean {
  return model.startsWith(OLLAMA_PREFIX);
}

/** The model's name on the Ollama server. */
export function ollamaName(model: string): string {
  return model.slice(OLLAMA_PREFIX.length);
}

/** OLLAMA_URL without its trailing slashes; null when unset or not an http(s) URL. */
export function ollamaBaseUrl(env: Env): string | null {
  const raw = env.get("OLLAMA_URL")?.trim();
  if (!raw) return null;
  let protocol: string;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "http:" && protocol !== "https:") return null;
  return raw.replace(/\/+$/, "");
}

/** The ids of the models OLLAMA_MODELS lists; none while OLLAMA_URL is unset
 *  or invalid. */
export function listedOllamaModels(env: Env): string[] {
  if (!ollamaBaseUrl(env)) {
    if (env.get("OLLAMA_URL")?.trim()) console.warn("[ollama] OLLAMA_URL is not an http(s) URL; local models are off");
    return [];
  }
  const names = (env.get("OLLAMA_MODELS") ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  return [...new Set(names)].map((name) => OLLAMA_PREFIX + name);
}

/** The OpenAI-shape body as Ollama takes it: the model's name on the server,
 *  thinking off (thinking models otherwise reason by default, and can spend
 *  the whole reply budget on it), and the token usage on a stream, which
 *  Ollama only sends when asked. */
export function ollamaBody(body: Record<string, unknown>): Record<string, unknown> {
  return {
    ...body,
    model: ollamaName(String(body.model)),
    reasoning_effort: "none",
    ...(body.stream ? { stream_options: { include_usage: true } } : {}),
  };
}

/** What a local model can take, as its server reports it. */
export interface LocalModelInfo {
  /** The context window the server loads the model with (its num_ctx). */
  contextTokens: number;
}

const INFO_TIMEOUT_MS = 10_000;

/** The parts of Ollama's /api/show answer read here. */
interface ShowResponse {
  parameters?: string;
  remote_host?: string;
  remote_model?: string;
}

/**
 * Asks the Ollama server about one of the listed models (POST /api/show), on
 * every request that runs it, so a model changed on the server counts at
 * once. Refuses a cloud model, which runs on Ollama's servers instead of this
 * machine, and a model without a window of its own (num_ctx): Ollama would
 * load it with a window sized to the GPU and silently drop what does not fit.
 */
export async function fetchLocalModelInfo(
  model: string,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalModelInfo | { error: string }> {
  const name = ollamaName(model);
  const notAnswering = { error: "The local model server (Ollama) is not answering. Start Ollama, then try again." };
  const base = ollamaBaseUrl(env);
  if (!base) return notAnswering;

  let show: ShowResponse;
  try {
    const res = await fetchImpl(`${base}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name }),
      signal: AbortSignal.timeout(INFO_TIMEOUT_MS),
    });
    if (res.status === 404) {
      await res.body?.cancel();
      return { error: `Ollama has no model named "${name}". Check the model names in OLLAMA_MODELS.` };
    }
    if (!res.ok) {
      console.error(`[ollama] /api/show answered ${res.status} for ${name}`);
      await res.body?.cancel();
      return notAnswering;
    }
    show = await res.json();
  } catch (err) {
    console.error(`[ollama] /api/show failed for ${name}:`, err);
    return notAnswering;
  }

  if (show.remote_host || show.remote_model) {
    return { error: `"${name}" runs in Ollama's cloud, not on this computer, so Sylou does not use it.` };
  }
  const numCtx = /^num_ctx\s+(\d+)\s*$/m.exec(show.parameters ?? "");
  const contextTokens = numCtx ? Number(numCtx[1]) : 0;
  if (contextTokens <= 0) {
    return {
      error: `"${name}" has no context window of its own (num_ctx), so Ollama could silently cut long requests. ` +
        "Create a copy of it with num_ctx set, and list that copy in OLLAMA_MODELS.",
    };
  }
  return { contextTokens };
}
