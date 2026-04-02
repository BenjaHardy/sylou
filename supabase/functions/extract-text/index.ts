import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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

    // --- Download file from storage using service role ---
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: fileData, error: downloadErr } = await adminSupabase.storage
      .from("imports")
      .download(file_path);

    if (downloadErr || !fileData) {
      console.error("Storage download error:", downloadErr);
      return jsonResponse({ error: "Failed to download file from storage" }, 500);
    }

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
        const buffer = await fileData.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });
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
      // Call Mistral for summary
      const mistralKey = Deno.env.get("MISTRAL_API_KEY");
      if (!mistralKey) {
        // Fall back to first 500 chars if no API key
        summary = extractedText.slice(0, SHORT_TEXT_THRESHOLD) + "...";
      } else {
        const textForSummary = extractedText.slice(0, 10000);
        const summaryPrompt = `Summarize the following document in 3-5 sentences. Focus on the main topics, arguments, and conclusions. This summary will be used to help an AI assistant decide whether to read the full document when answering user questions.\n\n${textForSummary}`;

        try {
          const llmRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${mistralKey}`,
            },
            body: JSON.stringify({
              model: "mistral-large-latest",
              messages: [
                { role: "user", content: summaryPrompt },
              ],
              max_tokens: 500,
            }),
          });

          if (llmRes.ok) {
            const llmData = await llmRes.json();
            summary = llmData.choices?.[0]?.message?.content ?? extractedText.slice(0, SHORT_TEXT_THRESHOLD);

            // Log token usage
            const inputTokens = Math.ceil(summaryPrompt.length / 4);
            const outputTokens = Math.ceil(summary.length / 4);

            await adminSupabase.from("token_usage").insert({
              user_id: user.id,
              project_id,
              function_name: "extract-text",
              model_used: "mistral-large-latest",
              input_tokens: inputTokens,
              output_tokens: outputTokens,
            });

            // Update budget
            const totalTokens = inputTokens + outputTokens;
            await adminSupabase.rpc("increment_tokens_used", {
              user_uuid: user.id,
              amount: totalTokens,
            });
          } else {
            console.error("Mistral summary error:", llmRes.status, await llmRes.text());
            summary = extractedText.slice(0, SHORT_TEXT_THRESHOLD) + "...";
          }
        } catch (llmErr) {
          console.error("LLM summary call failed:", llmErr);
          summary = extractedText.slice(0, SHORT_TEXT_THRESHOLD) + "...";
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
});
