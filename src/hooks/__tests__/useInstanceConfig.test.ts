// Pins for useInstanceConfig: the config endpoint lists the local models to
// signed-in callers only, so the hook sends the session's token; it keeps
// well-formed entries only; and a failed read leaves web search on (as
// before) with the local models unknown, which Settings shows as "couldn't
// check" rather than as missing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ token: "user-token" as string | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: auth.token ? { access_token: auth.token } : null } }),
    },
  },
}));

// The hook caches its answer at module level, so each test loads a fresh
// copy, with Testing Library loaded beside it so both share one React.
let cleanup: (() => void) | null = null;
async function load() {
  vi.resetModules();
  const rtl = await import("@testing-library/react");
  cleanup = rtl.cleanup;
  const hook = await import("../useInstanceConfig");
  return { ...rtl, ...hook };
}

function answering(body: unknown) {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(Response.json(body)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const authorizationOf = (init: RequestInit | undefined) => new Headers(init?.headers).get("Authorization");

describe("useInstanceConfig", () => {
  beforeEach(() => {
    auth.token = "user-token";
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends the session's token, and reads the flag and each local model with its window and tools", async () => {
    const fetchMock = answering({
      web_search_enabled: true,
      local_models: [
        { id: "ollama/sylou-nemo-16k", name: "sylou-nemo-16k", context_tokens: 16384, tools: true },
        { id: "ollama/sylou-cloud", name: "sylou-cloud", problem: "runs in Ollama's cloud" },
        { id: "ollama/sylou-ministral-8k", name: "sylou-ministral-8k", not_answering: true },
      ],
    });
    const { renderHook, waitFor, useInstanceConfig } = await load();
    const { result } = renderHook(() => useInstanceConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/functions\/v1\/config$/);
    expect(authorizationOf(fetchMock.mock.calls[0][1])).toBe("Bearer user-token");
    expect(result.current.webSearchEnabled).toBe(true);
    expect(result.current.localModels).toEqual([
      { id: "ollama/sylou-nemo-16k", name: "sylou-nemo-16k", contextTokens: 16384, tools: true },
      { id: "ollama/sylou-cloud", name: "sylou-cloud", problem: "runs in Ollama's cloud" },
      { id: "ollama/sylou-ministral-8k", name: "sylou-ministral-8k", notAnswering: true },
    ]);
  });

  it("an answer without local models gives an empty list; malformed entries are dropped", async () => {
    const { parseLocalModels } = await load();
    expect(parseLocalModels(undefined)).toEqual([]);
    expect(
      parseLocalModels([
        null,
        "ollama/x",
        { id: "zai-glm-5-3", name: "a cloud id" },
        { id: "ollama/no-name" },
        { id: "ollama/odd", name: "odd", context_tokens: "16k", tools: "yes", not_answering: "true" },
      ]),
    ).toEqual([{ id: "ollama/odd", name: "odd" }]);
  });

  it("without a session: no token is sent, and the answer is not kept for later mounts", async () => {
    auth.token = null;
    const fetchMock = answering({ web_search_enabled: false });
    const { renderHook, waitFor, useInstanceConfig } = await load();
    const first = renderHook(() => useInstanceConfig());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(authorizationOf(fetchMock.mock.calls[0][1])).toBeNull();
    expect(first.result.current.localModels).toEqual([]);

    auth.token = "user-token";
    const second = renderHook(() => useInstanceConfig());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authorizationOf(fetchMock.mock.calls[1][1])).toBe("Bearer user-token");
  });

  it("a failed read: web search stays on, and the local models are unknown (null), not an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 503 }))));
    const { renderHook, waitFor, useInstanceConfig } = await load();
    const { result } = renderHook(() => useInstanceConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.webSearchEnabled).toBe(true);
    expect(result.current.localModels).toBeNull();
  });
});
