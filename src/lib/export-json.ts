import { supabase } from "@/integrations/supabase/client";
import { getBandLabel } from "@/lib/flowBands";

export async function exportProjectAsJson(projectId: string) {
  const [
    projectRes,
    writingRes,
    threadsRes,
    bookmarksRes,
    postItsRes,
    flowRes,
    statsRes,
    docsRes,
    creativeRes,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("name, template, language, tutor_mode, created_at")
      .eq("id", projectId)
      .single(),
    supabase
      .from("writing_content")
      .select("content")
      .eq("project_id", projectId)
      .single(),
    supabase
      .from("chat_threads")
      .select("id, name, created_at, updated_at")
      .eq("project_id", projectId)
      .order("created_at"),
    supabase
      .from("chat_bookmarks")
      .select("id, message_id, thread_id, annotation, color, char_offset, created_at")
      .eq("project_id", projectId),
    supabase
      .from("post_its")
      .select("id, content, color, position_x, position_y, created_at")
      .eq("project_id", projectId),
    supabase
      .from("flow_reports")
      .select(
        "id, created_at, model_used, project_name, ai_summary, ai_find, ai_organize, ai_lead, ai_write, ai_editor_summary, flow_meta, metrics_snapshot, certificate_id, user_feedback_pre, user_feedback_pre_at, user_feedback_post, user_feedback_post_at"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("project_stats")
      .select("*")
      .eq("project_id", projectId)
      .single(),
    supabase
      .from("imported_documents")
      .select("id, file_name, file_size_bytes, uploaded_at, summary")
      .eq("project_id", projectId),
    supabase
      .from("project_creative_data")
      .select("tool_type, data, updated_at")
      .eq("project_id", projectId),
  ]);

  // Fetch messages for each thread
  const threads = threadsRes.data ?? [];
  const threadsWithMessages = await Promise.all(
    threads.map(async (thread) => {
      const { data: messages } = await supabase
        .from("chat_messages")
        .select("id, role, content, created_at, source_type, flow_flag, tutor_mode, concise_mode, model_used, documents_referenced, web_searches_performed")
        .eq("thread_id", thread.id)
        .order("created_at");
      return { ...thread, messages: messages ?? [] };
    })
  );

  const exportData = {
    exported_at: new Date().toISOString(),
    version: "1.0",
    project: {
      ...projectRes.data,
      id: projectId,
      writing_content: writingRes.data?.content ?? "",
      chat_threads: threadsWithMessages,
      bookmarks: bookmarksRes.data ?? [],
      post_its: postItsRes.data ?? [],
      flow_reports: flowRes.data ?? [],
      stats: statsRes.data ?? null,
      imported_documents: docsRes.data ?? [],
      creative_data: creativeRes.data ?? [],
    },
  };

  const projectName = projectRes.data?.name ?? "project";
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName}_export.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
