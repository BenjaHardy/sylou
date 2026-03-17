import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProjectStats {
  total_active_time_seconds: number;
  total_writing_time_seconds: number;
  chat_prompt_count_normal: number;
  chat_prompt_count_tutor: number;
  sanity_check_count: number;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function useProjectStats(projectId: string | null) {
  const [stats, setStats] = useState<ProjectStats | null>(null);

  const fetchStats = useCallback(async () => {
    if (!projectId) { setStats(null); return; }
    const { data } = await supabase
      .from("project_stats" as any)
      .select("total_active_time_seconds, total_writing_time_seconds, chat_prompt_count_normal, chat_prompt_count_tutor, sanity_check_count")
      .eq("project_id", projectId)
      .single();
    if (data) setStats(data as any);
  }, [projectId]);

  useEffect(() => {
    fetchStats();
    // Poll every 30s to stay in sync with heartbeat
    const id = setInterval(fetchStats, 30_000);
    return () => clearInterval(id);
  }, [fetchStats]);

  return {
    stats,
    formatDuration,
  };
}
