// A stand-in for Ollama, for the package tests (D30): one model with a
// window of its own, answering every call Sylou makes with a fixed reply, so
// the route to a model on this computer is exercised without a real model.
//
//   deno run --allow-net tests/fake-ollama.ts [--hostname 0.0.0.0] [--port 11434]
//
// It also keeps a list of what it was asked and from which address, at
// /__fake/requests, so a test can tell which container a call came from.

export const FAKE_MODEL = "sylou-fake-16k";
export const FAKE_VERSION = "0.13.1";
export const FAKE_WINDOW = 16384;
export const FAKE_REPLY = "The stand-in model answered.";

export interface SeenRequest {
  method: string;
  path: string;
  from: string;
  model?: string;
}

const MODEL_INFO = {
  name: FAKE_MODEL,
  model: FAKE_MODEL,
  modified_at: "2026-11-17T00:00:00Z",
  size: 1_000_000,
  digest: "0".repeat(64),
  details: { format: "gguf", family: "llama", parameter_size: "1B", quantization_level: "Q4_0" },
};

function usage() {
  return { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 };
}

/** An OpenAI-shape answer, whole or as a stream, as Ollama gives one. */
function completion(stream: boolean): Response {
  const id = "chatcmpl-fake";
  const created = Math.floor(Date.now() / 1000);
  if (!stream) {
    return Response.json({
      id,
      object: "chat.completion",
      created,
      model: FAKE_MODEL,
      choices: [{ index: 0, message: { role: "assistant", content: FAKE_REPLY }, finish_reason: "stop" }],
      usage: usage(),
    });
  }
  const chunk = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`;
  const base = { id, object: "chat.completion.chunk", created, model: FAKE_MODEL };
  const body = [
    chunk({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: FAKE_REPLY }, finish_reason: null }] }),
    chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    chunk({ ...base, choices: [], usage: usage() }),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

/** A POST's JSON body, read once; anything else is no body. */
async function bodyOf(request: Request): Promise<Record<string, unknown> | undefined> {
  if (request.method !== "POST") return undefined;
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null ? body : undefined;
  } catch {
    return undefined;
  }
}

export function fakeOllama(seen: SeenRequest[] = []) {
  return async (request: Request, info: Deno.ServeHandlerInfo): Promise<Response> => {
    const { pathname } = new URL(request.url);
    const from = (info.remoteAddr as Deno.NetAddr).hostname;
    if (pathname === "/__fake/requests") return Response.json(seen);

    const body = await bodyOf(request);
    // /api/show names its model as `model`, older clients as `name`.
    const named = body?.model ?? body?.name;
    const model = typeof named === "string" ? named : undefined;
    seen.push({ method: request.method, path: pathname, from, model });

    switch (pathname) {
      case "/":
        return new Response("Ollama is running");
      case "/api/version":
        return Response.json({ version: FAKE_VERSION });
      case "/api/tags":
        return Response.json({ models: [MODEL_INFO] });
      case "/api/ps":
        return Response.json({
          models: [{ ...MODEL_INFO, expires_at: "2099-01-01T00:00:00Z", size_vram: MODEL_INFO.size, context_length: FAKE_WINDOW }],
        });
      case "/api/show":
        if (model !== FAKE_MODEL) return Response.json({ error: `model '${model}' not found` }, { status: 404 });
        return Response.json({
          parameters: `num_ctx ${FAKE_WINDOW}`,
          details: MODEL_INFO.details,
          model_info: { "general.architecture": "llama", "llama.context_length": FAKE_WINDOW },
          capabilities: ["completion", "tools"],
        });
      case "/v1/chat/completions": {
        if (model !== FAKE_MODEL) {
          return Response.json({ error: { message: `model "${model}" not found` } }, { status: 404 });
        }
        return completion(body?.stream === true);
      }
      default:
        return Response.json({ error: "not found" }, { status: 404 });
    }
  };
}

if (import.meta.main) {
  const flag = (name: string, fallback: string) => {
    const at = Deno.args.indexOf(`--${name}`);
    return at >= 0 && Deno.args[at + 1] ? Deno.args[at + 1] : fallback;
  };
  const hostname = flag("hostname", "127.0.0.1");
  const port = Number(flag("port", "11434"));
  const seen: SeenRequest[] = [];
  const handler = fakeOllama(seen);
  Deno.serve({
    hostname,
    port,
    onListen: () => console.log(`fake-ollama: ${FAKE_MODEL} (window ${FAKE_WINDOW}) on ${hostname}:${port}`),
  }, async (request, info) => {
    const response = await handler(request, info);
    const last = seen.at(-1);
    if (last) console.log(`fake-ollama: ${last.method} ${last.path} from ${last.from}${last.model ? ` (${last.model})` : ""} -> ${response.status}`);
    return response;
  });
}
