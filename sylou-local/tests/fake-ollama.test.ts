// The stand-in Ollama the package tests use, checked against the functions'
// own reading of Ollama (supabase/functions/_shared/_ollama.ts): if the two
// ever disagree, the package tests would be exercising a route that does not
// exist.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchLocalModelInfo, ollamaBody } from "../../supabase/functions/_shared/_ollama.ts";
import { FAKE_MODEL, FAKE_REPLY, FAKE_VERSION, FAKE_WINDOW, fakeOllama, type SeenRequest } from "./fake-ollama.ts";

async function withFake(fn: (base: string, seen: SeenRequest[]) => Promise<void>) {
  const seen: SeenRequest[] = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, fakeOllama(seen));
  try {
    await fn(`http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`, seen);
  } finally {
    await server.shutdown();
  }
}

Deno.test("the functions read the stand-in's model as a local model with a window and tools", async () => {
  await withFake(async (base) => {
    const env = { get: (name: string) => (name === "OLLAMA_URL" ? base : undefined) };
    assertEquals(await fetchLocalModelInfo(`ollama/${FAKE_MODEL}`, env), { contextTokens: FAKE_WINDOW, tools: true });
    const missing = await fetchLocalModelInfo("ollama/not-there", env);
    assert("error" in missing && missing.error.includes("no model named"), JSON.stringify(missing));
  });
});

Deno.test("the stand-in answers the chat call the functions send, whole and streamed", async () => {
  await withFake(async (base, seen) => {
    for (const stream of [false, true]) {
      const body = ollamaBody({ model: `ollama/${FAKE_MODEL}`, messages: [{ role: "user", content: "Helo" }], stream });
      const answer = await fetch(`${base}/v1/chat/completions`, { method: "POST", body: JSON.stringify(body) });
      const text = await answer.text();
      assertEquals(answer.status, 200);
      assertStringIncludes(text, FAKE_REPLY);
      if (stream) assertStringIncludes(text, "data: [DONE]");
      else assertEquals(JSON.parse(text).choices[0].message.content, FAKE_REPLY);
    }
    // It keeps who asked what, for the package tests to read back.
    const asked = await (await fetch(`${base}/__fake/requests`)).json() as SeenRequest[];
    assertEquals(asked.filter((request) => request.path === "/v1/chat/completions").length, 2);
    assertEquals(asked.at(-1)?.model, FAKE_MODEL);
    assertEquals(asked.at(-1)?.from, "127.0.0.1");
    assertEquals(seen.length, asked.length);
  });
});

Deno.test("the stand-in tells doctor its version", async () => {
  await withFake(async (base) => {
    assertEquals(await (await fetch(`${base}/api/version`)).json(), { version: FAKE_VERSION });
  });
});
