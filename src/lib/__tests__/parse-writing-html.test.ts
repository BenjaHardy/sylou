import { describe, expect, it } from "vitest";
import { parseWritingHtml } from "@/lib/parse-writing-html";

describe("parseWritingHtml: frozen writing is parsed inertly", () => {
  it("parses into a standalone document, not the live one", () => {
    const body = parseWritingHtml("<p>hello world</p>");
    // A node created with document.createElement keeps the live document as
    // its owner (so its markup can load/run); the inert parse must not.
    expect(body.ownerDocument).not.toBe(document);
    expect(body.textContent).toBe("hello world");
  });

  it("drops event-handler attributes while preserving the text structure", () => {
    const body = parseWritingHtml('<p>before<img src="data:," onerror="handler()">after</p>');
    expect(body.querySelector("img")?.getAttribute("onerror")).toBeNull();
    // Structure preserved, so the provenance offsets are unaffected.
    expect(body.textContent).toBe("beforeafter");
  });
});
