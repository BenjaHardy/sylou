import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat } from "docx";
import { saveAs } from "file-saver";

/**
 * Convert TipTap HTML to DOCX by parsing the HTML in the browser
 * and mapping DOM nodes to docx.js elements.
 */
export async function exportWritingAsDocx(html: string, projectName: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const children = parseNodes(doc.body.childNodes);

  const docxDoc = new Document({
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: "\u2022",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          }],
        },
        {
          reference: "numbers",
          levels: [{
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          }],
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(docxDoc);
  saveAs(blob, `${projectName}.docx`);
}

function parseNodes(nodes: NodeListOf<ChildNode>): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  nodes.forEach((node) => {
    paragraphs.push(...nodeToDocx(node));
  });
  return paragraphs;
}

function nodeToDocx(node: ChildNode): Paragraph[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    if (!text.trim()) return [];
    return [new Paragraph({ children: [new TextRun(text)] })];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "h1":
      return [new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: getInlineRuns(el),
      })];
    case "h2":
      return [new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: getInlineRuns(el),
      })];
    case "h3":
      return [new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: getInlineRuns(el),
      })];
    case "p":
      return [new Paragraph({ children: getInlineRuns(el) })];
    case "blockquote": {
      const bqParagraphs: Paragraph[] = [];
      el.querySelectorAll("p").forEach((p) => {
        bqParagraphs.push(new Paragraph({
          indent: { left: 720 },
          children: getInlineRuns(p),
        }));
      });
      if (bqParagraphs.length === 0) {
        bqParagraphs.push(new Paragraph({
          indent: { left: 720 },
          children: getInlineRuns(el),
        }));
      }
      return bqParagraphs;
    }
    case "ul":
      return Array.from(el.children).flatMap((li) =>
        [new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: getInlineRuns(li as HTMLElement),
        })]
      );
    case "ol":
      return Array.from(el.children).flatMap((li) =>
        [new Paragraph({
          numbering: { reference: "numbers", level: 0 },
          children: getInlineRuns(li as HTMLElement),
        })]
      );
    case "pre":
      return [new Paragraph({
        children: [new TextRun({
          text: el.textContent || "",
          font: "Courier New",
          size: 20,
        })],
      })];
    case "hr":
      return [new Paragraph({
        border: { bottom: { style: "single" as any, size: 6, color: "999999", space: 1 } },
        children: [],
      })];
    default:
      return parseNodes(el.childNodes);
  }
}

function getInlineRuns(el: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || "";
      if (text) runs.push(new TextRun(text));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      const tag = childEl.tagName.toLowerCase();
      const text = childEl.textContent || "";
      if (!text) return;

      const opts: any = { text };
      if (tag === "strong" || tag === "b") opts.bold = true;
      if (tag === "em" || tag === "i") opts.italics = true;
      if (tag === "u") opts.underline = {};
      if (tag === "s" || tag === "del") opts.strike = true;
      if (tag === "code") opts.font = "Courier New";
      if (tag === "a") {
        opts.underline = {};
        opts.color = "0563C1";
      }

      // Handle nested formatting
      if (tag === "strong" || tag === "em" || tag === "u" || tag === "s" || tag === "del" || tag === "a" || tag === "code" || tag === "b" || tag === "i") {
        runs.push(new TextRun(opts));
      } else {
        // For spans and other inline elements, recurse
        runs.push(...getInlineRuns(childEl));
      }
    }
  });
  return runs;
}
