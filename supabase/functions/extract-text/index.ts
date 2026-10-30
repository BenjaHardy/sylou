import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import { callLLM, providerFor, normaliseResponse, envKeyFor } from "../_shared/_llm.ts";
import { CHAT_TEMPERATURE, resolveTemperature } from "../_shared/_temperatures.ts";
import { DEFAULT_CHAT_MODEL, OUTPUT_BUDGETS, resolveSavedModel } from "../_shared/_models.ts";
import { SUMMARY_TABLES, resolveMaxTokens, resolveReasoning } from "../_shared/_thinking.ts";
import { sliceSafe } from "../_shared/_text.ts";

// --- CORS allow-list (parsed once at module load) ---
import { makeCorsHeadersFor } from "../_shared/_cors.ts";
import type { HandlerDeps } from "../_shared/_handler.ts";

const corsHeadersFor = makeCorsHeadersFor("GET, POST, OPTIONS");

const defaultDeps: HandlerDeps = { env: Deno.env, createClient, callLLM };

/** The path useImportedDocuments uploads to: `<user id>/<project id>/<file name>`.
 *  The file name, also once percent-decoded, may hold no slash, backslash or
 *  control character and may not be "." or "..": the download URL would
 *  resolve any of them into another folder. */
function isOwnUploadPath(path: string, userId: string, projectId: string): boolean {
  const [owner, project, name, ...rest] = path.split("/");
  if (rest.length > 0 || owner !== userId || project !== projectId || !name) return false;
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // A malformed escape is left as written.
  }
  const unsafe = /[\\/\p{Cc}]/u;
  return !unsafe.test(name) && !unsafe.test(decoded) && decoded !== "." && decoded !== "..";
}

export const handler = async (req: Request, deps = defaultDeps): Promise<Response> => {
  const corsHeaders = corsHeadersFor(req);
  const jsonResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = deps.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = deps.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = deps.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = deps.createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // --- Parse body ---
    const body = await req.json();
    const { file_path, project_id, document_id } = body as {
      file_path: string;
      project_id: string;
      document_id: string;
    };

    if (!file_path || !project_id || !document_id) {
      return jsonResponse({ error: "file_path, project_id, and document_id are required" }, 400);
    }

    // --- Ownership validation ---
    // 1. Verify file_path is the caller's upload path in this project
    if (!isOwnUploadPath(file_path, user.id, project_id)) {
      return jsonResponse({ error: "Forbidden: file path does not belong to caller" }, 403);
    }

    // 2. Verify document_id belongs to caller via user-scoped client (RLS)
    const { data: ownedDoc, error: ownerErr } = await supabase
      .from("imported_documents")
      .select("id, project_id")
      .eq("id", document_id)
      .maybeSingle();

    if (ownerErr || !ownedDoc) {
      return jsonResponse({ error: "Forbidden: document not found or not owned" }, 403);
    }

    if (ownedDoc.project_id !== project_id) {
      return jsonResponse({ error: "Forbidden: project_id mismatch" }, 403);
    }

    // --- Download with the caller's client: storage RLS keeps it to their folder ---
    const { data: fileData, error: downloadErr } = await supabase.storage
      .from("imports")
      .download(file_path);

    if (downloadErr || !fileData) {
      console.error("Storage download error:", downloadErr);
      return jsonResponse({ error: "Failed to download file from storage" }, 500);
    }

    const adminSupabase = deps.createClient(supabaseUrl, serviceRoleKey);

    // --- Extract text based on file extension ---
    const ext = file_path.split(".").pop()?.toLowerCase() ?? "";
    let extractedText = "";

    if (ext === "txt" || ext === "md") {
      extractedText = await fileData.text();
    } else if (ext === "pdf") {
      try {
        const pdfParse = (await import("npm:pdf-parse@1.1.1/lib/pdf-parse.js")).default;
        const { Buffer } = await import("node:buffer");
        const buffer = Buffer.from(await fileData.arrayBuffer());
        const pdfData = await pdfParse(buffer);
        extractedText = pdfData.text || "";
      } catch (pdfErr) {
        console.error("PDF parse error:", pdfErr);
        return jsonResponse({ error: "Failed to parse PDF file" }, 500);
      }
    } else if (ext === "docx") {
      try {
        const mammoth = await import("https://esm.sh/mammoth@1.6.0");
        const { Buffer } = await import("node:buffer");
        const buffer = Buffer.from(await fileData.arrayBuffer());
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value || "";
      } catch (docxErr) {
        console.error("DOCX parse error:", docxErr);
        return jsonResponse({ error: "Failed to parse DOCX file" }, 500);
      }
    } else {
      return jsonResponse({ error: `Unsupported file type: .${ext}` }, 400);
    }

    // --- Generate summary ---
    let summary = "";
    const SHORT_TEXT_THRESHOLD = 500;

    if (extractedText.length <= SHORT_TEXT_THRESHOLD) {
      summary = extractedText;
    } else {
      // Summarize via the shared LLM router using the user's preferred
      // chat model. (Previously hard-coded to Mistral Large, which broke
      // document summaries on deployments without a Mistral key, e.g.
      // Anthropic-only.) Falls back to a plain-text truncation if the
      // chosen provider's key is unset or the call fails.
      const { data: profile } = await supabase
        .from("profiles")
        .select("preferred_chat_model")
        .eq("id", user.id)
        .single();
      const summaryModel = resolveSavedModel(profile?.preferred_chat_model, DEFAULT_CHAT_MODEL);
      const provider = providerFor(summaryModel);

      if (!deps.env.get(envKeyFor(provider))) {
        // Chosen provider's key isn't configured — degrade gracefully.
        summary = sliceSafe(extractedText, SHORT_TEXT_THRESHOLD) + "...";
      } else {
        const textForSummary = sliceSafe(extractedText, 10000);
        const summaryPrompt = `Summarize the following document in 3-5 sentences. Focus on the main topics, arguments, and conclusions. This summary will be used to help an AI assistant decide whether to read the full document when answering user questions.\n\n${textForSummary}`;

        try {
          const { thinking, effort, mistralEffort } = resolveReasoning(summaryModel, undefined, SUMMARY_TABLES);
          const llmRes = await deps.callLLM({
            model: summaryModel,
            messages: [{ role: "user" as const, content: summaryPrompt }],
            max_tokens: resolveMaxTokens(OUTPUT_BUDGETS.DOC_SUMMARY, summaryModel, thinking, mistralEffort !== undefined),
            temperature: resolveTemperature(CHAT_TEMPERATURE, summaryModel),
            thinking,
            effort,
            mistral_effort: mistralEffort,
          });

          if (llmRes.ok) {
            const llmData = await llmRes.json();
            const norm = normaliseResponse(provider, llmData);
            const summaryText = norm.text.trim();
            summary = summaryText || sliceSafe(extractedText, SHORT_TEXT_THRESHOLD);

            // Log token usage (provider-reported when available, else estimated).
            const inputTokens = norm.usage?.input_tokens ?? Math.ceil(summaryPrompt.length / 4);
            const outputTokens = norm.usage?.output_tokens ?? Math.ceil(summary.length / 4);

            await adminSupabase.from("token_usage").insert({
              user_id: user.id,
              project_id,
              function_name: "extract-text",
              model_used: summaryModel,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
            });

            await adminSupabase.rpc("increment_tokens_used", {
              user_uuid: user.id,
              amount: inputTokens + outputTokens,
            });
          } else {
            console.error("Summary LLM error:", llmRes.status, await llmRes.text());
            summary = sliceSafe(extractedText, SHORT_TEXT_THRESHOLD) + "...";
          }
        } catch (llmErr) {
          console.error("LLM summary call failed:", llmErr);
          summary = sliceSafe(extractedText, SHORT_TEXT_THRESHOLD) + "...";
        }
      }
    }

    // --- Update imported_documents row ---
    const { error: updateErr } = await adminSupabase
      .from("imported_documents")
      .update({
        extracted_text: extractedText,
        summary,
      })
      .eq("id", document_id);

    if (updateErr) {
      console.error("Failed to update document:", updateErr);
      return jsonResponse({ error: "Failed to save extracted text" }, 500);
    }

    return jsonResponse({
      success: true,
      text_length: extractedText.length,
      summary_length: summary.length,
    });
  } catch (err) {
    console.error("extract-text error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
};

Deno.serve((req) => handler(req));
