/**
 * Markdown → ProseMirror parser bound to the editor's actual schema
 * (TipTap StarterKit + extensions), not prosemirror-markdown's default
 * CommonMark schema.
 *
 * Why a custom parser?
 *   prosemirror-markdown's `defaultMarkdownParser` is constructed against
 *   the default CommonMark schema, which uses snake_case node names
 *   (bullet_list, list_item, ordered_list, code_block, hard_break) and
 *   marks (em, strong). TipTap's StarterKit uses camelCase names
 *   (bulletList, listItem, orderedList, codeBlock, hardBreak) and
 *   different mark names (italic, bold). Using the default parser would
 *   produce nodes TipTap rejects.
 *
 * This module builds a MarkdownParser whose token map points at whatever
 * nodes/marks actually exist in the supplied schema. Tokens for nodes or
 * marks missing from the schema are silently dropped (e.g. `image` is
 * skipped because the editor doesn't load Image).
 */

import MarkdownIt from "markdown-it";
import { MarkdownParser, type ParseSpec } from "prosemirror-markdown";
import type { Schema, Node as PMNode } from "prosemirror-model";

/** Build a MarkdownParser bound to the given TipTap/ProseMirror schema. */
export function buildEditorMarkdownParser(schema: Schema): MarkdownParser {
  const hasNode = (name: string) => Object.prototype.hasOwnProperty.call(schema.nodes, name);
  const hasMark = (name: string) => Object.prototype.hasOwnProperty.call(schema.marks, name);

  const tokens: Record<string, ParseSpec> = {};

  // Blocks
  if (hasNode("blockquote")) tokens.blockquote = { block: "blockquote" };
  if (hasNode("paragraph")) tokens.paragraph = { block: "paragraph" };
  if (hasNode("listItem")) tokens.list_item = { block: "listItem" };
  if (hasNode("bulletList")) tokens.bullet_list = { block: "bulletList" };
  if (hasNode("orderedList")) {
    tokens.ordered_list = {
      block: "orderedList",
      getAttrs: (tok) => {
        const startStr = tok.attrGet?.("start");
        const start = startStr ? parseInt(startStr, 10) : NaN;
        return { start: Number.isFinite(start) ? start : 1 };
      },
    };
  }
  if (hasNode("heading")) {
    tokens.heading = {
      block: "heading",
      getAttrs: (tok) => ({ level: parseInt(tok.tag.slice(1), 10) || 1 }),
    };
  }
  if (hasNode("codeBlock")) {
    tokens.code_block = { block: "codeBlock", noCloseToken: true };
    tokens.fence = {
      block: "codeBlock",
      getAttrs: (tok) => ({ language: tok.info || null }),
      noCloseToken: true,
    };
  }
  if (hasNode("horizontalRule")) tokens.hr = { node: "horizontalRule" };
  if (hasNode("hardBreak")) tokens.hardbreak = { node: "hardBreak" };

  // Image dropped intentionally — editor does not load an Image extension.
  tokens.image = { ignore: true };

  // Marks
  if (hasMark("italic")) tokens.em = { mark: "italic" };
  if (hasMark("bold")) tokens.strong = { mark: "bold" };
  if (hasMark("strike")) tokens.s = { mark: "strike" };
  if (hasMark("code")) tokens.code_inline = { mark: "code", noCloseToken: true };
  if (hasMark("link")) {
    tokens.link = {
      mark: "link",
      getAttrs: (tok) => ({
        href: tok.attrGet?.("href") ?? "",
        title: tok.attrGet?.("title") ?? null,
      }),
    };
  }

  const tokenizer = MarkdownIt("default", { html: false });

  return new MarkdownParser(schema, tokenizer, tokens);
}

/**
 * Parse markdown into a ProseMirror Node fragment-content array suitable
 * for TipTap's `insertContent(json)`. Returns null if parsing fails or
 * produces an empty document.
 *
 * The caller is responsible for the fallback behaviour on null.
 */
export function parseMarkdownToFragment(
  parser: MarkdownParser,
  markdown: string,
): ReturnType<PMNode["toJSON"]>[] | null {
  try {
    const doc = parser.parse(markdown);
    const json = doc.toJSON() as { content?: ReturnType<PMNode["toJSON"]>[] };
    const content = json?.content;
    if (!content || content.length === 0) return null;
    return content;
  } catch (err) {
    console.warn(
      "prosemirror-markdown failed to parse AI output. Falling back to raw text insertion. " +
        "The inserted content may contain literal markdown characters that could affect FLOW analysis with Claude.",
      err,
    );
    return null;
  }
}
