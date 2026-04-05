import { saveAs } from "file-saver";

export async function exportWritingAsDocx(html: string, projectName: string) {
  // Dynamic import to avoid crashing the module tree — html-to-docx
  // uses Node.js dependencies that may fail at static import time.
  const htmlToDocx = (await import("html-to-docx")).default;
  const blob = await htmlToDocx(html, null, {
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true,
  });
  saveAs(blob as Blob, `${projectName}.docx`);
}
