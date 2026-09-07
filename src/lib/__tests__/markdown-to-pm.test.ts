// Tests for the markdown → ProseMirror parser (P4-5).
//
// Accepted AI proposals travel through this module into the editor
// (WritingEditor.handleAcceptProposal); a mis-mapped token silently turns
// structured content into literal markdown characters in the user's
// writing. The parser is bound to the editor's REAL schema, so these tests
// build the same StarterKit editor the app uses.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { sylouStarterKit } from "@/lib/editor-extensions/sylou-starter";
import { buildEditorMarkdownParser, parseMarkdownToFragment } from "@/lib/markdown-to-pm";

let editor: Editor | null = null;

function makeParser() {
  // WritingEditor's StarterKit configuration (parity with the app's schema).
  editor = new Editor({ extensions: sylouStarterKit() });
  return buildEditorMarkdownParser(editor.schema);
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

type NodeJSON = { type: string; attrs?: Record<string, unknown>; content?: NodeJSON[]; marks?: { type: string }[]; text?: string };

describe("parseMarkdownToFragment", () => {
  it("parses plain text into a paragraph", () => {
    const frag = parseMarkdownToFragment(makeParser(), "hello world") as NodeJSON[];
    expect(frag).toHaveLength(1);
    expect(frag[0].type).toBe("paragraph");
    expect(frag[0].content?.[0].text).toBe("hello world");
  });

  it("maps headings with their level", () => {
    const frag = parseMarkdownToFragment(makeParser(), "## Section title") as NodeJSON[];
    expect(frag[0].type).toBe("heading");
    expect(frag[0].attrs?.level).toBe(2);
  });

  it("maps bold and italic to TipTap's mark names (bold/italic, not strong/em)", () => {
    const frag = parseMarkdownToFragment(makeParser(), "**bold** and *ital*") as NodeJSON[];
    const texts = frag[0].content ?? [];
    expect(texts[0].marks?.map((m) => m.type)).toEqual(["bold"]);
    const italic = texts.find((t) => t.text === "ital");
    expect(italic?.marks?.map((m) => m.type)).toEqual(["italic"]);
  });

  it("maps bullet lists to camelCase bulletList/listItem nodes", () => {
    const frag = parseMarkdownToFragment(makeParser(), "- one\n- two") as NodeJSON[];
    expect(frag[0].type).toBe("bulletList");
    expect(frag[0].content?.map((n) => n.type)).toEqual(["listItem", "listItem"]);
  });

  it("maps ordered lists and preserves a non-default start", () => {
    const frag = parseMarkdownToFragment(makeParser(), "3. third\n4. fourth") as NodeJSON[];
    expect(frag[0].type).toBe("orderedList");
    expect(frag[0].attrs?.start).toBe(3);
  });

  it("maps fenced code blocks", () => {
    const frag = parseMarkdownToFragment(makeParser(), "```\nconst x = 1;\n```") as NodeJSON[];
    expect(frag[0].type).toBe("codeBlock");
    expect(frag[0].content?.[0].text).toBe("const x = 1;");
  });

  it("image-bearing markdown takes the null → raw-text fallback path", () => {
    // The module header suggests images are silently dropped, but in
    // practice the ignored inline token makes the parse fail and the
    // function returns null — which WritingEditor handles via its
    // documented raw-text fallback. Pinned as-is (AI proposals shouldn't
    // contain images); if the drop path is ever fixed, update this test
    // and the fallback expectation together.
    expect(
      parseMarkdownToFragment(makeParser(), "before\n\n![alt](x.png)\n\nafter"),
    ).toBeNull();
  });

  it("empty input yields a single empty paragraph, not null", () => {
    // A ProseMirror doc always contains at least one block, so the
    // "empty document → null" branch is only reachable via a parse throw.
    const frag = parseMarkdownToFragment(makeParser(), "") as NodeJSON[];
    expect(frag).toHaveLength(1);
    expect(frag[0].type).toBe("paragraph");
    expect(frag[0].content).toBeUndefined();
  });
});
