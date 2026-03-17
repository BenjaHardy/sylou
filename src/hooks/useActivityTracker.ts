import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const PING_INTERVAL = 30_000; // 30s
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 min

export function useActivityTracker(projectId: string | null) {
  const lastActivityRef = useRef(0);
  const lastWritingRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const markActive = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const markWriting = useCallback(() => {
    lastActivityRef.current = Date.now();
    lastWritingRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!projectId) return;

    // DOM listeners
    const events = ["mousedown", "mousemove", "keydown", "scroll", "click", "touchstart"] as const;
    events.forEach((e) => document.addEventListener(e, markActive, { passive: true }));

    // Heartbeat
    intervalRef.current = setInterval(async () => {
      const now = Date.now();
      if (document.visibilityState !== "visible") return;
      if (now - lastActivityRef.current > IDLE_TIMEOUT) return;

      const isWriting = now - lastWritingRef.current < IDLE_TIMEOUT;

      try {
        // Fetch current stats to check clock anomaly & first_activity
        const { data } = await supabase
          .from("project_stats" as any)
          .select("last_activity_at, first_activity_at, total_active_time_seconds, total_writing_time_seconds, clock_anomaly_count")
          .eq("project_id", projectId)
          .single();

        if (!data) return;
        const stats = data as any;

        const nowIso = new Date().toISOString();
        const updates: Record<string, any> = {};

        // Clock anomaly detection
        if (stats.last_activity_at && new Date(nowIso) < new Date(stats.last_activity_at as string)) {
          updates.clock_anomaly_count = ((stats.clock_anomaly_count as number) || 0) + 1;
        } else {
          updates.last_activity_at = nowIso;
        }

        updates.total_active_time_seconds = ((stats.total_active_time_seconds as number) || 0) + 30;

        if (isWriting) {
          updates.total_writing_time_seconds = ((stats.total_writing_time_seconds as number) || 0) + 30;
        }

        if (!stats.first_activity_at) {
          updates.first_activity_at = nowIso;
        }

        await supabase
          .from("project_stats" as any)
          .update(updates)
          .eq("project_id", projectId);
      } catch (err) {
        // Non-blocking: silently log
        console.error("[activity-tracker] ping failed:", err);
      }
    }, PING_INTERVAL);

    return () => {
      events.forEach((e) => document.removeEventListener(e, markActive));
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [projectId, markActive]);

  return { markWriting };
}
