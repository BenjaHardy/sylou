import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";

export interface PostIt {
  id: string;
  project_id: string;
  content: string;
  color: string;
  position_x: number;
  position_y: number;
  created_at: string;
}

export function usePostIts(projectId: string | null) {
  const [postIts, setPostIts] = useState<PostIt[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!projectId) { setPostIts([]); return; }
    setLoading(true);
    supabase
      .from("post_its")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setPostIts(data);
        setLoading(false);
      });
  }, [projectId]);

  const createPostIt = useCallback(async () => {
    if (!projectId) return;
    const offset = (postIts.length % 8) * 30;
    const newPostIt: TablesInsert<"post_its"> = {
      project_id: projectId,
      content: "",
      color: "yellow",
      position_x: 50 + offset,
      position_y: 50 + offset,
    };
    // Optimistic
    const tempId = crypto.randomUUID();
    const optimistic: PostIt = {
      ...newPostIt,
      id: tempId,
      created_at: new Date().toISOString(),
    } as PostIt;
    setPostIts((prev) => [...prev, optimistic]);

    const { data, error } = await supabase
      .from("post_its")
      .insert([newPostIt])
      .select()
      .single();
    if (data) {
      setPostIts((prev) => prev.map((p) => (p.id === tempId ? data : p)));
    } else if (error) {
      setPostIts((prev) => prev.filter((p) => p.id !== tempId));
    }
  }, [projectId, postIts.length]);

  const updatePostIt = useCallback(
    (id: string, updates: Partial<Pick<PostIt, "content" | "color">>) => {
      // Optimistic local update
      setPostIts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
      // Persist immediately for content/color
      supabase.from("post_its").update(updates).eq("id", id).then();
    },
    []
  );

  const updatePosition = useCallback(
    (id: string, position_x: number, position_y: number) => {
      // Optimistic local update
      setPostIts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, position_x, position_y } : p))
      );
      // Debounce DB write by 500ms
      if (debounceTimers.current[id]) clearTimeout(debounceTimers.current[id]);
      debounceTimers.current[id] = setTimeout(() => {
        supabase.from("post_its").update({ position_x, position_y }).eq("id", id).then();
        delete debounceTimers.current[id];
      }, 500);
    },
    []
  );

  const deletePostIt = useCallback(async (id: string) => {
    setPostIts((prev) => prev.filter((p) => p.id !== id));
    await supabase.from("post_its").delete().eq("id", id);
  }, []);

  return { postIts, loading, createPostIt, updatePostIt, updatePosition, deletePostIt };
}
