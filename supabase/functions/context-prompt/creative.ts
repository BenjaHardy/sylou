// context-prompt/creative.ts — creative-tools data formatting
// (P4-1 Phase D split; moved verbatim from index.ts).
//
// Formats project_creative_data rows (world-building notes, character
// diagrams, timelines) into the "=== CREATIVE WRITING TOOLS ===" text
// block that feeds buildSummaryPrompt's creativeDataSection parameter.
// Pure functions of their arguments; zero imports.
//
// NOTE: analysis/creative.ts carries its own stripHtmlDeno twin and its own
// creative formatting — cross-function dedupe is a tracked backlog item,
// deliberately not part of this split.

function stripHtmlDeno(html: string): string {
  if (!html) return "";
  // No DOMParser global in the Deno/Supabase edge runtime (browser-only API),
  // so a DOM-parse branch throws on every call — regex-strip is what runs.
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function formatCreativeDataForSummary(
  creativeRows: Array<{ tool_type: string; data: Record<string, unknown> }>
): string {
  if (!creativeRows || creativeRows.length === 0) return "";

  const sections: string[] = [];

  for (const row of creativeRows) {
    if (row.tool_type === "worldbuilding") {
      const cats = (row.data as any)?.categories as Array<{
        name: string;
        notes: Array<{ title: string; subcategory: string; content: string }>;
      }> ?? [];
      if (cats.length === 0) continue;
      const lines = ["--- World-Building Notes ---"];
      for (const cat of cats) {
        for (const note of (cat.notes ?? [])) {
          const text = stripHtmlDeno(note.content);
          if (text) {
            lines.push(`[${cat.name} / ${note.subcategory}] ${note.title}: ${text}`);
          }
        }
      }
      if (lines.length > 1) sections.push(lines.join("\n"));
    }

    if (row.tool_type === "characters") {
      const chars = (row.data as any)?.characters as Array<{
        id: string; name: string; description: string; traits: string[];
      }> ?? [];
      const rels = (row.data as any)?.relationships as Array<{
        from_id: string; to_id: string; type_id: string; notes: string;
      }> ?? [];
      const relTypes = (row.data as any)?.relationshipTypes as Array<{
        id: string; label: string;
      }> ?? [];
      if (chars.length === 0) continue;

      const nameMap = new Map(chars.map(c => [c.id, c.name]));
      const lines = ["--- Character Diagram ---"];
      for (const c of chars) {
        let line = `- ${c.name}`;
        if (c.description) line += `: ${c.description}`;
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
          if (r.notes) line += ` — ${r.notes}`;
          lines.push(line);
        }
      }
      sections.push(lines.join("\n"));
    }

    if (row.tool_type === "timeline") {
      const events = (row.data as any)?.events as Array<{
        title: string; date: string; description: string; order: number;
        character_ids: string[];
      }> ?? [];
      if (events.length === 0) continue;

      // Need character names from characters row
      const charsRow = creativeRows.find(r => r.tool_type === "characters");
      const chars = (charsRow?.data as any)?.characters as Array<{ id: string; name: string }> ?? [];
      const nameMap = new Map(chars.map(c => [c.id, c.name]));

      const sorted = [...events].sort((a, b) => a.order - b.order);
      const lines = ["--- Timeline ---"];
      for (const e of sorted) {
        let line = `- ${e.date ? `[${e.date}] ` : ""}${e.title}`;
        if (e.description) line += `: ${e.description}`;
        if (e.character_ids?.length) {
          const names = e.character_ids.map(id => nameMap.get(id) ?? "?").join(", ");
          line += ` [Characters: ${names}]`;
        }
        lines.push(line);
      }
      sections.push(lines.join("\n"));
    }
  }

  if (sections.length === 0) return "";
  return "\n\n=== CREATIVE WRITING TOOLS ===\n\n" + sections.join("\n\n");
}
