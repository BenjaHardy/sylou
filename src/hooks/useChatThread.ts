import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ChatThread {
  id: string;
  name: string;
  created_at: string;
}

/**
 * Manages all chat threads for a project.
 * - Loads threads on project change
 * - Remembers active thread per project within the session (useRef Map)
 * - Exposes create / rename helpers
 */
export function useChatThread(projectId: string | null) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Session-level memory: projectId → last-selected threadId
  const selectionMemory = useRef(new Map<string, string>());

  const fetchThreads = useCallback(async (pid: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("chat_threads")
      .select("id, name, created_at")
      .eq("project_id", pid)
      .order("created_at", { ascending: true });

    if (error || !data) {
      console.error("Failed to load threads:", error);
      setThreads([]);
      setActiveThreadIdState(null);
      setLoading(false);
      return;
    }

    setThreads(data);

    // Restore remembered thread if it still exists, otherwise pick first
    const remembered = selectionMemory.current.get(pid);
    const match = remembered ? data.find((t) => t.id === remembered) : null;
    setActiveThreadIdState(match ? match.id : data[0]?.id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!projectId) {
      setThreads([]);
      setActiveThreadIdState(null);
      return;
    }
    fetchThreads(projectId);
  }, [projectId, fetchThreads]);

  const setActiveThreadId = useCallback(
    (threadId: string) => {
      setActiveThreadIdState(threadId);
      if (projectId) {
        selectionMemory.current.set(projectId, threadId);
      }
    },
    [projectId],
  );

  const createThread = useCallback(
    async (name: string) => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from("chat_threads")
        .insert({ project_id: projectId, name })
        .select("id, name, created_at")
        .single();

      if (error || !data) {
        console.error("Failed to create thread:", error);
        return null;
      }

      setThreads((prev) => [...prev, data]);
      setActiveThreadId(data.id);
      return data;
    },
    [projectId, setActiveThreadId],
  );

  const renameThread = useCallback(
    async (threadId: string, newName: string) => {
      const { error } = await supabase
        .from("chat_threads")
        .update({ name: newName })
        .eq("id", threadId);

      if (error) {
        console.error("Failed to rename thread:", error);
        return;
      }

      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, name: newName } : t)),
      );
    },
    [],
  );

  // Derive active thread name for convenience
  const activeThread = threads.find((t) => t.id === activeThreadId);

  return {
    threads,
    activeThreadId,
    activeThreadName: activeThread?.name ?? "Main",
    setActiveThreadId,
    createThread,
    renameThread,
    loading,
  };
}
