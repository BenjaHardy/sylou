import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, providerFor, normaliseResponse, extractProviderError, envKeyFor } from "./_llm.ts";

// Budget helper. Intentionally duplicated across the four edge functions
// (chat, context-prompt, editor-action, analysis) — Supabase edge function
// isolation prevents importing a shared module without a build step.
// A NULL monthly_token_budget means "no limit" (operator hasn't set one).
function isOverBudget(profile: {
  monthly_token_budget: number | null;
  tokens_used_this_period: number;
}): boolean {
  return (
    profile.monthly_token_budget !== null &&
    profile.tokens_used_this_period >= profile.monthly_token_budget
  );
}


// --- CORS allow-list (parsed once at module load) ---
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (ALLOWED_ORIGINS.length === 0) {
  console.warn(
    "[cors] ALLOWED_ORIGIN is not set. No cross-origin browser requests " +
    "will be accepted. Set ALLOWED_ORIGIN to a comma-separated list of " +
    "origins this instance is served from (e.g. https://example.com).",
  );
}

const BASE_CORS_HEADERS: Record<string, string> = {
  "Vary": "Origin",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { ...BASE_CORS_HEADERS, "Access-Control-Allow-Origin": origin };
  }
  // Non-matching or missing Origin: omit Access-Control-Allow-Origin entirely.
  // Browsers will block the response; non-browser callers ignore CORS.
  return { ...BASE_CORS_HEADERS };
}

// Generator provenance — captured at report-generation time so shared
// reports retain their origin metadata regardless of where they are viewed.
//
// `is_modified` is hardcoded to `false` in the official codebase. Forks that
// modify the source are encouraged to set this to `true` as a transparency
// signal, but the authoritative evidence of modification is the commit_hash
// — viewers can compare it against the official Sylou repository's release
// tags to verify.
const SYLOU_INSTANCE_LABEL  = Deno.env.get("SYLOU_INSTANCE_LABEL")  ?? "self-hosted";
const SYLOU_INSTANCE_DOMAIN = Deno.env.get("SYLOU_INSTANCE_DOMAIN") ?? null;
const SYLOU_VERSION         = Deno.env.get("SYLOU_VERSION")         ?? "unknown";
const SYLOU_COMMIT_HASH     = Deno.env.get("SYLOU_COMMIT_HASH")     ?? "unknown";
const GENERATOR_INFO = {
  instance_label:  SYLOU_INSTANCE_LABEL,
  instance_domain: SYLOU_INSTANCE_DOMAIN,
  version:         SYLOU_VERSION,
  commit_hash:     SYLOU_COMMIT_HASH,
  is_modified:     false,
} as const;



// ---------------------------------------------------------------------------
// UUID validation
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// FLOW Prompt v1.2 – full text from Sylou_FLOW_Prompt.docx
// ---------------------------------------------------------------------------
const FLOW_PROMPT_TEMPLATE = `You are an expert analyst evaluating human-AI collaboration in a writing project. Your task is to assess how a human user collaborated with an AI assistant across four pillars: Find, Lead, Organize, and Write (the FLOW framework).

# INSTRUCTIONS

1. Read the complete project data below carefully.
2. For each of the four pillars, identify the key patterns across the ENTIRE project. Your assessment must reflect the overall project, not isolated moments.
3. For each pillar, cite 2-4 key evidence items that are REPRESENTATIVE of the overall pattern you observed. Evidence must span the breadth of the work (beginning, middle, and end for larger projects) to prevent clustering or cherry-picking. Each evidence item should be a brief quote or concrete reference to a specific moment in the chat history or writing.
4. For each pillar, write your REASONING before assigning a score. Explain how the evidence supports your assessment, consider alternative interpretations, and justify your score choice. This reasoning will be available to the user on request, so be thorough and fair.
5. Assign a score for each pillar using the rubric below. Use half-point increments (0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0) to reflect nuance. If there is insufficient evidence to assess a pillar, assign null instead of a numeric score.
6. Write a brief narrative for each pillar explaining the assessment in language accessible to the user.
7. Write an overall summary of the human-AI collaboration. Where applicable, highlight (i) significant user contributions and (ii) areas where the human-AI collaboration provided significant added value in a way that empowered the user and their work; if none, specify there are none.
8. Identify **3–5 key user contributions**. These are specific, concrete moments where the user's thinking, judgment, knowledge, or creativity meaningfully shaped the final work. If there are genuinely fewer than 3 clear user contributions, return whatever is well-supported by evidence. Do not fabricate contributions to reach 3.

# FLOW PILLAR DEFINITIONS

- F – Find (Research & Critical Thinking)
Identify how the user researched relevant topics, whether he questioned the AI's outputs, compared alternatives, or challenged suggestions — versus relying on the AI without investigation.

- L – Lead (Ideas & Opinions)
Determine who is the true source of the ideas, opinions and perspectives in the final work: the user (original thinking, own viewpoint) or the AI (suggestions heavily reused, ideas taken verbatim, reliance on AI-driven content).

- O – Organize (Structure & Argumentation)
Assess how the ideas, opinions and perspectives are structured, and how the narrative and argumentation — supporting those ideas, opinions and perspectives — are developed. Determine whether the user or the AI primarily shaped the outline, the logical progression, the argumentation, and the overall structure.

- W – Write (Writing & Text Production)
Analyze the respective contributions to tone, style, clarity, correctness, sentence structure, transitions, and final drafting. Identify whether the AI generated large portions of the prose, whether the user refined or rewrote the content, or whether the user wrote the content by himself. Pay attention to the provenance annotations ([t], [cc], [ce], [ai] tags) in the writing content to inform your Write pillar assessment.

# === SCORING CALIBRATION ===

To ensure consistent scoring, use the following reference points. These apply globally across all four pillars:

| Score | Label | Description |
|-------|-------|-------------|
| 5.0 | Only Human | The user produced this aspect of the work entirely independently. The AI was not involved, or the user explicitly disregarded AI contributions for this pillar. |
| 4.0 | Largely Human | The user originated the core content for this pillar (e.g. key ideas, overall structure, or prose). The AI provided minor support such as factual checks, light suggestions, or small refinements, but the user's contribution clearly dominates. |
| 3.0 | More Human | The user drove the direction and made the key decisions, but the AI made notable contributions that shaped the outcome. For example, the AI suggested a framework that the user substantially adapted, or the AI drafted a passage that the user significantly rewrote. |
| 2.0 | More AI | The AI produced the bulk of the material for this pillar, but the user made meaningful modifications, selections, or editorial decisions. The user engaged with the AI output rather than accepting it passively. |
| 1.0 | Largely AI | The AI generated nearly all of the content for this pillar. The user's contribution was limited to minor edits, superficial changes, or simple acceptance of AI output. |
| 0.0 | No human contribution detected | No evidence of human contribution for this pillar. The AI produced all relevant content and the user did not engage with, modify, or build upon it. |
| null | Insufficient evidence | There is not enough data to assess this pillar. This applies when the writing or chat history is too sparse to evaluate a particular pillar, or when the pillar is not applicable to the work produced. Use this instead of defaulting to 0. |

Half-point scores (e.g. 2.5, 3.5) are permitted and encouraged when the evidence falls between two reference points.

# RESPONSE FORMAT

Respond ONLY by calling the submit_flow_analysis tool with the required parameters. Do not produce any text outside the tool call.

Each of \`find\`, \`lead\`, \`organize\`, and \`write\` MUST be a nested JSON object of the shape \`{ "reasoning": "...", "evidence": ["...", "..."], "score": 3.5, "narrative": "..." }\`. Do not return any pillar as a string. Do not promote \`reasoning\`, \`evidence\`, \`score\`, or \`narrative\` to the top level. Do not use XML or \`<parameter>\` tags.`;

// ---------------------------------------------------------------------------
// Creative FLOW Prompt — for creative template projects
// ---------------------------------------------------------------------------
const CREATIVE_FLOW_PROMPT_TEMPLATE = `You are an expert analyst evaluating human-AI collaboration in a creative writing project. Your task is to assess how a human user collaborated with an AI assistant across four pillars: Find, Lead, Organize, and Write (the FLOW framework).

# INSTRUCTIONS

1. Read the complete project data below carefully.
2. For each of the four pillars, identify the key patterns across the ENTIRE project. Your assessment must reflect the overall project, not isolated moments.
3. For each pillar, cite 2-4 key evidence items that are REPRESENTATIVE of the overall pattern you observed. Evidence must span the breadth of the work (beginning, middle, and end for larger projects) to prevent clustering or cherry-picking. Each evidence item should be a brief quote or concrete reference to a specific moment in the chat history or writing.
4. For each pillar, write your REASONING before assigning a score. Explain how the evidence supports your assessment, consider alternative interpretations, and justify your score choice. This reasoning will be available to the user on request, so be thorough and fair.
5. Assign a score for each pillar using the rubric below. Use half-point increments (0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0) to reflect nuance. If there is insufficient evidence to assess a pillar, assign null instead of a numeric score.
6. Write a brief narrative for each pillar explaining the assessment in language accessible to the user.
7. Write an overall summary of the human-AI collaboration. Where applicable, highlight (i) significant user contributions and (ii) areas where the human-AI collaboration provided significant added value in a way that empowered the user and their work; if none, specify there are none.
8. Identify **3–5 key user contributions**. These are specific, concrete moments where the user's thinking, judgment, knowledge, or creativity meaningfully shaped the final work. If there are genuinely fewer than 3 clear user contributions, return whatever is well-supported by evidence. Do not fabricate contributions to reach 3.

# FLOW PILLAR DEFINITIONS

- F – Find (Research & Critical Thinking)
Identify how the user researched relevant topics - in particular with regards to the world-building aspects of the creative writing and all items grounded in factual matters (if any) -, whether he questioned the AI's outputs, compared alternatives, or challenged suggestions — versus relying on the AI without investigation.

- L – Lead (Ideas & Opinions)
Determine who is the true source of the ideas, opinions and perspectives in the writing content, covering notably all key story elements expressed in the creative writing tools (world-building notes, character diagram, timeline): the user (original thinking, own viewpoint) or the AI (suggestions heavily reused, ideas taken verbatim, reliance on AI-driven content).

- O – Organize (Structure & Argumentation)
Assess how the ideas, opinions and perspectives – including all key story elements expressed in the creative writing tools - are structured, narrated and developed in the writing content. Determine whether the user or the AI primarily shaped the overall structure of the creative writing, the narration, the pace of the story, and the character viewpoints adopted.

- W – Write (Writing & Text Production)
Analyze the respective contributions in the writing content to tone, style, clarity, correctness, sentence structure, transitions, dialogs, and final drafting. Identify whether the AI generated large portions of the prose, whether the user refined or rewrote the content, or whether the user wrote the content by himself. Pay attention to the provenance annotations ([t], [cc], [ce], [ai] tags) in the writing content to inform your Write pillar assessment.

# === SCORING CALIBRATION ===

To ensure consistent scoring, use the following reference points. These apply globally across all four pillars:

| Score | Label | Description |
|-------|-------|-------------|
| 5.0 | Only Human | The user produced this aspect of the work entirely independently. The AI was not involved, or the user explicitly disregarded AI contributions for this pillar. |
| 4.0 | Largely Human | The user originated the core content for this pillar (e.g. key ideas, overall structure, or prose). The AI provided minor support such as factual checks, light suggestions, or small refinements, but the user's contribution clearly dominates. |
| 3.0 | More Human | The user drove the direction and made the key decisions, but the AI made notable contributions that shaped the outcome. For example, the AI suggested a framework that the user substantially adapted, or the AI drafted a passage that the user significantly rewrote. |
| 2.0 | More AI | The AI produced the bulk of the material for this pillar, but the user made meaningful modifications, selections, or editorial decisions. The user engaged with the AI output rather than accepting it passively. |
| 1.0 | Largely AI | The AI generated nearly all of the content for this pillar. The user's contribution was limited to minor edits, superficial changes, or simple acceptance of AI output. |
| 0.0 | No human contribution detected | No evidence of human contribution for this pillar. The AI produced all relevant content and the user did not engage with, modify, or build upon it. |
| null | Insufficient evidence | There is not enough data to assess this pillar. This applies when the writing or chat history is too sparse to evaluate a particular pillar, or when the pillar is not applicable to the work produced. Use this instead of defaulting to 0. |

Half-point scores (e.g. 2.5, 3.5) are permitted and encouraged when the evidence falls between two reference points.

# RESPONSE FORMAT

Respond ONLY by calling the submit_flow_analysis tool with the required parameters. Do not produce any text outside the tool call.

Each of \`find\`, \`lead\`, \`organize\`, and \`write\` MUST be a nested JSON object of the shape \`{ "reasoning": "...", "evidence": ["...", "..."], "score": 3.5, "narrative": "..." }\`. Do not return any pillar as a string. Do not promote \`reasoning\`, \`evidence\`, \`score\`, or \`narrative\` to the top level. Do not use XML or \`<parameter>\` tags.`;

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------
const pillarSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["reasoning", "evidence", "score", "narrative"],
  properties: {
    reasoning: { type: "string" as const, description: "Chain-of-thought reasoning before scoring" },
    evidence: {
      type: "array" as const,
      description: "2–4 short quotes or concrete references from the project supporting the assessment.",
      items: { type: "string" as const },
      minItems: 2,
      maxItems: 4,
    },
    score: {
      description: "Half-point score from 0.0 to 5.0, or null if insufficient evidence.",
      anyOf: [
        { type: "number" as const, minimum: 0, maximum: 5 },
        { type: "null" as const },
      ],
    },
    narrative: {
      type: "string" as const,
      description: "Brief user-facing narrative explaining the assessment for this pillar.",
    },
  },
};

const SUBMIT_FLOW_TOOL = {
  name: "submit_flow_analysis",
  description: "Submit the structured FLOW analysis results",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["summary", "find", "lead", "organize", "write", "key_user_contributions"],
    properties: {
      summary: { type: "string" as const, description: "Overall summary paragraph" },
      find: pillarSchema,
      lead: pillarSchema,
      organize: pillarSchema,
      write: pillarSchema,
      key_user_contributions: {
        type: "array" as const,
        description: "3–5 specific, concrete user contributions that meaningfully shaped the final work.",
        items: {
          type: "object" as const,
          additionalProperties: false,
          required: ["contribution", "evidence", "why_it_matters"],
          properties: {
            contribution: {
              type: "string" as const,
              description: "A concise description (one or two sentences) of what the user specifically contributed — such as an idea, a reframing, a decision, domain knowledge, a judgment call, a stylistic or structural choice.",
            },
            evidence: {
              type: "string" as const,
              description: "Where this contribution appears in the project — cite or paraphrase a specific moment from the chat, the writing content, the creative tools (if available), or the interaction history.",
            },
            why_it_matters: {
              type: "string" as const,
              description: "Why this contribution was significant for the final work — what would have been missing, weaker, or different without it.",
            },
          },
        },
        minItems: 0,
        maxItems: 5,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSource(seg: { source?: string; type?: string }): string {
  const raw = seg.source ?? seg.type ?? "typed";
  switch (raw) {
    case "typed":
    case "chat_user":
      return "typed";
    case "chat_ai":
      return "copy_chat";
    case "ai_editor":
      return "ai";
    case "external":
      return "copy_external";
    // Legacy values that already match the display keys
    case "copy_chat":
    case "copy_external":
    case "ai":
      return raw;
    default:
      return raw;
  }
}

function buildProvenanceAnnotatedWriting(
  content: string,
  segmentMap: Array<{ start: number; end: number; source?: string; type?: string }>
): string {
  if (!segmentMap || segmentMap.length === 0) {
    return `[t]${content}`;
  }

  const sorted = [...segmentMap].sort((a, b) => a.start - b.start);
  let result = "";
  let cursor = 0;

  for (const seg of sorted) {
    if (seg.start > cursor) {
      result += `[t]${content.slice(cursor, seg.start)}`;
    }
    const norm = normalizeSource(seg);
    const tag =
      norm === "typed" ? "[t]"
      : norm === "copy_chat" ? "[cc]"
      : norm === "copy_external" ? "[ce]"
      : norm === "ai" ? "[ai]"
      : `[${norm}]`;
    result += `${tag}${content.slice(seg.start, seg.end)}`;
    cursor = seg.end;
  }

  if (cursor < content.length) {
    result += `[t]${content.slice(cursor)}`;
  }

  return result;
}

/**
 * Compute aggregate character-count percentages per provenance type.
 */
function computeProvenanceStats(
  content: string,
  segmentMap: Array<{ start: number; end: number; source?: string; type?: string }>
): Record<string, number> {
  if (!segmentMap || segmentMap.length === 0) {
    // Fallback: strip HTML tags for plain text length
    const plainLen = content.replace(/<[^>]*>/g, "").length;
    if (plainLen === 0) return { typed: 100, copy_chat: 0, copy_external: 0, ai: 0 };
    return { typed: 100, copy_chat: 0, copy_external: 0, ai: 0 };
  }

  const counts: Record<string, number> = { typed: 0, copy_chat: 0, copy_external: 0, ai: 0 };
  const sorted = [...segmentMap].sort((a, b) => a.start - b.start);
  let cursor = 0;

  for (const seg of sorted) {
    if (seg.start > cursor) {
      counts["typed"] += seg.start - cursor;
    }
    const normType = normalizeSource(seg);
    counts[normType] = (counts[normType] || 0) + (seg.end - seg.start);
    cursor = Math.max(cursor, seg.end);
  }

  // Use segment-derived total length (TipTap coordinate system) instead of
  // raw HTML content.length, so percentages align with the highlighted text view.
  const totalLen = cursor;
  if (totalLen === 0) return { typed: 100, copy_chat: 0, copy_external: 0, ai: 0 };

  // Convert to percentages
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(counts)) {
    result[key] = Math.round((val / totalLen) * 1000) / 10; // one decimal
  }
  return result;
}

function buildChatHistoryString(
  messages: Array<{
    created_at: string;
    role: string;
    content: string;
    source_type: string | null;
    flow_flag: string | null;
    thread_name: string;
    documents_referenced?: string[] | null;
    web_searches_performed?: string[] | null;
  }>,
  docNameMap: Record<string, string>
): string {
  return messages
    .map((m) => {
      const dt = new Date(m.created_at);
      const ts = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
      let line = `[${ts} — Thread: ${m.thread_name}] ${m.role}: ${m.content}`;
      if (m.source_type && m.source_type !== "chat") {
        line += ` [${m.source_type}]`;
      }
      if (m.documents_referenced && Array.isArray(m.documents_referenced) && m.documents_referenced.length > 0) {
        const names = m.documents_referenced.map((id: string) => docNameMap[id] || id).map(n => `"${n}"`).join(", ");
        line += ` [Documents referenced: ${names}]`;
      }
      if (m.web_searches_performed && Array.isArray(m.web_searches_performed) && m.web_searches_performed.length > 0) {
        const queries = m.web_searches_performed.map((q: string) => `"${q}"`).join(", ");
        line += ` [Web searches performed: ${queries}]`;
      }
      if (m.flow_flag === "not_assessed") {
        line = `[NOT ASSESSED] ${line}`;
      }
      return line;
    })
    .join("\n\n");
}

function buildEditorStatsString(
  actions: Array<{
    action_type: string;
    outcome: string;
    char_count_original: number | null;
    char_count_result: number | null;
    selected_text_preview?: string | null;
    ai_response_preview?: string | null;
    instruction_text?: string | null;
  }>
): string {
  if (!actions || actions.length === 0) {
    return "No AI editor actions recorded.";
  }

  const byType: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  let totalOrigChars = 0;
  let acceptedResultChars = 0;

  for (const a of actions) {
    byType[a.action_type] = (byType[a.action_type] || 0) + 1;
    byOutcome[a.outcome] = (byOutcome[a.outcome] || 0) + 1;
    if (a.outcome === "accepted" && a.char_count_result) {
      acceptedResultChars += a.char_count_result;
    }
    if (a.char_count_original) {
      totalOrigChars += a.char_count_original;
    }
  }

  const lines = [
    `Total AI editor actions: ${actions.length}`,
    `By type: ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `By outcome: ${Object.entries(byOutcome).map(([k, v]) => `${k}=${v}`).join(", ")}`,
  ];

  if (acceptedResultChars > 0 && totalOrigChars > 0) {
    const pct = Math.round((acceptedResultChars / totalOrigChars) * 100);
    lines.push(`Estimated % of writing from accepted AI suggestions: ~${pct}%`);
  }

  // Append detailed per-action log (most recent 20) so the LLM can see
  // the user's original text vs the AI result — critical for cases where
  // user-written text was merely grammar-checked or lightly rewritten.
  const detailedActions = actions.slice(0, 20);
  if (detailedActions.some(a => a.selected_text_preview || a.ai_response_preview)) {
    lines.push("");
    lines.push("--- Detailed action log (most recent 20) ---");
    for (let i = 0; i < detailedActions.length; i++) {
      const a = detailedActions[i];
      lines.push(`\n--- Action ${i + 1}: ${a.action_type} (${a.outcome}) ---`);
      if (a.selected_text_preview) {
        // Parse source info from instruction_text if present (after "| Source:" or "Source:")
        let sourceLabel = "source unknown";
        if (a.instruction_text) {
          const sourceMatch = a.instruction_text.match(/(?:\|\s*)?Source:\s*(.+?)$/);
          if (sourceMatch) {
            sourceLabel = `source: ${sourceMatch[1].trim()}`;
          }
        }
        lines.push(`Original (${sourceLabel}): "${a.selected_text_preview}"`);
      }
      if (a.ai_response_preview) {
        lines.push(`AI result: "${a.ai_response_preview}"`);
      }
      if (a.instruction_text) {
        // Strip the source info before displaying instruction
        const cleanInstruction = a.instruction_text.replace(/\s*\|\s*Source:\s*.+$/, "").trim();
        if (cleanInstruction && cleanInstruction !== "Source:") {
          lines.push(`User instruction: "${cleanInstruction}"`);
        }
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Similarity detection: compare writing against AI assistant chat messages
// ---------------------------------------------------------------------------


function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ngrams(text: string, n: number): Set<string> {
  const words = text.split(" ");
  const out = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    out.add(words.slice(i, i + n).join(" "));
  }
  return out;
}

function computeSimilarityPct(
  writingContent: string,
  assistantMessages: string[]
): number {
  const normWriting = normalise(writingContent);
  if (!normWriting) return 0;

  const assistantNgrams = new Set<string>();
  for (const msg of assistantMessages) {
    const normMsg = normalise(msg);
    for (const ng of ngrams(normMsg, 5)) {
      assistantNgrams.add(ng);
    }
  }

  if (assistantNgrams.size === 0) return 0;

  const writingNgramsList = ngrams(normWriting, 5);
  if (writingNgramsList.size === 0) return 0;

  let matchCount = 0;
  for (const ng of writingNgramsList) {
    if (assistantNgrams.has(ng)) matchCount++;
  }

  return Math.round((matchCount / writingNgramsList.size) * 100);
}

// ---------------------------------------------------------------------------
// Creative data formatting for FLOW analysis
// ---------------------------------------------------------------------------

function stripHtmlDeno(html: string): string {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  }
}

function formatCreativeDataForAnalysis(
  creativeRows: Array<{ tool_type: string; data: Record<string, unknown> }>
): string {
  if (!creativeRows || creativeRows.length === 0) return "(No creative tools data)";

  const sections: string[] = [];

  // World-building
  const wbRow = creativeRows.find(r => r.tool_type === "worldbuilding");
  const cats = (wbRow?.data as any)?.categories as Array<{
    name: string; notes: Array<{ title: string; subcategory: string; content: string }>;
  }> ?? [];
  if (cats.length > 0) {
    const lines = ["--- World-Building Notes ---"];
    for (const cat of cats) {
      for (const note of (cat.notes ?? [])) {
        const text = stripHtmlDeno(note.content);
        if (text) lines.push(`[${cat.name} / ${note.subcategory}] ${note.title}: ${text}`);
      }
    }
    if (lines.length > 1) sections.push(lines.join("\n"));
  }

  // Characters
  const charsRow = creativeRows.find(r => r.tool_type === "characters");
  const chars = (charsRow?.data as any)?.characters as Array<{
    id: string; name: string; description: string; traits: string[];
  }> ?? [];
  const rels = (charsRow?.data as any)?.relationships as Array<{
    from_id: string; to_id: string; type_id: string; notes: string;
  }> ?? [];
  const relTypes = (charsRow?.data as any)?.relationshipTypes as Array<{
    id: string; label: string;
  }> ?? [];

  const nameMap = new Map(chars.map(c => [c.id, c.name]));

  if (chars.length > 0) {
    const lines = ["--- Character Diagram ---"];
    for (const c of chars) {
      let line = `- ${c.name}`;
      if (c.description) line += `: ${stripHtmlDeno(c.description)}`;
      if (c.traits?.length) line += ` [Traits: ${c.traits.join(", ")}]`;
      lines.push(line);
    }
    if (rels.length > 0) {
      lines.push("Relationships:");
      for (const r of rels) {
        const fromName = nameMap.get(r.from_id) ?? "?";
        const toName = nameMap.get(r.to_id) ?? "?";
        const typeLabel = relTypes.find(t => t.id === r.type_id)?.label ?? "?";
        let line = `  ${fromName} → ${toName} (${typeLabel})`;
        if (r.notes) line += ` — ${stripHtmlDeno(r.notes)}`;
        lines.push(line);
      }
    }
    sections.push(lines.join("\n"));
  }

  // Timeline
  const tlRow = creativeRows.find(r => r.tool_type === "timeline");
  const events = (tlRow?.data as any)?.events as Array<{
    title: string; date: string; description: string; order: number; character_ids: string[];
  }> ?? [];
  if (events.length > 0) {
    const sorted = [...events].sort((a, b) => a.order - b.order);
    const lines = ["--- Timeline ---"];
    for (const e of sorted) {
      let line = `- ${e.date ? `[${e.date}] ` : ""}${e.title}`;
      if (e.description) line += `: ${stripHtmlDeno(e.description)}`;
      if (e.character_ids?.length) {
        const names = e.character_ids.map(id => nameMap.get(id) ?? "?").join(", ");
        line += ` [Characters: ${names}]`;
      }
      lines.push(line);
    }
    sections.push(lines.join("\n"));
  }

  return sections.length > 0 ? sections.join("\n\n") : "(No creative tools data)";
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const jsonResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // --- Parse body & validate project_id ---
    const body = await req.json();
    const projectId: string = body.project_id;
    if (!projectId || typeof projectId !== "string" || !UUID_RE.test(projectId)) {
      return jsonResponse({ error: "project_id must be a valid UUID" }, 400);
    }

    // --- Verify project ownership (RLS) + get settings ---
    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .select("id, language, tutor_mode, name, template")
      .eq("id", projectId)
      .single();

    if (projectErr || !project) {
      return jsonResponse({ error: "Project not found or not owned by user" }, 404);
    }

    // --- Fetch profile for budget (needed later) ---
    const { data: profile } = await supabase
      .from("profiles")
      .select("tokens_used_this_period, monthly_token_budget")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    const isCreativeProject = project.template === "creative";

    // --- Fetch all project data in parallel ---
    const fetchPromises = [
        supabase.from("writing_content").select("content").eq("project_id", projectId).single(),
        supabase.from("chat_threads").select("id, name").eq("project_id", projectId),
        supabase.from("provenance_events").select("segment_map").eq("project_id", projectId).single(),
        supabase.from("ai_editor_actions").select("action_type, outcome, char_count_original, char_count_result, selected_text_preview, ai_response_preview, instruction_text, created_at").eq("project_id", projectId).order("created_at", { ascending: false }),
        supabase.from("project_stats").select("*").eq("project_id", projectId).single(),
        supabase.from("imported_documents").select("id, file_name, extracted_text, summary, file_size_bytes").eq("project_id", projectId),
        supabase.from("writing_versions").select("content, saved_at").eq("project_id", projectId).order("saved_at", { ascending: true }),
    ] as const;

    const creativeDataPromise = isCreativeProject
      ? supabase.from("project_creative_data").select("tool_type, data").eq("project_id", projectId)
      : Promise.resolve({ data: null });

    const [[writingRes, threadsRes, provenanceRes, editorActionsRes, statsRes, importedDocsRes, versionsRes], creativeDataRes] =
      await Promise.all([Promise.all(fetchPromises), creativeDataPromise]);

    const writingContent = writingRes.data?.content ?? "";
    if (!writingContent || writingContent.trim().length === 0) {
      return jsonResponse({ error: "No writing to analyze" }, 400);
    }

    // --- Fetch chat messages across all threads ---
    const threadIds = (threadsRes.data ?? []).map(
      (t: { id: string }) => t.id
    );
    const threadNameMap: Record<string, string> = {};
    for (const t of threadsRes.data ?? []) {
      threadNameMap[(t as { id: string; name: string }).id] = (
        t as { id: string; name: string }
      ).name;
    }

    let chatMessages: Array<{
      created_at: string;
      role: string;
      content: string;
      source_type: string | null;
      flow_flag: string | null;
      thread_id: string;
      thread_name: string;
      documents_referenced?: string[] | null;
      web_searches_performed?: string[] | null;
    }> = [];

    if (threadIds.length > 0) {
      const { data: msgs } = await supabase
        .from("chat_messages")
        .select("created_at, role, content, source_type, flow_flag, thread_id, documents_referenced, web_searches_performed")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: true });

      chatMessages = (msgs ?? []).map((m: Record<string, unknown>) => ({
        created_at: m.created_at as string,
        role: m.role as string,
        content: m.content as string,
        source_type: m.source_type as string | null,
        flow_flag: m.flow_flag as string | null,
        thread_id: m.thread_id as string,
        thread_name: threadNameMap[m.thread_id as string] ?? "Unknown",
        documents_referenced: m.documents_referenced as string[] | null,
        web_searches_performed: m.web_searches_performed as string[] | null,
      }));
    }

    // --- Use provenance segments as-is (mapping-based tracking is accurate) ---
    const segmentMap =
      (provenanceRes.data?.segment_map as Array<{
        start: number;
        end: number;
        source?: string;
        type?: string;
        original_text?: string | null;
      }>) ?? [];

    // --- Build provenance-annotated writing ---
    const annotatedWriting = buildProvenanceAnnotatedWriting(
      writingContent,
      segmentMap
    );

    // --- Compute provenance statistics ---
    const provenanceStats = computeProvenanceStats(writingContent, segmentMap);
    const provenanceSection = `# === INPUT PROVENANCE DATA ===

Character-count breakdown by provenance type:
- Typed by user: ${provenanceStats.typed}%
- Copied from AI chat: ${provenanceStats.copy_chat}%
- Copied from external source: ${provenanceStats.copy_external}%
- AI-generated (editor): ${provenanceStats.ai}%`;

    // --- Build imported documents name map ---
    const importedDocs = (importedDocsRes.data ?? []) as Array<{
      id: string;
      file_name: string;
      extracted_text: string | null;
      summary: string | null;
      file_size_bytes: number | null;
    }>;
    const docNameMap: Record<string, string> = {};
    for (const doc of importedDocs) {
      docNameMap[doc.id] = doc.file_name;
    }

    // --- Build chat history string ---
    const chatHistoryStr =
      chatMessages.length > 0
        ? buildChatHistoryString(chatMessages, docNameMap)
        : "No chat history recorded.";

    // --- Build editor stats ---
    const editorStatsStr = buildEditorStatsString(
      (editorActionsRes.data as Array<{
        action_type: string;
        outcome: string;
        char_count_original: number | null;
        char_count_result: number | null;
        selected_text_preview: string | null;
        ai_response_preview: string | null;
        instruction_text: string | null;
      }>) ?? []
    );

    // --- Similarity detection ---
    const assistantMessages = chatMessages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content);
    const similarityPct = computeSimilarityPct(writingContent, assistantMessages);

    // Build Write Pillar Notice if similarity >= 35%
    let writePillarNotice = "";
    if (similarityPct >= 35) {
      writePillarNotice = `\n# === WRITE PILLAR NOTICE ===\n\nAutomated similarity analysis detected that ${similarityPct}% of the writing content closely matches AI assistant responses from the chat history. This is a significant indicator for Write pillar scoring. Consider this alongside the provenance annotations ([t], [cc], [ce], [ai] tags) in the writing content.`;
    }

    // --- 3-tier imported documents budget ---
    // Context limit: 200k tokens for Claude minus 4k output reserve ≈ 196k tokens
    // 1 token ≈ 4 chars
    const CONTEXT_CHAR_LIMIT = 196_000 * 4; // 784,000 chars

    // Build the prompt WITHOUT imported documents first to measure baseline
    const basePromptParts = [
      `# LANGUAGE\n\nRespond entirely in ${project.language}. All summaries, analyses, evidence items, reasoning, and narratives must be written in ${project.language}. Only JSON structure and field names remain in English.`,
      `# WRITING CONTENT (PROVENANCE-ANNOTATED)\n\nThe writing content below is annotated with provenance tags indicating the origin of each text segment. Use these annotations to inform your assessment, particularly for the Write pillar:\n\n- [t] = typed by the user (original user writing, including text copied from the user's own chat messages)\n- [cc] = copied from AI assistant chat messages (AI-originated text)\n- [ce] = copied from an external source (neither user nor AI contribution; pay attention not to wrongly attribute to user)\n- [ai] = AI-generated text accepted from the text selection window (the user selected text in their editor and requested an AI rewrite, expansion, simplification, or proposal, then accepted the result)\n\n${annotatedWriting}\n\n${provenanceSection}`,
      `# CHAT HISTORY\n\nThe following chat messages are from all project threads, merged in chronological order. Each message is prefixed with a timestamp and thread label.\n\nSome messages originate from the text selection window, a feature that allows the user to select text in their editor and either ask the AI a question about it (Ask) or request the AI to propose a rewritten version (Propose). These messages are flagged with their source type below.\n\nWriting summaries are marked "[NOT ASSESSED]" — they provide context for the subsequent discussion but should not be scored as either party's contribution, because they are AI-generated condensations of the writing and creative tools data at that point in time that may include contributions from any party. Consider the whole chat log and other contents to properly identify the respective contributions of each party, noting that new ideas or contributions appearing for the first time in a writing summary and not found in earlier chat messages would normally be user contributions unless copied from external sources.\n\n${chatHistoryStr}`,
    ];
    const baseChars = FLOW_PROMPT_TEMPLATE.length + basePromptParts.join("\n\n").length;

    let importedDocsSection = "";
    let importedDocsMode: "full_text" | "summaries" | "excluded" | "none" = "none";
    let importedDocsTotalChars = 0;

    if (importedDocs.length > 0) {
      // Calculate full text size
      const fullTextEntries = importedDocs.map(d => {
        const text = d.extracted_text ?? "(no text extracted)";
        importedDocsTotalChars += text.length;
        return `--- ${d.file_name} ---\n${text}`;
      });
      const fullTextSection = fullTextEntries.join("\n\n");

      // Calculate summary size
      const summaryEntries = importedDocs.map(d => {
        const sum = d.summary ?? "(no summary available)";
        return `--- ${d.file_name} ---\n${sum}`;
      });
      const summarySection = summaryEntries.join("\n\n");

      const remainingBudget = CONTEXT_CHAR_LIMIT - baseChars;

      if (fullTextSection.length < remainingBudget * 0.8) {
        // Tier 1: full text fits
        importedDocsMode = "full_text";
        importedDocsSection = fullTextSection;
      } else if (summarySection.length < remainingBudget * 0.8) {
        // Tier 2: summaries fit
        importedDocsMode = "summaries";
        const wordEstimate = Math.round(importedDocsTotalChars / 5);
        importedDocsSection = `Note: The full text of imported documents (~${wordEstimate.toLocaleString()} words total) exceeded the context window. Summaries are provided instead.\n\n${summarySection}`;
      } else {
        // Tier 3: exclude
        importedDocsMode = "excluded";
        const wordEstimate = Math.round(importedDocsTotalChars / 5);
        importedDocsSection = `Note: ${importedDocs.length} imported document(s) (~${wordEstimate.toLocaleString()} words total) were excluded from this analysis because they exceed the available context window, even as summaries. The documents' titles are: ${importedDocs.map(d => `"${d.file_name}"`).join(", ")}.`;
      }
    } else {
      importedDocsSection = "None";
    }

    // --- Build creative tools section (if applicable) ---
    let creativeToolsSection = "";
    if (isCreativeProject && creativeDataRes.data && creativeDataRes.data.length > 0) {
      creativeToolsSection = `\n\n# === CREATIVE TOOLS CONTENT ===\n\nThe following content comes from the creative tools accessible by the user to help develop key story elements: world-building notes, character diagram, timeline. This content is critical for assessing the L – Lead pillar (directly) and O – Organize pillar (indirectly).\n\n${formatCreativeDataForAnalysis(creativeDataRes.data as any)}`;
    }

    // --- Build full prompt ---
    const systemPromptTemplate = isCreativeProject ? CREATIVE_FLOW_PROMPT_TEMPLATE : FLOW_PROMPT_TEMPLATE;

    const chatHistoryNote = isCreativeProject
      ? `# CHAT HISTORY\n\nThe following chat messages are from all project threads, merged in chronological order. Each message is prefixed with a timestamp and thread label.\n\nSome messages originate from the text selection window, a feature that allows the user to select text in their editor or in the creative tools and either ask the AI a question about it (Ask – available for both the editor and the creative tools) or request the AI to propose a rewritten version (Propose – available solely for the editor). These messages are flagged with their source type below.\n\nWriting summaries are marked "[NOT ASSESSED]" — they provide context for the subsequent discussion but should not be scored as either party's contribution, because they are AI-generated condensations of the writing and creative tools data at that point in time that may include contributions from any party. Consider the whole chat log and other contents to properly identify the respective contributions of each party, noting that new ideas or contributions appearing for the first time in a writing summary and not found in earlier chat messages would normally be user contributions unless copied from external sources.\n\n${chatHistoryStr}`
      : basePromptParts[2]; // original chat history section

    const userPrompt = `${basePromptParts[0]}\n\n${basePromptParts[1]}${creativeToolsSection}\n\n${chatHistoryNote}

# === IMPORTED DOCUMENTS ===

The following documents were imported by the user as reference material. They are neither user nor AI contributions. If the writing closely mirrors imported document content, note this in your analysis but do not score it as AI contribution.

${importedDocsSection}

# === AI EDITOR ACTIVITY ===

The following statistics summarize AI-assisted editing actions performed via the text selection window. Predefined actions (grammar, rewrite, simplify, expand, translate) are counted. Ask and Propose interactions are also counted here but their full content appears in the Chat History above.

${editorStatsStr}
${writePillarNotice}`;

    // --- Budget check (after prompt is fully built) ---
    const fullPromptText = systemPromptTemplate + userPrompt;
    const charEst = Math.ceil(fullPromptText.length / 4) * 1.1;
    const wordEst = fullPromptText.split(/\s+/).length * 1.3;
    const estimated = Math.ceil(Math.max(charEst, wordEst));
    const budgetRemaining: number | null =
      profile.monthly_token_budget === null
        ? null
        : profile.monthly_token_budget - profile.tokens_used_this_period;

    if (budgetRemaining !== null && budgetRemaining < estimated + 2000) {
      return jsonResponse(
        {
          error: `Insufficient token budget for FLOW analysis`,
          estimated_cost: estimated + 2000,
          budget_remaining: budgetRemaining,
        },
        403
      );
    }

    // --- Estimate input tokens for flow_meta ---
    const estimatedInputTokens = estimated;
    const contextLimitTokens = 1000000; // Claude Sonnet 4.6 context window

    // --- Resolve FLOW model from profile (or request body) ---
    const reqBody = (typeof body !== "undefined" ? body : {}) as Record<string, unknown>;
    const { data: prefRow } = await supabase
      .from("profiles")
      .select("preferred_flow_model")
      .eq("id", user.id)
      .maybeSingle();
    const flowModel: string =
      (reqBody.model as string | undefined) ||
      (prefRow as { preferred_flow_model?: string } | null)?.preferred_flow_model ||
      "claude-sonnet-4-6";

    // --- Call LLM with tool use (provider-agnostic) ---
    const provider = providerFor(flowModel);
    if (!Deno.env.get(envKeyFor(provider))) {
      return jsonResponse({ error: `${provider} API key not configured` }, 500);
    }

    if (provider === "anthropic") {
      console.log("FLOW tool schema sent to Claude", {
        model: flowModel,
        tool_name: SUBMIT_FLOW_TOOL.name,
        input_schema: JSON.stringify(SUBMIT_FLOW_TOOL.input_schema),
      });
    }

    const llmArgs = {
      model: flowModel,
      max_tokens: 8192,
      messages: [
        { role: "system" as const, content: systemPromptTemplate },
        { role: "user" as const, content: userPrompt },
      ],
      tools: [{
        type: "function" as const,
        function: {
          name: SUBMIT_FLOW_TOOL.name,
          description: SUBMIT_FLOW_TOOL.description,
          parameters: SUBMIT_FLOW_TOOL.input_schema,
        },
      }],
      forceTool: SUBMIT_FLOW_TOOL.name,
    };

    // Diagnostic: full prompt as sent to the LLM (system + user + tools).
    // Stringified so Supabase log viewer doesn't truncate nested objects.
    console.log("FLOW prompt sent", {
      model: flowModel,
      provider,
      request_body: JSON.stringify(llmArgs),
    });

    const llmRes = await callLLM(llmArgs);

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error("LLM API error:", llmRes.status, errText);
      return jsonResponse(
        { error: extractProviderError(provider, llmRes.status, errText) },
        502
      );
    }

    const rawData = await llmRes.json();

    // Diagnostic: full raw response from the provider, including stop_reason,
    // content blocks, tool blocks, and usage.
    console.log("FLOW raw response", {
      model: flowModel,
      stop_reason: rawData?.stop_reason ?? rawData?.choices?.[0]?.finish_reason ?? null,
      raw_response: JSON.stringify(rawData),
    });

    const normalised = normaliseResponse(provider, rawData);
    const toolCall = normalised.toolCalls.find((tc) => tc.name === SUBMIT_FLOW_TOOL.name);

    if (!toolCall?.arguments) {
      console.error(
        "No tool_use block found in response:",
        JSON.stringify(rawData)
      );
      return jsonResponse(
        { error: "AI analysis returned unexpected format. Please try again." },
        502
      );
    }

    // Keep downstream variable names for minimal churn.
    const anthropicData = {
      usage: {
        input_tokens: normalised.usage?.input_tokens,
        output_tokens: normalised.usage?.output_tokens,
      },
    };
    const flowResult = toolCall.arguments;

    // Validate all required pillars are structured objects
    const defaultPillar = { reasoning: "Insufficient data", evidence: [], score: null, narrative: "Could not be assessed." };
    function isValidPillar(p: unknown): boolean {
      return (
        typeof p === "object" && p !== null &&
        "reasoning" in p && "evidence" in p &&
        Array.isArray((p as Record<string, unknown>).evidence) && "narrative" in p
      );
    }

    // Strict schema guardrail — reject if too many pillars are malformed (likely a bad model response)
    const pillarValidity = [
      isValidPillar(flowResult.find),
      isValidPillar(flowResult.lead),
      isValidPillar(flowResult.organize),
      isValidPillar(flowResult.write),
    ];
    const validPillarCount = pillarValidity.filter(Boolean).length;
    const hasSummary = !!flowResult.summary && typeof flowResult.summary === "string";
    if (validPillarCount < 3 || !hasSummary) {
      // Diagnostic: capture shape + stop reason to disambiguate truncation vs schema drift.
      // No payload content / no PII — only key names, types, and counters.
      const pillarShape: Record<string, string> = {};
      for (const k of ["summary", "find", "lead", "organize", "write"] as const) {
        const v = (flowResult as Record<string, unknown>)[k];
        pillarShape[k] = v === undefined ? "undefined" : v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
      }
      console.error("FLOW schema validation failed", {
        model: flowModel,
        validPillarCount,
        hasSummary,
        stop_reason: rawData?.stop_reason ?? rawData?.choices?.[0]?.finish_reason ?? null,
        input_tokens: normalised.usage?.input_tokens ?? null,
        output_tokens: normalised.usage?.output_tokens ?? null,
        tool_call_present: !!toolCall,
        tool_argument_keys: Object.keys(flowResult ?? {}),
        pillar_shape: pillarShape,
        summary_len: typeof flowResult?.summary === "string" ? (flowResult.summary as string).length : 0,
      });
      console.error("FLOW raw tool input (full)", {
        model: flowModel,
        raw_tool_input: JSON.stringify(flowResult),
      });
      // Log token usage for transparency, but flag as schema_invalid and skip insert
      try {
        await supabase.from("token_usage").insert({
          user_id: user.id,
          project_id: projectId,
          function_name: "analysis:schema_invalid",
          model_used: flowModel,
          input_tokens: anthropicData?.usage?.input_tokens ?? 0,
          output_tokens: anthropicData?.usage?.output_tokens ?? 0,
        });
      } catch (_) { /* ignore */ }
      return jsonResponse(
        { error: "Analysis could not be completed with this model — try Claude Sonnet 4.6." },
        502
      );
    }

    if (!isValidPillar(flowResult.find)) flowResult.find = defaultPillar;
    if (!isValidPillar(flowResult.lead)) flowResult.lead = defaultPillar;
    if (!isValidPillar(flowResult.organize)) flowResult.organize = defaultPillar;
    if (!isValidPillar(flowResult.write)) flowResult.write = defaultPillar;
    if (!flowResult.summary || typeof flowResult.summary !== "string") flowResult.summary = "Analysis could not produce a complete summary.";

    // --- Apply Write pillar score cap if similarity >= 35% ---
    if (
      similarityPct >= 35 &&
      flowResult.write?.score != null &&
      flowResult.write.score > 2.0
    ) {
      flowResult.write.score = 2.0;
      flowResult.write.narrative +=
        ` [Note: Write score capped at 2.0 due to automated similarity detection finding ${similarityPct}% overlap with AI chat responses.]`;
    }

    // --- Capture metrics snapshot (includes all stats fields) ---
    const metricsSnapshot = statsRes.data
      ? {
          total_active_time_seconds: statsRes.data.total_active_time_seconds,
          total_writing_time_seconds: statsRes.data.total_writing_time_seconds,
          chat_prompt_count_normal: statsRes.data.chat_prompt_count_normal,
          chat_prompt_count_tutor: statsRes.data.chat_prompt_count_tutor,
          sanity_check_count: statsRes.data.sanity_check_count,
          first_activity_at: statsRes.data.first_activity_at,
          last_activity_at: statsRes.data.last_activity_at,
          clock_anomaly_count: statsRes.data.clock_anomaly_count,
        }
      : null;

    // --- Build flow_meta with token metadata ---
    const inputTokens =
      anthropicData.usage?.input_tokens ?? estimatedInputTokens;
    const outputTokens =
      anthropicData.usage?.output_tokens ??
      Math.ceil(JSON.stringify(flowResult).length / 4);
    const totalTokens = inputTokens + outputTokens;

    // NULL budget = no limit set, so no pressure — ratio 0 acts as headroom.
    const budgetRatio = profile.monthly_token_budget === null
      ? 0
      : profile.tokens_used_this_period / profile.monthly_token_budget;
    const tokenStatus = budgetRatio >= 1.0 ? "over" : budgetRatio >= 0.8 ? "near" : "ok";

    const flowMeta: Record<string, unknown> = {
      estimated_input_tokens: inputTokens,
      context_limit_tokens: contextLimitTokens,
      token_status: tokenStatus,
      measured_at: new Date().toISOString(),
      similarity_pct: similarityPct,
      write_score_capped: similarityPct >= 35,
      imported_documents_mode: importedDocsMode,
      imported_documents_count: importedDocs.length,
      imported_documents_total_chars: importedDocsTotalChars,
      ...(isCreativeProject ? { template: "creative" } : {}),
    };

    // --- Build replay snapshot ---
    const replayEvents: Array<{ timestamp: string; type: string; content: Record<string, unknown> }> = [];

    // Writing versions
    for (const v of (versionsRes.data ?? []) as Array<{ content: string; saved_at: string }>) {
      replayEvents.push({
        timestamp: v.saved_at,
        type: "writing_version",
        content: { html: v.content },
      });
    }

    // Chat messages (already fetched)
    for (const m of chatMessages) {
      replayEvents.push({
        timestamp: m.created_at,
        type: "chat_message",
        content: {
          role: m.role,
          content: m.content.length > 500 ? m.content.slice(0, 500) + "…" : m.content,
          thread_name: m.thread_name,
          source_type: m.source_type,
        },
      });
    }

    // AI editor actions
    for (const a of (editorActionsRes.data ?? []) as Array<{
      action_type: string; outcome: string; created_at: string;
      selected_text_preview?: string | null; ai_response_preview?: string | null;
      [k: string]: unknown;
    }>) {
      replayEvents.push({
        timestamp: a.created_at,
        type: "ai_editor_action",
        content: {
          action_type: a.action_type,
          outcome: a.outcome,
          selected_text_preview: a.selected_text_preview ?? null,
          ai_response_preview: a.ai_response_preview ?? null,
        },
      });
    }

    // Sort chronologically
    replayEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // --- Store FLOW report ---
    const { data: report, error: reportErr } = await supabase
      .from("flow_reports")
      .insert({
        project_id: projectId,
        ai_summary: flowResult.summary,
        ai_find: flowResult.find,
        ai_lead: flowResult.lead,
        ai_organize: flowResult.organize,
        ai_write: flowResult.write,
        key_user_contributions: Array.isArray(flowResult.key_user_contributions) ? flowResult.key_user_contributions : [],
        metrics_snapshot: metricsSnapshot,
        flow_meta: flowMeta,
        provenance_snapshot: segmentMap,
        model_used: flowModel,
        project_name: project.name ?? null,
        replay_snapshot: replayEvents,
        writing_snapshot: writingContent,
        generator_info: GENERATOR_INFO,
      } as any)
      .select()
      .single();

    if (reportErr) {
      console.error("Error storing FLOW report:", reportErr);
      return jsonResponse({ error: "Failed to store analysis report" }, 500);
    }

    // --- Log token usage & atomically increment budget ---
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    await Promise.all([
      supabase.from("token_usage").insert({
        user_id: user.id,
        project_id: projectId,
        function_name: "analysis",
        model_used: flowModel,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      }),
      adminSupabase.rpc("increment_tokens_used", {
        user_uuid: user.id,
        amount: totalTokens,
      }),
    ]);

    return jsonResponse({
      report,
      tokens_used: totalTokens,
      budget_remaining: budgetRemaining === null ? null : budgetRemaining - totalTokens,
    });
  } catch (err) {
    console.error("Analysis function error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
