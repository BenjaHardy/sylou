// analysis/sections.ts — the FLOW prompt's data-section formatters
// (P4-1 Phase D split; moved verbatim from index.ts — byte-hash-verified
// at extraction; the only diffs are the three export keywords and the
// normalizeSource import moving with its consumer).
//
// These three pure functions render the platform-framed evidence blocks
// the FLOW templates declare trustworthy (the chat history with its
// load-bearing "[NOT ASSESSED] " prefix, the editor-activity ledger, the
// provenance percentage breakdown) — formatting changes here change what
// the scoring model reads, so sections.test.ts pins the output shapes.

import { normalizeSource } from "../_shared/_provenance.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// normalizeSource + the provenance annotator live in _shared/_provenance.ts.
// Segments are ProseMirror positions, NOT HTML string offsets — annotation
// must go through annotateWritingWithProvenance (position-aware walker).

/**
 * Compute aggregate character-count percentages per provenance type.
 */
export function computeProvenanceStats(
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

export function buildChatHistoryString(
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

export function buildEditorStatsString(
  actions: Array<{
    action_type: string;
    outcome: string;
    char_count_original: number | null;
    char_count_result: number | null;
    selected_text_preview?: string | null;
    ai_response_preview?: string | null;
    instruction_text?: string | null;
    created_at?: string;
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

  // Append detailed per-action log (most recent 20). Inline actions
  // (grammar/rewrite/simplify/expand/translate) show their full previews —
  // this ledger is their only record, and seeing the user's original text
  // vs the AI result matters for cases where user-written text was merely
  // grammar-checked or lightly rewritten. Propose rows appear as compact
  // outcome+timestamp lines only: their full content is already in the
  // timestamped Chat History, and the timestamp lets the model link each
  // decision to its chat exchange without duplicating the content. (Ask
  // writes no ledger row at all — the chat is its complete record.)
  const detailedActions = actions.slice(0, 20);
  if (detailedActions.some(a => a.selected_text_preview || a.ai_response_preview)) {
    lines.push("");
    lines.push("--- Detailed action log (most recent 20) ---");
    for (let i = 0; i < detailedActions.length; i++) {
      const a = detailedActions[i];
      if (a.action_type === "propose") {
        lines.push(`\n--- Action ${i + 1}: propose (${a.outcome})${a.created_at ? ` at ${a.created_at}` : ""} — content in Chat History above ---`);
        continue;
      }
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

  // Actions beyond the newest 20 keep a COMPACT line each (2026-08
  // maintainer decision): the selection's provenance/source label and the
  // size signal must survive for EVERY action. An accepted grammar pass
  // over a large user-written ([t]) or external-source ([ce]) selection
  // leaves [ai] spans in the writing, and without the source label FLOW
  // could not tell those apart once the action aged out of the detailed
  // log. ~25 tokens per compact line (vs ~250 for a detailed entry) keeps
  // the prompt bounded; a near-equal size pair substitutes for the verbatim
  // original-vs-result comparison. Propose rows keep their standard compact
  // shape — their content lives in the timestamped Chat History at any age.
  if (actions.length > 20) {
    lines.push("");
    lines.push("--- Older actions (compact: type, outcome, size, selection source) ---");
    for (let i = 20; i < actions.length; i++) {
      const a = actions[i];
      if (a.action_type === "propose") {
        lines.push(`--- Action ${i + 1}: propose (${a.outcome})${a.created_at ? ` at ${a.created_at}` : ""} — content in Chat History above ---`);
        continue;
      }
      let sizeSegment = "";
      if (a.char_count_original && a.char_count_result) {
        sizeSegment = `, ${a.char_count_original.toLocaleString("en-US")}→${a.char_count_result.toLocaleString("en-US")} chars`;
      } else if (a.char_count_original) {
        sizeSegment = `, ${a.char_count_original.toLocaleString("en-US")} chars original`;
      }
      let sourceSegment = "";
      if (a.instruction_text) {
        const sourceMatch = a.instruction_text.match(/(?:\|\s*)?Source:\s*(.+?)$/);
        if (sourceMatch) {
          sourceSegment = `, source: ${sourceMatch[1].trim()}`;
        }
      }
      lines.push(`--- Action ${i + 1}: ${a.action_type} (${a.outcome})${sizeSegment}${sourceSegment} ---`);
    }
  }

  return lines.join("\n");
}
