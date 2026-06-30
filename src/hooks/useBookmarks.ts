import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";

export interface Bookmark {
  id: string;
  project_id: string;
  thread_id: string;
  message_id: string;
  char_offset: number;
  color: string;
  annotation: string | null;
  created_at: string;
}

export function useBookmarks(projectId: string | null) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBookmarks = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("chat_bookmarks")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (!error && data) {
      setBookmarks(data as unknown as Bookmark[]);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  const createBookmark = useCallback(async (threadId: string, messageId: string) => {
    if (!projectId) return;
    const newBookmark: TablesInsert<"chat_bookmarks"> = {
      project_id: projectId,
      thread_id: threadId,
      message_id: messageId,
      color: "blue",
      char_offset: 0,
    };
    // Optimistic add
    const tempId = crypto.randomUUID();
    const optimistic: Bookmark = {
      ...newBookmark,
      id: tempId,
      annotation: null,
      created_at: new Date().toISOString(),
    } as Bookmark;
    setBookmarks((prev) => [...prev, optimistic]);

    const { data, error } = await supabase
      .from("chat_bookmarks")
      .insert(newBookmark)
      .select()
      .single();
    if (!error && data) {
      setBookmarks((prev) =>
        prev.map((b) => (b.id === tempId ? (data as unknown as Bookmark) : b))
      );
    } else {
      setBookmarks((prev) => prev.filter((b) => b.id !== tempId));
    }
  }, [projectId]);

  const updateBookmark = useCallback(async (id: string, updates: { color?: string; annotation?: string }) => {
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...updates } : b))
    );
    await supabase
      .from("chat_bookmarks")
      .update(updates)
      .eq("id", id);
  }, []);

  const deleteBookmark = useCallback(async (id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
    await supabase
      .from("chat_bookmarks")
      .delete()
      .eq("id", id);
  }, []);

  const getBookmarkForMessage = useCallback(
    (messageId: string) => bookmarks.find((b) => b.message_id === messageId) ?? null,
    [bookmarks]
  );

  return { bookmarks, loading, createBookmark, updateBookmark, deleteBookmark, getBookmarkForMessage, refreshBookmarks: fetchBookmarks };
}
