import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SaveState {
  status: "idle" | "saving" | "saved";
}

export function useWritingContent(projectId: string | null) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  // Refs for debounce & version tracking
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContent = useRef<string>("");
  const lastVersionContent = useRef<string>("");
  const lastVersionTime = useRef<number>(Date.now());
  const currentProjectId = useRef<string | null>(null);

  // Load content when project changes
  useEffect(() => {
    if (!projectId) {
      setContent("");
      return;
    }
    currentProjectId.current = projectId;
    setLoading(true);

    const load = async () => {
      const { data, error } = await supabase
        .from("writing_content")
        .select("content")
        .eq("project_id", projectId)
        .maybeSingle();

      if (currentProjectId.current !== projectId) return;

      if (error) {
        console.error("Failed to load writing content:", error);
        setLoading(false);
        return;
      }

      if (data) {
        setContent(data.content);
        lastSavedContent.current = data.content;
        lastVersionContent.current = data.content;
        lastVersionTime.current = Date.now();
      } else {
        // Shouldn't happen due to trigger, but handle gracefully
        const { error: insertErr } = await supabase
          .from("writing_content")
          .insert({ project_id: projectId, content: "" });
        if (insertErr) console.error("Failed to create writing_content:", insertErr);
        setContent("");
        lastSavedContent.current = "";
        lastVersionContent.current = "";
        lastVersionTime.current = Date.now();
      }
      setLoading(false);
    };
    load();

    return () => {
      currentProjectId.current = null;
    };
  }, [projectId]);

  const saveNow = useCallback(
    async (html: string) => {
      if (!projectId) return;
      if (html === lastSavedContent.current) return;

      setSaveState({ status: "saving" });

      const { error } = await supabase
        .from("writing_content")
        .update({ content: html, updated_at: new Date().toISOString() })
        .eq("project_id", projectId);

      if (error) {
        console.error("Auto-save failed:", error);
        setSaveState({ status: "idle" });
        return;
      }

      lastSavedContent.current = html;
      setSaveState({ status: "saved" });
      setTimeout(() => setSaveState((s) => (s.status === "saved" ? { status: "idle" } : s)), 2000);

      // Check if a version snapshot is needed
      const charDiff = Math.abs(html.length - lastVersionContent.current.length);
      const timeDiff = Date.now() - lastVersionTime.current;
      if (charDiff > 100 || timeDiff > 5 * 60 * 1000) {
        await supabase
          .from("writing_versions")
          .insert({ project_id: projectId, content: html });
        lastVersionContent.current = html;
        lastVersionTime.current = Date.now();
      }
    },
    [projectId]
  );

  const updateContent = useCallback(
    (html: string) => {
      setContent(html);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => saveNow(html), 3000);
    },
    [saveNow]
  );

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const isDirty = content !== lastSavedContent.current;

  const manualSave = useCallback(() => {
    if (!isDirty) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    saveNow(content);
  }, [isDirty, content, saveNow]);

  /** Immediately flush any pending debounced save. Returns a promise that resolves after DB write. */
  const flushSave = useCallback(async () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (!projectId) return;
    // Save current content (saveNow checks if it differs from last saved)
    await saveNow(content);
  }, [projectId, content, saveNow]);

  return { content, loading, saveState, updateContent, isDirty, manualSave, flushSave };
}
