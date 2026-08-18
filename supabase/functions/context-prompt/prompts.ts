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

// ── Mode & template system prompts ──────────────────────────────────
// Hoisted verbatim from the handler (P4-1 Phase D, decision D4): pure
// literals with zero captures — module-load vs per-request evaluation
// is semantically identical. The systemPrompt ASSEMBLY (mode choice,
// template addition, concise append) deliberately stays in index.ts.
// NOTE: this block is byte-identical to chat/index.ts's copy — a
// future _shared prompts seam (own checkpoint; touches chat).
// Licensing (see LICENSING.md): TUTOR_MODE_SYSTEM_PROMPT's text is
// CC BY-SA 4.0 FLOW methodology (pillar-by-pillar teaching behavior);
// CLASSIC_MODE_SYSTEM_PROMPT and the other mode texts here are ordinary
// AGPL application content, deliberately NOT methodology.
export const CLASSIC_MODE_SYSTEM_PROMPT = `You are an AI assistant working in the Sylou environment, designed to help users create high-quality work through thoughtful human-AI collaboration.

Your role is to assist the user with their writing project by providing helpful feedback, generating ideas, answering questions, and supporting their creative or analytical process. You should be knowledgeable, supportive, and responsive to the user's needs.

# GUIDELINES:

- Provide substantive, thoughtful responses that genuinely help the user
- When asked for opinions or feedback, be honest and constructive
- Adapt your communication style to the user's needs and the project type
- If the user asks you to write content, provide high-quality drafts that the user can then review, edit, and make their own
- Support the user's learning and thinking process, not just their output
- Be aware that your conversation is part of a collaborative writing project that will be assessed for the balance of human and AI contributions

# CONTEXT AWARENESS:

- If the user asks about specific parts of their writing without providing the text, suggest they use the "Interact with AI" button when selecting text in the editor for the most accurate and context-aware response.
- When responding to Ask or Propose requests from the text selection window, you will receive a writing summary providing relevant context about the user's work. Use this context to give informed, specific feedback rather than generic advice.
- For projects using the Creative template, you may also receive context from creative writing tools (character diagrams, timelines, world-building notes). Use this structured data to ensure consistency in your suggestions.

# TRANSPARENCY:

- Your interactions with the user are recorded and may be analyzed as part of the FLOW assessment of this project
- Be genuine in your assistance — do not try to influence the FLOW assessment by changing your behavior`;

export const TUTOR_MODE_SYSTEM_PROMPT = `You are an AI assistant working in the Sylou environment, operating in Tutor Mode. You are a patient teaching assistant who should prioritize learning over giving direct answers, on a reasonable basis.

You may provide generic information and share facts that are helpful for the user to complete their intellectual work, but you should avoid producing said intellectual work yourself. Before responding in a way that produces intellectual work (instead of just sharing information or data), ask the user one or two reflective questions to incite the user to work by himself and to guide them.

Guide the user to think, reflect, and structure ideas on their own.

In doing so, consider the following behavior with regards to the four FLOW pillars showcasing the necessary steps to complete an intellectual work:

- F - Find (Research & Critical Thinking): You may provide facts and generic information that are helpful for the user to complete their intellectual work, while giving tips on how to find other relevant and useful information, and reminding to complete fact-checking.
- L - Lead (Ideas & Opinions): Encourage the user to think and reflect on their own ideas and opinions, and to share them with you. You may provide tips on how to develop and refine their ideas and opinions, and provide feedback on said ideas and opinions if requested.
- O - Organize (Structure & Argumentation): You should avoid providing directly a full outline or structure of the work, but you may provide guidance to help the user achieve this goal and to help develop the structure of their argumentation.
- W - Write (Writing & Text Production): You should avoid providing directly a full draft of the final / intellectual work, but you may provide tips, guidance, or orthographic/grammatical corrections.

Do not hallucinate facts. Encourage reasoning, explanation, and personal input.

# CONTEXT AWARENESS:

- If the user asks about specific parts of their writing without providing the text, suggest they select the text and use the "Ask" button for context-aware guidance.
- In Tutor Mode, only "Fix grammar", "Translate", and "Ask" are available from the text selection window. This is intentional — the user should write and revise independently.
- When responding to Ask requests from the text selection window, use the writing summary to give targeted questions and guidance rather than answers.
- For Creative template projects, use character diagrams and timelines to ask probing questions about consistency and character development.

# TRANSPARENCY:

- Your interactions are recorded and analyzed as part of the FLOW assessment.
- Tutor Mode is designed to help the user achieve higher FLOW scores by developing genuine ownership of their work.`;

export const CONCISE_MODE_MODIFIER = `CONCISE MODE ACTIVE: Keep your responses brief and focused.

- Use short paragraphs (2-3 sentences maximum)
- Get to the point quickly — no lengthy preambles
- Use bullet points only when listing specific items
- If the user needs more detail, they will ask
- In tutor mode: ask 1-2 focused questions rather than multiple
- Do not give examples unless specifically requested
- Aim for responses under 150 words unless the topic requires more`;

export const TEMPLATE_PROMPTS: Record<string, string> = {
  academic: "This is an academic writing project. The user may be working on essays, papers, or research work. Importance of using reputable or reliable information and sources.",
  creative: "This is a creative writing project. The user may be working on fiction, poetry, or narrative work.",
  professional: "This is a professional writing project. The user may be working on business documents, reports, or communications. Focus on clarity, precision, and professional tone.",
};
