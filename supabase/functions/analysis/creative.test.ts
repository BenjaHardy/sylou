// analysis/creative.test.ts — output-shape pins for the creative-tools
// section of the FLOW prompt (P4-1 Phase D split). Note the deliberate
// differences from context-prompt/creative.ts's formatter (empty
// sentinel, fixed section order, HTML-stripping of descriptions/notes)
// — those differences are behavior, pinned here.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatCreativeDataForAnalysis } from "./creative.ts";

Deno.test("creative: empty input returns the '(No creative tools data)' sentinel", () => {
  assertEquals(formatCreativeDataForAnalysis([]), "(No creative tools data)");
  assertEquals(
    formatCreativeDataForAnalysis([{ tool_type: "worldbuilding", data: {} }]),
    "(No creative tools data)",
  );
});

Deno.test("creative: worldbuilding notes are HTML-stripped into [cat / subcat] lines", () => {
  const out = formatCreativeDataForAnalysis([{
    tool_type: "worldbuilding",
    data: {
      categories: [{
        name: "Places",
        notes: [
          { title: "The Keep", subcategory: "Castles", content: "<p>Old <b>stone</b>   walls</p>" },
          { title: "Empty", subcategory: "Castles", content: "<p></p>" },
        ],
      }],
    },
  }]);
  assert(out.includes("--- World-Building Notes ---"));
  assert(out.includes("[Places / Castles] The Keep: Old stone walls"));
  assert(!out.includes("Empty:"), "notes whose content strips to nothing are dropped");
});

Deno.test("creative: characters, traits, relationships with stripped notes", () => {
  const out = formatCreativeDataForAnalysis([{
    tool_type: "characters",
    data: {
      characters: [
        { id: "a", name: "Ada", description: "<em>engineer</em>", traits: ["sharp", "wry"] },
        { id: "b", name: "Brin", description: "", traits: [] },
      ],
      relationships: [{ from_id: "a", to_id: "b", type_id: "t1", notes: "<p>old friends</p>" }],
      relationshipTypes: [{ id: "t1", label: "ally" }],
    },
  }]);
  assert(out.includes("--- Character Diagram ---"));
  assert(out.includes("- Ada: engineer [Traits: sharp, wry]"));
  assert(out.includes("- Brin"));
  assert(out.includes("Ada → Brin (ally) — old friends"));
});

Deno.test("creative: timeline sorts by order and resolves character names via the diagram", () => {
  const out = formatCreativeDataForAnalysis([
    {
      tool_type: "timeline",
      data: {
        events: [
          { title: "Fall", date: "Year 2", description: "", order: 2, character_ids: ["a"] },
          { title: "Rise", date: "", description: "<p>it begins</p>", order: 1, character_ids: [] },
        ],
      },
    },
    {
      tool_type: "characters",
      data: { characters: [{ id: "a", name: "Ada", description: "", traits: [] }], relationships: [], relationshipTypes: [] },
    },
  ]);
  const rise = out.indexOf("- Rise: it begins");
  const fall = out.indexOf("- [Year 2] Fall");
  assert(rise !== -1 && fall !== -1 && rise < fall, "events must sort by order");
  assert(out.includes("[Characters: Ada]"));
});

Deno.test("creative: section order is fixed worldbuilding → characters → timeline regardless of row order", () => {
  const rows = [
    { tool_type: "timeline", data: { events: [{ title: "T", date: "", description: "", order: 1, character_ids: [] }] } },
    { tool_type: "characters", data: { characters: [{ id: "a", name: "Ada", description: "", traits: [] }], relationships: [], relationshipTypes: [] } },
    { tool_type: "worldbuilding", data: { categories: [{ name: "W", notes: [{ title: "N", subcategory: "S", content: "x" }] }] } },
  ];
  const out = formatCreativeDataForAnalysis(rows);
  const wb = out.indexOf("--- World-Building Notes ---");
  const ch = out.indexOf("--- Character Diagram ---");
  const tl = out.indexOf("--- Timeline ---");
  assert(wb !== -1 && ch !== -1 && tl !== -1 && wb < ch && ch < tl);
});
