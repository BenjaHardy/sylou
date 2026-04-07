import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useCreativeData<T = Record<string, unknown>>(
  projectId: string | null,
  toolType: string
) {
  const [data, setData] = useState<T>({} as T);
  const [loading, setLoading] = useState(true);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef<T>(data);
  const lastSavedJson = useRef<string>("{}");
  const currentProjectId = useRef<string | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Load on project/tool change
  useEffect(() => {
    if (!projectId) {
      setData({} as T);
      lastSavedJson.current = "{}";
      setLoading(false);
      return;
    }
    currentProjectId.current = projectId;
    setLoading(true);

    const load = async () => {
      const { data: row, error } = await supabase
        .from("project_creative_data")
        .select("data")
        .eq("project_id", projectId)
        .eq("tool_type", toolType)
        .maybeSingle();

      if (currentProjectId.current !== projectId) return;

      if (error) {
        console.error(`Failed to load creative data (${toolType}):`, error);
        setLoading(false);
        return;
      }

      const parsed = (row?.data ?? {}) as T;
      setData(parsed);
      lastSavedJson.current = JSON.stringify(parsed);
      setLoading(false);
    };
    load();

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      currentProjectId.current = null;
    };
  }, [projectId, toolType]);

  const saveNow = useCallback(
    async (newData: T) => {
      if (!projectId) return;
      const json = JSON.stringify(newData);
      if (json === lastSavedJson.current) return;

      const { error } = await supabase
        .from("project_creative_data")
        .upsert(
          {
            project_id: projectId,
            tool_type: toolType,
            data: newData as any,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "project_id,tool_type" }
        );

      if (error) {
        console.error(`Failed to save creative data (${toolType}):`, error);
        return;
      }
      lastSavedJson.current = json;
    },
    [projectId, toolType]
  );

  const save = useCallback(
    (newData: T) => {
      setData(newData);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => saveNow(newData), 2000);
    },
    [saveNow]
  );

  const flush = useCallback(async () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (!projectId) return;
    await saveNow(dataRef.current);
  }, [projectId, saveNow]);

  return { data, loading, save, flush };
}
