// Shared tool helpers for the LLM edge functions (P4-1, seams #2 + #2b + #2c).
//
// searchWeb existed as byte-identical copies in chat/ and context-prompt/;
// moved verbatim (seam 2). The tool DEFINITIONS below followed in seam 2b:
// their copies differed only by a compile-time-erased return annotation, so
// the runtime tool JSON offered to the models was always byte-identical
// (seam 2's commit claimed otherwise — that claim was wrong). Any future
// edit to these descriptions changes what BOTH functions' models see:
// deliberate prompt engineering, done with both call sites in view.

import type { LLMTool } from "./_llm.ts";

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

/** Format searchWeb results into the tool-result string handed back to
 *  the model. Moved verbatim from md5-identical copies in chat/ and
 *  context-prompt/ (seam #2c). */
export function formatWebSearchResults(query: string, results: { title: string; url: string; snippet: string }[]): string {
  if (results.length === 0) {
    return `Web search results for: "${query}"\n\nNo results found.`;
  }
  const formatted = results.map((r, i) =>
    `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
  ).join("\n\n");
  return `Web search results for: "${query}"\n\n${formatted}`;
}

/** Tool definition: fetch an imported document's full text by id. */
export function buildDocumentTool(): LLMTool {
  return {
    type: "function",
    function: {
      name: "read_imported_document",
      description:
        "Retrieve the full text of an imported reference document. Use this when the user's question requires information from a specific imported document.",
      parameters: {
        type: "object",
        properties: {
          document_id: {
            type: "string",
            description: "The ID of the document to retrieve",
          },
        },
        required: ["document_id"],
      },
    },
  };
}

/** Tool definition: Brave web search (executed by searchWeb above). */
export function buildWebSearchTool(): LLMTool {
  return {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for current information. Use this when the user's question requires information not available in your training data or the project's imported documents. Returns the top results with titles, URLs, and text snippets.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
        },
        required: ["query"],
      },
    },
  };
}
