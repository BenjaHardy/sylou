import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// record_activity counts at most 30 s per heartbeat: change both together.
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

    // Heartbeat: the database adds the time by its own clock.
    intervalRef.current = setInterval(async () => {
      const now = Date.now();
      if (document.visibilityState !== "visible") return;
      if (now - lastActivityRef.current > IDLE_TIMEOUT) return;

      try {
        const { error } = await supabase.rpc("record_activity", {
          _project_id: projectId,
          _writing: now - lastWritingRef.current < IDLE_TIMEOUT,
        });
        if (error) throw error;
      } catch (err) {
        // Non-blocking: a missed heartbeat loses only its own 30 s.
        console.error("[activity-tracker] heartbeat failed:", err);
      }
    }, PING_INTERVAL);

    return () => {
      events.forEach((e) => document.removeEventListener(e, markActive));
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [projectId, markActive]);

  return { markWriting };
}
