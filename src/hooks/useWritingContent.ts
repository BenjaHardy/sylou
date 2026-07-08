import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/withTimeout";

interface SaveState {
  status: "idle" | "saving" | "saved" | "error";
}

// Auto-save timing. The debounce saves shortly after the user pauses; the
// maxWait is a safety net so continuous typing (which keeps resetting the
// debounce) still saves at least this often — capping how much unsaved work a
// crash/kill (which beforeunload can't catch) could lose.
const DEBOUNCE_MS = 3_000;
const MAX_WAIT_MS = 15_000;
// Upper bound on a single save's wait. An offline write can hang forever
// (pending fetch); this backstops the navigator.onLine fast-path so an
// online-but-unresponsive server can't freeze a flush/switch either.
const SAVE_TIMEOUT_MS = 10_000;

/**
 * Flush lifecycle:
 *   1. User types → updateContent() sets React state + starts the debounce timer
 *      (and a maxWait safety-net timer for continuous typing)
 *   2. Timer fires → saveNow() writes to DB (deduplicates via lastSavedContent ref)
 *   3. On project switch → flushSave() clears timers and saves immediately using
 *      contentRef (a ref that always holds the latest content, avoiding stale closures)
 *   4. On unmount → timers are cleared (parent calls flushSave before unmount)
 */
export function useWritingContent(projectId: string | null) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  // Refs for debounce & version tracking
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContent = useRef<string>("");
  const lastVersionContent = useRef<string>("");
  const lastVersionTime = useRef<number>(Date.now());
  const currentProjectId = useRef<string | null>(null);
  const contentRef = useRef<string>("");

  // Keep contentRef in sync with state
  useEffect(() => { contentRef.current = content; }, [content]);

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
      // Clear pending timers on project change to prevent cross-project saves
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      if (maxWaitTimer.current) {
        clearTimeout(maxWaitTimer.current);
        maxWaitTimer.current = null;
      }
      currentProjectId.current = null;
    };
  }, [projectId]);

  /** Returns true when the content is persisted (or there was nothing to
   *  save); false when the DB write failed — callers gate on this. */
  const saveNow = useCallback(
    async (html: string): Promise<boolean> => {
      if (!projectId) return true;
      // A save resets the maxWait streak; the next edit restarts it.
      if (maxWaitTimer.current) {
        clearTimeout(maxWaitTimer.current);
        maxWaitTimer.current = null;
      }
      if (html === lastSavedContent.current) return true;

      // Fail fast when offline: a pending write would otherwise hang the
      // awaited flush (and the project switch that awaits it) indefinitely.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setSaveState({ status: "error" });
        return false;
      }

      setSaveState({ status: "saving" });

      const res = await withTimeout(
        supabase
          .from("writing_content")
          .update({ content: html, updated_at: new Date().toISOString() })
          .eq("project_id", projectId),
        SAVE_TIMEOUT_MS,
      );

      if (!res || res.error) {
        console.error("Auto-save failed:", res?.error ?? "timed out");
        setSaveState({ status: "error" });
        return false;
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
      return true;
    },
    [projectId]
  );

  const updateContent = useCallback(
    (html: string) => {
      setContent(html);
      // Trailing debounce: save shortly after the user stops typing.
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => saveNow(html), DEBOUNCE_MS);
      // maxWait safety net: started once per unsaved streak and NOT reset on each
      // keystroke, so continuous typing still saves at least every MAX_WAIT_MS.
      // saveNow() clears it (the next edit restarts the streak).
      if (!maxWaitTimer.current) {
        maxWaitTimer.current = setTimeout(() => saveNow(contentRef.current), MAX_WAIT_MS);
      }
    },
    [saveNow]
  );

  // Clear pending timers on unmount (parent calls flushSave before unmount)
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (maxWaitTimer.current) clearTimeout(maxWaitTimer.current);
    };
  }, []);

  const isDirty = content !== lastSavedContent.current;

  const manualSave = useCallback(() => {
    if (!isDirty) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    saveNow(content);
  }, [isDirty, content, saveNow]);

  /** Immediately flush any pending debounced save. Uses contentRef for latest
   *  value. Resolves false when the write failed (content NOT persisted). */
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (!projectId) return true;
    // Use ref to always get the latest content, avoiding stale closure
    return saveNow(contentRef.current);
  }, [projectId, saveNow]);

  return { content, loading, saveState, updateContent, isDirty, manualSave, flushSave };
}
