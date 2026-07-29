// context-prompt/call-model.ts — non-streaming LLM round-trip transport
// (P4-1 Phase D split; moved verbatim from index.ts).
//
// Serves BOTH sides of the two-call flow: LLM Call #1 (the writing
// summary, always non-streamed) and the latent non-streaming Call #2
// variants — which is why it lives alone rather than under prompts.
// callLLM handles provider routing; this wrapper adds error extraction,
// per-provider text assembly, cleanLLMContent, and char accounting.
// No injection seam (static callLLM import) — covered by deno check and
// the live smoke, not unit tests.

import { callLLM, providerFor, extractProviderError, cleanLLMContent } from "../_shared/_llm.ts";
import type { ClaudeEffort, MistralEffort } from "../_shared/_thinking.ts";

export async function callChatModel(
  model: string,
  messages: { role: string; content: string }[],
  maxTokens = 2000,
  temperature?: number,
  thinking?: boolean,
  effort?: ClaudeEffort,
  mistralEffort?: MistralEffort,
): Promise<{ text: string; inputChars: number; outputChars: number }> {
  const res = await callLLM({
    model,
    messages: messages as any,
    max_tokens: maxTokens,
    temperature,
    thinking,
    effort,
    mistral_effort: mistralEffort,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("LLM API error:", res.status, errText);
    throw new Error(extractProviderError(providerFor(model), res.status, errText));
  }

  const data = await res.json();
  let rawText = "";
  if (providerFor(model) === "anthropic") {
    const blocks: any[] = data?.content ?? [];
    rawText = blocks.filter(b => b?.type === "text").map(b => b.text ?? "").join("");
  } else {
    rawText = data.choices?.[0]?.message?.content ?? "";
  }
  const text = cleanLLMContent(rawText);
  const inputChars = messages.reduce((s, m) => s + m.content.length, 0);
  return { text, inputChars, outputChars: text.length };
}
