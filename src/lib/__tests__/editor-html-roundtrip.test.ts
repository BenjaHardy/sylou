// Editor HTML round-trip fixture — the TipTap v3 migration gate.
//
// All user writing is stored as serialized editor HTML (writing_content),
// and two consumers do position arithmetic against that exact shape: the
// client provenance tracker (PM positions on the parsed doc) and the
// server-side _provenance.ts classifier (walks the serialized HTML by
// element inventory). If an editor upgrade changes how stored HTML parses
// or how the doc serializes back, documents silently rewrite themselves on
// the first open-and-save and provenance offsets drift.
//
// These entries pin the CANONICAL serialization of TipTap v2.27.2 with the
// exact schema-shaping extension set WritingEditor mounts (StarterKit with
// heading levels 1-3, Underline, Link, TextAlign, TextStyle, Color, custom
// FontSize). CharacterCount / Placeholder / Pagination are omitted: they
// are counting/decoration extensions and never appear in getHTML() output.
//
// A red test here after a TipTap bump means the serialization contract
// moved — that needs a checkpoint (what changed, whether stored documents
// re-serialize differently, whether _provenance.ts still classifies
// correctly), never a casual re-pin.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Editor } from "@tiptap/core";
import { sylouStarterKit } from "@/lib/editor-extensions/sylou-starter";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { FontSize } from "@/lib/tiptap-font-size";

let editor: Editor;

beforeAll(() => {
  editor = new Editor({
    extensions: [
      // Mirrors WritingEditor exactly (same helper, same options).
      ...sylouStarterKit({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle.configure({ mergeNestedSpanStyles: false }),
      Color,
      FontSize,
    ],
  });
});

afterAll(() => {
  editor.destroy();
});

function roundTrip(html: string): string {
  editor.commands.setContent(html);
  return editor.getHTML();
}

// ── Canonical forms: parse → serialize must be the identity ─────────────
// Each entry is exactly what v2.27.2 emits for that structure; the test
// both proves the pin is a fixed point and freezes it for v3 to match.

const CANONICAL: Array<{ name: string; html: string }> = [
  { name: "plain paragraph", html: "<p>Hello world</p>" },
  { name: "empty document", html: "<p></p>" },
  {
    name: "headings 1-3",
    html: "<h1>Title</h1><h2>Section</h2><h3>Subsection</h3>",
  },
  {
    name: "bold, italic, strike",
    html: "<p><strong>bold</strong> and <em>italic</em> and <s>struck</s></p>",
  },
  { name: "underline mark", html: "<p><u>underlined</u></p>" },
  { name: "inline code", html: "<p>run <code>deno task test</code> now</p>" },
  {
    name: "link with default attrs",
    html: '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/">a link</a></p>',
  },
  // Style attributes below carry CSSOM-normalized values (trailing
  // semicolon, hex → rgb()): TipTap writes `style` through the element's
  // style property, and browsers (and jsdom) serialize it back normalized.
  // Stored writing_content therefore holds these normalized forms.
  {
    name: "paragraph alignment (center)",
    html: '<p style="text-align: center;">centered</p>',
  },
  {
    name: "heading alignment (right)",
    html: '<h2 style="text-align: right;">right-aligned</h2>',
  },
  {
    name: "explicit left alignment is preserved (not dropped as default)",
    html: '<p style="text-align: left;">left is kept</p>',
  },
  {
    name: "text color span (rgb form)",
    html: '<p><span style="color: rgb(180, 83, 9);">amber text</span></p>',
  },
  {
    name: "font-size span",
    html: '<p><span style="font-size: 20px;">bigger text</span></p>',
  },
  {
    name: "color + font-size on one span",
    html: '<p><span style="color: rgb(180, 83, 9); font-size: 20px;">styled</span></p>',
  },
  {
    name: "bullet list (items wrap paragraphs)",
    html: "<ul><li><p>one</p></li><li><p>two</p></li></ul>",
  },
  {
    name: "ordered list with non-default start",
    html: '<ol start="3"><li><p>three</p></li><li><p>four</p></li></ol>',
  },
  {
    name: "nested list",
    html: "<ul><li><p>outer</p><ul><li><p>inner</p></li></ul></li></ul>",
  },
  { name: "blockquote", html: "<blockquote><p>quoted words</p></blockquote>" },
  { name: "code block", html: "<pre><code>const x = 1;</code></pre>" },
  { name: "horizontal rule", html: "<p>above</p><hr><p>below</p>" },
  { name: "hard break", html: "<p>line one<br>line two</p>" },
  {
    name: "marks nested inside a link",
    html: '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/"><strong>bold link</strong></a></p>',
  },
  {
    name: "three nested marks (schema mark rank decides the nesting order)",
    html: "<p><strong><em><u>all three</u></em></strong></p>",
  },
  { name: "non-breaking space entity", html: "<p>a&nbsp;b</p>" },
  {
    name: "code block with a language class",
    html: '<pre><code class="language-ts">const x = 1;</code></pre>',
  },
  { name: "paragraph holding only a hard break", html: "<p><br></p>" },
  {
    name: "kitchen sink",
    html:
      '<h1>Doc</h1><p style="text-align: center;">A <strong>bold</strong>, <em>italic</em>, <u>underlined</u> <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/">link</a></p><ul><li><p><span style="color: rgb(180, 83, 9);">colored</span> item</p></li></ul><blockquote><p><span style="font-size: 14px;">small quote</span></p></blockquote><pre><code>code();</code></pre><hr><p>end</p>',
  },
];

// ── Legacy/loose inputs: normalization must stay stable ─────────────────
// Older or hand-authored HTML forms that the schema rewrites on parse.
// v3 must normalize these to the SAME canonical output, or stored legacy
// content would rewrite differently after the upgrade.

const NORMALIZED: Array<{ name: string; input: string; expected: string }> = [
  {
    name: "b/i tags normalize to strong/em",
    input: "<p><b>bold</b> and <i>italic</i></p>",
    expected: "<p><strong>bold</strong> and <em>italic</em></p>",
  },
  {
    name: "strike tag normalizes to s",
    input: "<p><strike>old</strike></p>",
    expected: "<p><s>old</s></p>",
  },
  {
    name: "bare list item text gains a paragraph",
    input: "<ul><li>bare</li></ul>",
    expected: "<ul><li><p>bare</p></li></ul>",
  },
  {
    name: "unknown block tags flatten to their text",
    input: "<div><p>kept</p></div>",
    expected: "<p>kept</p>",
  },
  {
    name: "un-normalized style gains CSSOM form (trailing semicolon)",
    input: '<p style="text-align: center">center</p>',
    expected: '<p style="text-align: center;">center</p>',
  },
  {
    name: "hex color normalizes to rgb()",
    input: '<p><span style="color: #b45309">amber</span></p>',
    expected: '<p><span style="color: rgb(180, 83, 9);">amber</span></p>',
  },
  {
    name: "heading levels beyond the schema (h4) parse as paragraphs",
    input: "<h4>too deep</h4>",
    expected: "<p>too deep</p>",
  },
  {
    name: "empty list item gains an empty paragraph",
    input: "<ul><li></li></ul>",
    expected: "<ul><li><p></p></li></ul>",
  },
  {
    name: "unsupported alignment value (start) is dropped",
    input: '<p style="text-align: start">x</p>',
    expected: "<p>x</p>",
  },
  {
    // v2 parse semantics kept via TextStyle mergeNestedSpanStyles: false —
    // v3's default would merge the outer color into the inner span.
    name: "nested styled spans keep v2 parsing (no style merge)",
    input: '<p><span style="color: #b45309"><span style="font-size: 20px">x</span></span></p>',
    expected: '<p><span style="font-size: 20px;">x</span></p>',
  },
];

describe("editor HTML round-trip (v2 canonical serialization pins)", () => {
  for (const { name, html } of CANONICAL) {
    it(`canonical: ${name}`, () => {
      expect(roundTrip(html)).toBe(html);
    });
  }

  for (const { name, input, expected } of NORMALIZED) {
    it(`normalizes: ${name}`, () => {
      expect(roundTrip(input)).toBe(expected);
      // The normalized form must itself be a fixed point.
      expect(roundTrip(expected)).toBe(expected);
    });
  }
});
