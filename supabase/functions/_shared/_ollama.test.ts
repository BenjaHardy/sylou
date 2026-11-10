// Deno unit tests for the local provider: its two settings, the request body
// Ollama takes, and the model lookup that refuses what cannot run safely.
// Run with: deno test supabase/functions/_shared/_ollama.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fetchLocalModelInfo,
  isOllamaModel,
  listedOllamaModels,
  ollamaBaseUrl,
  ollamaBody,
  ollamaName,
} from "./_ollama.ts";

const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] });
const SERVER = "http://host.docker.internal:11434";
const LOCAL = env({ OLLAMA_URL: `${SERVER}/`, OLLAMA_MODELS: "sylou-nemo-16k" });
const NOT_ANSWERING = { error: "The local model server (Ollama) is not answering. Start Ollama, then try again." };

/** An Ollama server answering /api/show with `status` and `body`, recording the requests. */
function fakeServer(status: number, body: unknown) {
  const requests: { url: string; body: unknown }[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  return { requests, fetchImpl };
}

Deno.test("ollamaBaseUrl: an http(s) URL without its trailing slashes; null when unset or anything else", () => {
  assertEquals(ollamaBaseUrl(env({ OLLAMA_URL: `${SERVER}/` })), SERVER);
  assertEquals(ollamaBaseUrl(env({ OLLAMA_URL: " https://ollama.example.test// " })), "https://ollama.example.test");
  assertEquals(ollamaBaseUrl(env({})), null);
  assertEquals(ollamaBaseUrl(env({ OLLAMA_URL: " " })), null);
  assertEquals(ollamaBaseUrl(env({ OLLAMA_URL: "host.docker.internal:11434" })), null);
  assertEquals(ollamaBaseUrl(env({ OLLAMA_URL: "file:///etc/hosts" })), null);
});

Deno.test("listedOllamaModels: the listed names as ids, trimmed and once each; none without OLLAMA_URL", () => {
  const models = env({ OLLAMA_URL: SERVER, OLLAMA_MODELS: " sylou-nemo-16k,sylou-gemma-32k,, sylou-nemo-16k " });
  assertEquals(listedOllamaModels(models), ["ollama/sylou-nemo-16k", "ollama/sylou-gemma-32k"]);
  assertEquals(listedOllamaModels(env({ OLLAMA_MODELS: "sylou-nemo-16k" })), []);
  assertEquals(listedOllamaModels(env({ OLLAMA_URL: SERVER })), []);
});

Deno.test("isOllamaModel and ollamaName: the prefix marks a local model and is not part of its server name", () => {
  assert(isOllamaModel("ollama/sylou-nemo-16k"));
  assert(!isOllamaModel("mistral-small-2603"));
  assertEquals(ollamaName("ollama/library/sylou-nemo:16k"), "library/sylou-nemo:16k");
});

Deno.test("ollamaBody: the server's model name, thinking off, and usage asked for on streams only", () => {
  const body = { model: "ollama/sylou-nemo-16k", messages: [{ role: "user", content: "Hi" }], max_tokens: 100 };
  assertEquals(ollamaBody(body), { ...body, model: "sylou-nemo-16k", reasoning_effort: "none" });
  assertEquals(ollamaBody({ ...body, stream: true }), {
    ...body,
    stream: true,
    model: "sylou-nemo-16k",
    reasoning_effort: "none",
    stream_options: { include_usage: true },
  });
});

Deno.test("fetchLocalModelInfo: the window is the model's num_ctx, asked of /api/show by its server name", async () => {
  const server = fakeServer(200, {
    parameters: 'num_ctx                        16384\nstop                           "[INST]"',
    capabilities: ["completion", "tools"],
  });
  assertEquals(await fetchLocalModelInfo("ollama/sylou-nemo-16k", LOCAL, server.fetchImpl), { contextTokens: 16384 });
  assertEquals(server.requests, [{ url: `${SERVER}/api/show`, body: { model: "sylou-nemo-16k" } }]);
});

Deno.test("fetchLocalModelInfo: a model without a window of its own is refused", async () => {
  const server = fakeServer(200, { parameters: "temperature                    0.15", capabilities: ["completion"] });
  const info = await fetchLocalModelInfo("ollama/ministral-3:14b", LOCAL, server.fetchImpl);
  assert("error" in info && info.error.includes("has no context window of its own (num_ctx)"), JSON.stringify(info));
});

Deno.test("fetchLocalModelInfo: a cloud model is refused, whatever its window", async () => {
  const server = fakeServer(200, {
    parameters: "num_ctx 32768",
    remote_host: "https://ollama.com:443",
    remote_model: "gpt-oss:120b",
  });
  const info = await fetchLocalModelInfo("ollama/gpt-oss:120b-cloud", LOCAL, server.fetchImpl);
  assert("error" in info && info.error.includes("runs in Ollama's cloud"), JSON.stringify(info));
});

Deno.test("fetchLocalModelInfo: a model the server does not have is named in the error", async () => {
  const server = fakeServer(404, { error: "model 'nope:latest' not found" });
  const info = await fetchLocalModelInfo("ollama/nope", LOCAL, server.fetchImpl);
  assertEquals(info, { error: 'Ollama has no model named "nope". Check the model names in OLLAMA_MODELS.' });
});

Deno.test("fetchLocalModelInfo: a server that fails or cannot be reached is 'not answering'", async () => {
  const refused = (() => Promise.reject(new TypeError("connection refused"))) as typeof fetch;
  assertEquals(await fetchLocalModelInfo("ollama/sylou-nemo-16k", LOCAL, refused), NOT_ANSWERING);
  assertEquals(await fetchLocalModelInfo("ollama/sylou-nemo-16k", LOCAL, fakeServer(500, {}).fetchImpl), NOT_ANSWERING);
  const unset = fakeServer(200, { parameters: "num_ctx 16384" });
  assertEquals(await fetchLocalModelInfo("ollama/sylou-nemo-16k", env({}), unset.fetchImpl), NOT_ANSWERING);
  assertEquals(unset.requests, []);
});
