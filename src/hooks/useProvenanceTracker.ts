import { useRef, useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ProvenanceTracker, ProvenanceSegment } from "@/lib/provenance-tracker";

/**
 * Hook that manages a ProvenanceTracker instance for a project.
 * Handles initialization (load from DB), saving (debounced with content saves),
 * and exposes methods for the editor and other components.
 */
export function useProvenanceTracker(projectId: string | null) {
  const trackerRef = useRef<ProvenanceTracker>(new ProvenanceTracker());
  const loadedProjectRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedJsonRef = useRef<string>("");
  const projectIdRef = useRef<string | null>(projectId);
  const loadedSegmentsRef = useRef<ProvenanceSegment[] | null>(null);
  const [provenanceLoaded, setProvenanceLoaded] = useState(false);

  // Keep projectIdRef in sync
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // Load provenance data when project changes
  useEffect(() => {
    if (!projectId) {
      trackerRef.current = new ProvenanceTracker();
      loadedProjectRef.current = null;
      setProvenanceLoaded(true);
      return;
    }

    if (loadedProjectRef.current === projectId) return;

    setProvenanceLoaded(false);

    const load = async () => {
      const { data, error } = await supabase
        .from("provenance_events")
        .select("segment_map")
        .eq("project_id", projectId)
        .maybeSingle();

      if (error) {
        console.error("Failed to load provenance:", error);
        setProvenanceLoaded(true);
        return;
      }

      const segmentMap = data?.segment_map as unknown as ProvenanceSegment[] | null;
      // We'll call init later when editor content length is known
      trackerRef.current = new ProvenanceTracker();
      if (segmentMap && Array.isArray(segmentMap) && segmentMap.length > 0) {
        trackerRef.current.init(segmentMap, 0); // Will be re-clamped on initWithContentLength
      }
      loadedProjectRef.current = projectId;
      setProvenanceLoaded(true);
    };

    load();

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Flush old project's provenance before switching (fire-and-forget)
      const oldProjectId = projectIdRef.current;
      const json = JSON.stringify(trackerRef.current.toJSON());
      if (json !== lastSavedJsonRef.current && oldProjectId) {
        supabase
          .from("provenance_events")
          .update({
            segment_map: JSON.parse(json),
            updated_at: new Date().toISOString(),
          })
          .eq("project_id", oldProjectId)
          .then(() => {});
      }
    };
  }, [projectId]);

  // Flush provenance to DB on unmount (fire-and-forget)
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const json = JSON.stringify(trackerRef.current.toJSON());
      if (json !== lastSavedJsonRef.current && projectIdRef.current) {
        supabase
          .from("provenance_events")
          .update({
            segment_map: JSON.parse(json),
            updated_at: new Date().toISOString(),
          })
          .eq("project_id", projectIdRef.current)
          .then(() => {});
      }
    };
  }, []);

  const initWithContentLength = useCallback((contentLength: number) => {
    const tracker = trackerRef.current;
    const existingSegments = tracker.getSegments();
    if (existingSegments.length > 0) {
      // Already loaded from DB — just clamp to current length
      tracker.init(existingSegments, contentLength);
    } else {
      // No saved segments — initialize everything as typed
      tracker.init(null, contentLength);
    }
  }, []);

  const doSave = useCallback(async () => {
    if (!projectId) return;
    const json = JSON.stringify(trackerRef.current.toJSON());
    if (json === lastSavedJsonRef.current) return;

    const { error } = await supabase
      .from("provenance_events")
      .update({
        segment_map: JSON.parse(json),
        updated_at: new Date().toISOString(),
      })
      .eq("project_id", projectId);

    if (error) {
      console.error("Failed to save provenance:", error);
    } else {
      lastSavedJsonRef.current = json;
    }
  }, [projectId]);

  /** Save segment map to DB (debounced) */
  const scheduleSave = useCallback(() => {
    if (!projectId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => doSave(), 3000);
  }, [projectId, doSave]);

  /** Immediately flush pending provenance save to DB */
  const flushSave = useCallback(async () => {
    if (!projectId) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await doSave();
  }, [projectId, doSave]);

  /** Get the tracker instance for direct method calls */
  const getTracker = useCallback(() => trackerRef.current, []);

  return {
    getTracker,
    initWithContentLength,
    scheduleSave,
    flushSave,
    provenanceLoaded,
  };
}
