// context-prompt/prompts.ts — the product-voice surface of Ask/Propose
// (P4-1 Phase D split; prompt text moved verbatim from index.ts —
// byte-hash-verified at extraction; the only diffs are export keywords).
//
// SENTINEL CONTRACT (pinned by prompts.test.ts): buildSummaryPrompt's
// CRITICAL RULES instruct the summarizer to reply with the exact literal
// "No update needed." or to prefix additions with "Additionally, " —
// and mergeSummary below branches on those same strings. The two sides
// are a matched string protocol: edit one, and the cross-pin test goes
// red until the other follows. Note the deliberate looseness, preserved
// as-is: mergeSummary matches startsWith("Additionally") WITHOUT the
// comma, slightly wider than the prompt mandates.

import { buildMemoryInjection } from "../_shared/_conversation_memory.ts";

/** Fold LLM Call #1's reply into the running summary state.
 *  Returns the pair the §4 transparency contract keeps distinct:
 *  updatedSummary = the FULL merged text (writing_summary_log only,
 *  withheld from FLOW); summaryUpdate = the per-turn DELTA (chat
 *  message flagged not_assessed, fed to FLOW). Lifted verbatim from
 *  the handler's merge block. */
export function mergeSummary(
  summaryText: string,
  existingSummary: string | null,
): { updatedSummary: string; summaryUpdate: string } {
  let updatedSummary: string;
  let summaryUpdate: string;

  if (summaryText === "No update needed." && existingSummary) {
    updatedSummary = existingSummary;
    summaryUpdate = "No update needed.";
  } else if (existingSummary && summaryText.startsWith("Additionally")) {
    updatedSummary = existingSummary + "\n" + summaryText;
    summaryUpdate = summaryText;
  } else {
    updatedSummary = summaryText;
    summaryUpdate = summaryText;
  }

  return { updatedSummary, summaryUpdate };
}

export function buildSummaryPrompt(
  writingContent: string,
  existingSummary: string | null,
  selectedText: string,
  instruction: string,
  sourceModule: string,
  language: string,
  creativeDataSection: string = "",
): { role: string; content: string }[] {
  const prompt = `You are a writing analysis assistant. Respond in ${language}.

Your task is to produce a brief, focused summary of the user's current writing project, relevant to answering a specific question or fulfilling a specific request.

=== CURRENT WRITING ===
${writingContent}
${creativeDataSection}

=== EXISTING WRITING SUMMARY (if any) ===
${existingSummary ?? "None"}

=== USER'S SELECTED TEXT ===
${selectedText}

=== USER'S QUESTION/REQUEST ===
${instruction}

=== SOURCE MODULE ===
${sourceModule}

=== YOUR TASK ===
- Produce a brief summary of the writing that includes ONLY information needed to answer the user's question or fulfill their request effectively. Be concise and specific.

CRITICAL RULES — follow exactly:

1. If an EXISTING WRITING SUMMARY is provided above AND it already covers
   all information needed to answer the user's question:
   → Reply with exactly: "No update needed."

2. If an EXISTING WRITING SUMMARY is provided above BUT additional details
   from the writing are needed:
   → Start your reply with "Additionally, " and provide ONLY the new facts.
   → Do NOT repeat anything from the existing summary.

3. If NO existing summary exists (it says "None"):
   → Start with "Writing currently includes..." and write a fresh summary.

FORMAT:
- Keep under 300 words. 
- State only facts from the writing — no analysis or recommendations.
- Focus on aspects relevant to the user's question
- Include character traits, plot points, arguments, or structural elements ONLY if they are needed to provide a good response`;

  return [
    { role: "system", content: prompt },
    { role: "user", content: `Please analyze the writing and produce a summary relevant to: "${instruction}"` },
  ];
}

export function buildResponsePrompt(
  systemPrompt: string,
  updatedSummary: string,
  selectedText: string,
  instruction: string,
  sourceModule: string,
  recentChat: { role: string; content: string }[],
  actionType: "ask" | "propose",
  language: string,
  conversationMemory: string | null = null,
): { role: string; content: string }[] {
  const taskInstruction =
    actionType === "ask"
      ? "Respond to the user's question with informed, specific feedback based on the writing context provided. Reference specific aspects of their work. Be helpful and constructive."
      : "Produce a revised version of the selected text that fulfills the user's request. Provide ONLY the proposed replacement text, without explanation or commentary. The user will have the option to accept, modify, or reject your proposal.";

  const chatHistory = recentChat.length > 0
    ? recentChat.map((m) => `${m.role}: ${m.content}`).join("\n")
    : "No previous messages.";

  const contextPrompt = `${systemPrompt}

Respond in ${language}.

=== WRITING CONTEXT ===
The following is a summary of the user's current writing, relevant to their request:
${updatedSummary}

=== SELECTED TEXT ===
The user selected the following text in their ${sourceModule}:
"${selectedText}"

=== USER'S REQUEST ===
${instruction}

${conversationMemory ? `${buildMemoryInjection(conversationMemory)}\n\n` : ""}=== RECENT CHAT HISTORY ===
${chatHistory}

=== YOUR TASK ===
${taskInstruction}`;

  return [
    { role: "system", content: contextPrompt },
    { role: "user", content: instruction },
  ];
}
