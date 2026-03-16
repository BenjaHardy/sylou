import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useChatThread(projectId: string | null) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadName, setThreadName] = useState("Main");

  useEffect(() => {
    if (!projectId) {
      setThreadId(null);
      setThreadName("Main");
      return;
    }

    supabase
      .from("chat_threads")
      .select("id, name")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(1)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          console.error("Failed to load thread:", error);
          setThreadId(null);
          return;
        }
        setThreadId(data.id);
        setThreadName(data.name);
      });
  }, [projectId]);

  return { threadId, threadName };
}
