// analysis/docs-budget.ts — the 3-tier imported-documents decision
// (P4-1 Phase D split; the tier-selection block lifted verbatim from
// index.ts — body hash in the commit msg; the only change is the
// function wrapper returning what were three handler-scope lets).
//
// Tiers (2026-07 maintainer decision, P3-7d): full text if it fits the
// allowance, else summaries if those fit, else exclude with a titles-only
// notice. The allowance itself — min(cost-policy ceiling, window
// remainder x0.8) — is computed by the caller (it needs the model's
// context window, output reserve and assembled base-prompt size) and
// arrives here as docsAllowanceChars. Writing, chat and creative content
// are NEVER truncated; only the docs allowance squeezes (possibly to <=0,
// which lands in the excluded tier). The tier notices below are prompt
// text — docs-budget.test.ts pins the tier boundaries and notice shapes.

/** Shape of the imported_documents rows the handler fetches. */
export interface ImportedDocRow {
  id: string;
  file_name: string;
  extracted_text: string | null;
  summary: string | null;
  file_size_bytes: number | null;
}

export interface ImportedDocsDecision {
  section: string;
  mode: "full_text" | "summaries" | "excluded" | "none";
  totalChars: number;
}

export function resolveImportedDocs(
  importedDocs: ImportedDocRow[],
  docsAllowanceChars: number,
): ImportedDocsDecision {
  let importedDocsSection = "";
  let importedDocsMode: "full_text" | "summaries" | "excluded" | "none" = "none";
  let importedDocsTotalChars = 0;

  if (importedDocs.length > 0) {
    // Calculate full text size
    const fullTextEntries = importedDocs.map(d => {
      const text = d.extracted_text ?? "(no text extracted)";
      importedDocsTotalChars += text.length;
      return `--- ${d.file_name} ---\n${text}`;
    });
    const fullTextSection = fullTextEntries.join("\n\n");

    // Calculate summary size
    const summaryEntries = importedDocs.map(d => {
      const sum = d.summary ?? "(no summary available)";
      return `--- ${d.file_name} ---\n${sum}`;
    });
    const summarySection = summaryEntries.join("\n\n");

    if (fullTextSection.length <= docsAllowanceChars) {
      // Tier 1: full text fits
      importedDocsMode = "full_text";
      importedDocsSection = fullTextSection;
    } else if (summarySection.length <= docsAllowanceChars) {
      // Tier 2: summaries fit
      importedDocsMode = "summaries";
      const wordEstimate = Math.round(importedDocsTotalChars / 5);
      importedDocsSection = `Note: The full text of imported documents (~${wordEstimate.toLocaleString()} words total) exceeded the space available for imported documents in this analysis. Summaries are provided instead.\n\n${summarySection}`;
    } else {
      // Tier 3: exclude
      importedDocsMode = "excluded";
      const wordEstimate = Math.round(importedDocsTotalChars / 5);
      importedDocsSection = `Note: ${importedDocs.length} imported document(s) (~${wordEstimate.toLocaleString()} words total) were excluded from this analysis because they exceed the space available for imported documents, even as summaries. The documents' titles are: ${importedDocs.map(d => `"${d.file_name}"`).join(", ")}.`;
    }
  } else {
    importedDocsSection = "None";
  }

  return {
    section: importedDocsSection,
    mode: importedDocsMode,
    totalChars: importedDocsTotalChars,
  };
}
