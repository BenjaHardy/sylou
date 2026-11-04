// extract-text/index.test.ts — the extract-text handler over HTTP: CORS, the
// token check, which document and file it reads, which files it refuses
// before parsing, the text and summary it saves, and the model and billing
// of an imported document's summary.
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import JSZip from "npm:jszip@3.10.2";
import { DEFAULT_CHAT_MODEL } from "../_shared/_models.ts";
import {
  type DbCall,
  type DbResult,
  fakeBackend,
  fakeEnv,
  fakeProvider,
  importHandler,
  jsonReply,
  post,
  preflight,
  TEST_ORIGIN,
  UNLISTED_MODEL,
  writes,
} from "../_shared/_test_support.ts";

const { handler } = await importHandler(() => import("./index.ts"));

const MODEL = "mistral-small-2603";
const IMPORT = { file_path: "u-1/p-1/notes.txt", project_id: "p-1", document_id: "d-1" };
// Over the 500-character threshold, so the document gets an AI summary.
const NOTES = "Field notes on the estuary. ".repeat(30);
const SUMMARY = "Notes on the estuary.";

interface World {
  /** Profile overrides. */
  profile?: Record<string, unknown>;
  /** The stored file; NOTES as text unless given. */
  file?: Blob;
  /** The project of document d-1 as the caller's client sees it; null when RLS hides the row. */
  documentProject?: string | null;
  /** The download fails. */
  failDownload?: boolean;
  /** The update of the document fails. */
  failUpdate?: boolean;
}

/** User u-1's document d-1 in project p-1, stored as `file`. */
function world(w: World) {
  return (call: DbCall): DbResult | undefined => {
    switch (`${call.client} ${call.target}`) {
      case "user imported_documents": {
        const project = w.documentProject === undefined ? "p-1" : w.documentProject;
        return { data: project === null ? null : { id: "d-1", project_id: project }, error: null };
      }
      case "user storage:imports":
        return w.failDownload
          ? { data: null, error: { message: "Object not found" } }
          : { data: w.file ?? new Blob([NOTES]), error: null };
      case "user profiles":
        return { data: { preferred_chat_model: MODEL, ...w.profile }, error: null };
      case "admin imported_documents":
        return { data: null, error: w.failUpdate ? { message: "update denied" } : null };
    }
    return undefined;
  };
}

/** A one-page PDF showing `text` (no parentheses or backslashes) in Helvetica. */
function pdfWith(text: string): Blob {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([pdf]);
}

/** A .docx with one paragraph per entry. */
async function docxWith(...paragraphs: string[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${
      paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")
    }</w:body></w:document>`,
  );
  return new Blob([await zip.generateAsync({ type: "arraybuffer" })]);
}

async function send(
  req: Request,
  opts: World & {
    user?: { id: string } | null;
    replies?: Response[];
    env?: Record<string, string | undefined>;
  } = {},
) {
  const backend = fakeBackend({
    user: opts.user === undefined ? { id: "u-1" } : opts.user,
    respond: world(opts),
  });
  const provider = fakeProvider(...(opts.replies ?? []));
  const res = await handler(req, {
    env: fakeEnv(opts.env),
    createClient: backend.createClient,
    callLLM: provider.callLLM,
  });
  return { res, backend, provider };
}

const usageRow = (backend: ReturnType<typeof fakeBackend>) =>
  writes(backend.calls).find(([, table]) => table === "token_usage")?.[2] as Record<string, unknown> | undefined;

const savedText = (backend: ReturnType<typeof fakeBackend>) =>
  (writes(backend.calls).find(([, table]) => table === "imported_documents")?.[2] as
    | { extracted_text?: string }
    | undefined)?.extracted_text;

const clientsBuilt = (backend: ReturnType<typeof fakeBackend>) => backend.created.map((c) => c.client);

/** The summary when no AI summary was made: the text's first 500 characters. */
const FALLBACK_SUMMARY = `${NOTES.slice(0, 500)}...`;

// ── CORS and the token check ─────────────────────────────────────────────

Deno.test("preflight from the allowed origin: CORS headers, and no client is built", async () => {
  const { res, backend } = await send(preflight());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(backend.created, []);
});

Deno.test("no bearer token: 401 before any client is built", async () => {
  for (const authorization of [null, "Basic dXNlcjpwYXNz"]) {
    const { res, backend } = await send(post(IMPORT, { authorization }));
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: "Missing authorization" });
    assertEquals(backend.created, []);
  }
});

Deno.test("a token Supabase Auth rejects: 401; only the user-scoped client checked it", async () => {
  const { res, backend, provider } = await send(post(IMPORT), { user: null });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Unauthorized" });
  assertEquals(backend.created, [{ client: "user", authorization: "Bearer user-jwt" }]);
  assertEquals(backend.calls.map((c) => `${c.client} ${c.target}`), ["user auth:getUser"]);
  assertEquals(provider.calls.length, 0);
});

// ── Extraction and the file checks ───────────────────────────────────────

Deno.test("a PDF: its text is extracted and saved", async () => {
  const { res, backend } = await send(post({ ...IMPORT, file_path: "u-1/p-1/paper.pdf" }), {
    file: pdfWith("Hello from a PDF."),
  });
  assertEquals(res.status, 200);
  assertEquals(savedText(backend), "Hello from a PDF.");
});

Deno.test("a DOCX: its text is extracted and saved", async () => {
  const { res, backend } = await send(post({ ...IMPORT, file_path: "u-1/p-1/draft.docx" }), {
    file: await docxWith("Hello from a DOCX.", "Second paragraph."),
  });
  assertEquals(res.status, 200);
  assertEquals(savedText(backend), "Hello from a DOCX.\n\nSecond paragraph.\n\n");
});

Deno.test("an unsupported file type: 400 before any lookup", async () => {
  const { res, backend } = await send(post({ ...IMPORT, file_path: "u-1/p-1/tool.exe" }));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Unsupported file type: .exe" });
  assertEquals(backend.calls.map((c) => c.target), ["auth:getUser"]);
});

Deno.test("a file over 10 MB: 413 before parsing, nothing saved", async () => {
  const { res, backend, provider } = await send(post({ ...IMPORT, file_path: "u-1/p-1/paper.pdf" }), {
    file: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]),
  });
  assertEquals(res.status, 413);
  assertEquals(await res.json(), { error: "File too large" });
  assertEquals(writes(backend.calls), []);
  assertEquals(provider.calls.length, 0);
});

const MISLABELLED: [string, string, string][] = [
  ["a .pdf that is not a PDF", "u-1/p-1/paper.pdf", "Plain text under a .pdf name."],
  ["a .docx that is not a ZIP archive", "u-1/p-1/draft.docx", "%PDF-1.4 a PDF under a .docx name"],
];

for (const [label, file_path, content] of MISLABELLED) {
  Deno.test(`${label}: 415 before parsing, nothing saved`, async () => {
    const { res, backend, provider } = await send(post({ ...IMPORT, file_path }), { file: new Blob([content]) });
    assertEquals(res.status, 415);
    assertEquals(await res.json(), { error: "File content does not match its type" });
    assertEquals(writes(backend.calls), []);
    assertEquals(provider.calls.length, 0);
  });
}

// ── Which document and file ──────────────────────────────────────────────

Deno.test("the file is read with the caller's own client, from the path the request names", async () => {
  const { res, backend } = await send(post(IMPORT), { replies: [jsonReply({ content: SUMMARY })] });
  assertEquals(res.status, 200);
  assertEquals(backend.calls.filter((c) => c.target.startsWith("storage:")), [
    { client: "user", target: "storage:imports", steps: [["download", IMPORT.file_path]] },
  ]);
});

// Each names a file outside u-1's folder for project p-1, as written or
// once the download URL resolves it.
const FOREIGN_PATHS: [string, string][] = [
  ["a path in another user's folder", "u-2/p-1/notes.txt"],
  ["a path in another project's folder", "u-1/p-2/notes.txt"],
  ["a path with a parent-folder step", "u-1/../u-2/p-1/notes.txt"],
  ["a file name that decodes to a parent-folder step", "u-1/p-1/%2e%2E"],
  ["a file name with an encoded slash", "u-1/p-1/..%2Fnotes.txt"],
  ["a path with backslashes", "u-1/p-1/..\\..\\u-2\\notes.txt"],
  ["a file name with a control character", "u-1/p-1/.\t."],
];

for (const [label, file_path] of FOREIGN_PATHS) {
  Deno.test(`${label}: refused before any lookup`, async () => {
    const { res, backend, provider } = await send(post({ ...IMPORT, file_path }));
    assertEquals(res.status, 403);
    assertEquals(await res.json(), { error: "Forbidden: file path does not belong to caller" });
    assertEquals(backend.calls.map((c) => c.target), ["auth:getUser"]);
    assertEquals(provider.calls.length, 0);
  });
}

Deno.test("a missing field: 400 before any lookup", async () => {
  for (const field of ["file_path", "project_id", "document_id"]) {
    const { res, backend } = await send(post({ ...IMPORT, [field]: undefined }));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: "file_path, project_id, and document_id are required" });
    assertEquals(backend.calls.map((c) => c.target), ["auth:getUser"]);
  }
});

Deno.test("a document RLS hides from the caller: 403 from the user-scoped lookup, before the download or a service-role client", async () => {
  const { res, backend, provider } = await send(post(IMPORT), { documentProject: null });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Forbidden: document not found or not owned" });
  assertEquals(backend.calls.find((c) => c.target === "imported_documents")?.client, "user");
  assertEquals(backend.calls.some((c) => c.target.startsWith("storage:")), false);
  assertEquals(clientsBuilt(backend), ["user"]);
  assertEquals(provider.calls.length, 0);
});

Deno.test("a document from another of the caller's projects: 403 before the download, nothing written", async () => {
  const { res, backend } = await send(post(IMPORT), { documentProject: "p-2" });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Forbidden: project_id mismatch" });
  assertEquals(backend.calls.some((c) => c.target.startsWith("storage:")), false);
  assertEquals(clientsBuilt(backend), ["user"]);
  assertEquals(writes(backend.calls), []);
});

Deno.test("a download that fails: 500, nothing saved and no provider call", async () => {
  const { res, backend, provider } = await send(post(IMPORT), { failDownload: true });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Failed to download file from storage" });
  assertEquals(writes(backend.calls), []);
  assertEquals(provider.calls.length, 0);
});

// ── The summary and the save ─────────────────────────────────────────────

Deno.test("the summary runs on the saved model when it is listed, and the usage row names it", async () => {
  const { res, backend, provider } = await send(post(IMPORT), { replies: [jsonReply({ content: SUMMARY })] });
  assertEquals(await res.json(), { success: true, text_length: NOTES.length, summary_length: SUMMARY.length });
  assertEquals(provider.calls.map((c) => c.model), [MODEL]);
  assertEquals(usageRow(backend)?.model_used, MODEL);
});

Deno.test("a saved model off the allowlist: the summary runs on the default model, and the usage row names it", async () => {
  const { res, backend, provider } = await send(post(IMPORT), {
    profile: { preferred_chat_model: UNLISTED_MODEL },
    env: { ANTHROPIC_API_KEY: "anthropic-key" },
    replies: [jsonReply({ content: SUMMARY })],
  });
  assertEquals(await res.json(), { success: true, text_length: NOTES.length, summary_length: SUMMARY.length });
  assertEquals(provider.calls.map((c) => c.model), [DEFAULT_CHAT_MODEL]);
  assertEquals(usageRow(backend)?.model_used, DEFAULT_CHAT_MODEL);
});

Deno.test("a summarised import: the text, summary, usage row and billing go through the service-role client, for d-1 and u-1", async () => {
  const { res, backend } = await send(post(IMPORT), { replies: [jsonReply({ content: SUMMARY })] });
  assertEquals(res.status, 200);
  const [usage, update] = writes(backend.calls);
  assertEquals(usage.slice(0, 2), ["admin", "token_usage"]);
  const { input_tokens, output_tokens, ...row } = usage[2] as Record<string, unknown>;
  assertEquals(row, { user_id: "u-1", project_id: "p-1", function_name: "extract-text", model_used: MODEL });
  assertEquals(update, ["admin", "imported_documents", { extracted_text: NOTES, summary: SUMMARY }]);
  const updateCall = backend.calls.find((c) => c.client === "admin" && c.target === "imported_documents");
  assertEquals(updateCall?.steps.filter(([step]) => step === "eq"), [["eq", "id", "d-1"]]);
  const billing = backend.calls.find((c) => c.target === "rpc:increment_tokens_used");
  assertEquals(billing?.client, "admin");
  assertEquals(billing?.steps[0][1], { user_uuid: "u-1", amount: Number(input_tokens) + Number(output_tokens) });
  assert(Number(input_tokens) > 0 && Number(output_tokens) > 0);
});

Deno.test("a short text is its own summary: no provider call, and only the document is updated", async () => {
  const { res, backend, provider } = await send(post(IMPORT), { file: new Blob(["Short notes."]) });
  assertEquals(await res.json(), { success: true, text_length: 12, summary_length: 12 });
  assertEquals(provider.calls.length, 0);
  assertEquals(writes(backend.calls), [
    ["admin", "imported_documents", { extracted_text: "Short notes.", summary: "Short notes." }],
  ]);
});

Deno.test("no key for the summary's provider: the text's first 500 characters, no provider call, nothing billed", async () => {
  const { res, backend, provider } = await send(post(IMPORT), { env: { MISTRAL_API_KEY: undefined } });
  assertEquals(res.status, 200);
  assertEquals(provider.calls.length, 0);
  assertEquals(writes(backend.calls), [
    ["admin", "imported_documents", { extracted_text: NOTES, summary: FALLBACK_SUMMARY }],
  ]);
  assertEquals(backend.calls.some((c) => c.target === "rpc:increment_tokens_used"), false);
});

Deno.test("a provider error: the text's first 500 characters, nothing billed", async () => {
  const { res, backend } = await send(post(IMPORT), {
    replies: [Response.json({ message: "Overloaded" }, { status: 503 })],
  });
  assertEquals(res.status, 200);
  assertEquals(writes(backend.calls), [
    ["admin", "imported_documents", { extracted_text: NOTES, summary: FALLBACK_SUMMARY }],
  ]);
  assertEquals(backend.calls.some((c) => c.target === "rpc:increment_tokens_used"), false);
});

Deno.test("the document update fails: 500", async () => {
  const { res } = await send(post(IMPORT), { replies: [jsonReply({ content: SUMMARY })], failUpdate: true });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Failed to save extracted text" });
});
