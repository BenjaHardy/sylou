import DOMPurify from "dompurify";

/** Parse frozen writing HTML in a standalone, inert document (no resource
 *  loads, no handler execution), DOMPurify-sanitized first. Both steps keep
 *  the node structure, so TipTap position arithmetic over the result is
 *  unaffected. */
export function parseWritingHtml(html: string): HTMLElement {
  const clean = DOMPurify.sanitize(html);
  return new DOMParser().parseFromString(clean, "text/html").body;
}
