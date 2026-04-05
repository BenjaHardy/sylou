import htmlToDocx from "html-to-docx";
import { saveAs } from "file-saver";

export async function exportWritingAsDocx(html: string, projectName: string) {
  const blob = await htmlToDocx(html, null, {
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true,
  });
  saveAs(blob as Blob, `${projectName}.docx`);
}
