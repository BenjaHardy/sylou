// Shared tool-execution helpers for the LLM edge functions (P4-1, seam #2).
//
// searchWeb existed as byte-identical copies in chat/ and context-prompt/;
// moved verbatim. The per-function TOOL DEFINITIONS (buildDocumentTool /
// buildWebSearchTool) deliberately remain local to each function: their
// schemas and description strings are per-function prompt engineering and
// differ between the two — unifying them would change what the models see.

/** Brave web search: top-5 results, 10s timeout, degrades to [] on any
 *  failure (missing key, API error, timeout) — a hung or broken search
 *  must never stall the turn. Only ever fetches api.search.brave.com;
 *  result URLs are returned as data, never fetched. */
export async function searchWeb(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const apiKey = Deno.env.get("BRAVE_SEARCH_API_KEY");
  if (!apiKey) {
    console.error("[web_search] BRAVE_SEARCH_API_KEY not configured");
    return [];
  }

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      {
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        // A hung Brave call must not stall the whole turn — the catch
        // below already degrades to "no results" (P3-7e).
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!res.ok) {
      console.error("[web_search] Brave API error:", res.status, await res.text());
      return [];
    }

    const data = await res.json();
    const results = (data.web?.results ?? []).slice(0, 5);
    return results.map((r: { title?: string; url?: string; description?: string }) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
    }));
  } catch (err) {
    console.error("[web_search] error:", err);
    return [];
  }
}
