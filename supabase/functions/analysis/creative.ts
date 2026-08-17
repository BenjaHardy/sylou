// analysis/creative.ts — creative-tools formatting for the FLOW prompt
// (P4-1 Phase D split; moved verbatim from index.ts — byte-hash-verified
// at extraction; the only diff is the one export keyword).
//
// stripHtmlDeno stays private to this module: its only callers are in
// formatCreativeDataForAnalysis (the similarity pipeline strips HTML in
// _shared/_similarity.ts with deliberately different semantics — tags
// become spaces there, and entities are decoded; do not swap one for the
// other). context-prompt/creative.ts carries a byte-identical twin of
// stripHtmlDeno plus a DIFFERENT creative formatter (chat-summary
// flavour) — the cross-function dedupe is a tracked backlog item,
// deliberately not part of this split.

// ---------------------------------------------------------------------------
// Creative data formatting for FLOW analysis
// ---------------------------------------------------------------------------

function stripHtmlDeno(html: string): string {
  if (!html) return "";
  // No DOMParser global in the Deno/Supabase edge runtime (browser-only API),
  // so a DOM-parse branch throws on every call — regex-strip is what runs.
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function formatCreativeDataForAnalysis(
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
