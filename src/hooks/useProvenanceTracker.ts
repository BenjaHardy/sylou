import { useRef, useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ProvenanceTracker, ProvenanceSegment } from "@/lib/provenance-tracker";
import { withTimeout } from "@/lib/withTimeout";

// Matches useWritingContent's save timeout — see the note there.
const SAVE_TIMEOUT_MS = 10_000;

/**
 * Hook that manages a ProvenanceTracker instance for a project.
 *
 * Load/save lifecycle:
 *   1. Load: on projectId change, fetch segment_map from DB. Segments are stored
 *      in loadedSegmentsRef but NOT initialized yet (deferred until editor reports
 *      a non-zero document length via initWithContentLength).
 *   2. Save: scheduleSave() starts a 3s debounce → doSave() writes to DB.
 *      Deduplicates via lastSavedJsonRef to skip no-op saves.
 *   3. Flush: flushSave() clears the timer and saves immediately. Called by
 *      WritingEditor's stable flush ref before project switching.
 *   4. Unmount: fire-and-forget save as a safety net (parent should flush first).
 *   5. Project switch cleanup: the [projectId] effect cleanup also does a
 *      fire-and-forget save of the old project's provenance.
 *
 * Hydration guard (load-bearing): nothing is written to provenance_events
 * unless the map fetched for THIS project was applied to the loaded document
 * (initWithContentLength after a successful load). Until then the in-memory
 * tracker is empty, and any write would replace the real map with `[]` —
 * which is what the switch/unmount flushes used to do when the user left a
 * project between the provenance fetch and the (slower) writing-content
 * fetch; the next edit then re-persisted the "no map → all typed" fallback.
 * A failed fetch likewise never hydrates: the editor still opens
 * (`provenanceLoadFailed` lets the caller warn), the session's provenance is
 * tracked in memory only, and the DB row is left intact. Pinned by
 * __tests__/useProvenanceTracker.test.ts.
 */
export function useProvenanceTracker(projectId: string | null) {
  const trackerRef = useRef<ProvenanceTracker>(new ProvenanceTracker());
  const loadedProjectRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedJsonRef = useRef<string>("");
  const projectIdRef = useRef<string | null>(projectId);
  const loadedSegmentsRef = useRef<ProvenanceSegment[] | null>(null);
  // True once the fetch for the current project succeeded (map may be empty).
  const loadOkRef = useRef(false);
  // True once that fetched map was applied to the loaded document. Every DB
  // write is gated on this — see the header note.
  const hydratedRef = useRef(false);
  const [provenanceLoaded, setProvenanceLoaded] = useState(false);
  const [provenanceLoadFailed, setProvenanceLoadFailed] = useState(false);

  // Keep projectIdRef in sync
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // Load provenance data when project changes
  useEffect(() => {
    if (!projectId) {
      trackerRef.current = new ProvenanceTracker();
      loadedProjectRef.current = null;
      loadedSegmentsRef.current = null;
      loadOkRef.current = false;
      hydratedRef.current = false;
      setProvenanceLoadFailed(false);
      setProvenanceLoaded(true);
      return;
    }

    if (loadedProjectRef.current === projectId) return;

    loadOkRef.current = false;
    hydratedRef.current = false;
    setProvenanceLoadFailed(false);
    setProvenanceLoaded(false);

    const load = async () => {
      const { data, error } = await supabase
        .from("provenance_events")
        .select("segment_map")
        .eq("project_id", projectId)
        .maybeSingle();

      // Stale response: the project changed (or was deselected) while this
      // fetch was in flight. Applying it would hand this project's map to
      // another document. Mirrors useWritingContent's currentProjectId check.
      if (projectIdRef.current !== projectId) return;

      if (error) {
        console.error("Failed to load provenance:", error);
        // Open the editor anyway, on a fresh in-memory tracker, but never
        // persist it: loadOkRef stays false so the tracker cannot hydrate.
        trackerRef.current = new ProvenanceTracker();
        loadedSegmentsRef.current = null;
        lastSavedJsonRef.current = "";
        setProvenanceLoadFailed(true);
        setProvenanceLoaded(true);
        return;
      }

      const segmentMap = data?.segment_map as unknown as ProvenanceSegment[] | null;
      // Store fetched segments — do NOT init with length 0 (would clamp them away)
      trackerRef.current = new ProvenanceTracker();
      loadedSegmentsRef.current = (segmentMap && Array.isArray(segmentMap) && segmentMap.length > 0)
        ? segmentMap
        : null;
      // Set baseline so we don't re-save identical data
      lastSavedJsonRef.current = loadedSegmentsRef.current
        ? JSON.stringify(loadedSegmentsRef.current)
        : "";
      loadedProjectRef.current = projectId;
      loadOkRef.current = true;
      setProvenanceLoaded(true);
    };

    load();

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Flush old project's provenance before switching (fire-and-forget).
      // Only a hydrated tracker may write — an un-hydrated one holds `[]`.
      const oldProjectId = projectIdRef.current;
      if (!hydratedRef.current || !oldProjectId) return;
      const json = JSON.stringify(trackerRef.current.toJSON());
      if (json !== lastSavedJsonRef.current) {
        // Mark as saved up front: on unmount both this cleanup and the
        // switch cleanup run, and nothing can retry a failed write anyway.
        lastSavedJsonRef.current = json;
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

  // Flush provenance to DB on unmount (fire-and-forget) — same hydration gate.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (!hydratedRef.current || !projectIdRef.current) return;
      const json = JSON.stringify(trackerRef.current.toJSON());
      if (json !== lastSavedJsonRef.current) {
        // Mark as saved up front: on unmount both this cleanup and the
        // switch cleanup run, and nothing can retry a failed write anyway.
        lastSavedJsonRef.current = json;
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
    // Use deferred segments from DB load if available
    const saved = loadedSegmentsRef.current;
    if (saved) {
      loadedSegmentsRef.current = null;
      tracker.init(saved, contentLength);
    } else {
      const existingSegments = tracker.getSegments();
      if (existingSegments.length > 0) {
        // Already initialized — just re-clamp
        tracker.init(existingSegments, contentLength);
      } else {
        // No saved segments — initialize everything as typed
        tracker.init(null, contentLength);
      }
    }
    // Hydrated: the map fetched for this project (possibly empty) now covers
    // the real document, so what the tracker holds from here on is ours to
    // persist. A failed load never gets here with loadOkRef set.
    hydratedRef.current = loadOkRef.current;
  }, []);

  /** Returns true when the segment map is persisted (or already current);
   *  false when the DB write failed — callers gate on this. */
  const doSave = useCallback(async (): Promise<boolean> => {
    if (!projectId) return true;
    // Not hydrated: nothing of ours to persist (the DB row keeps the last map
    // the editor really had). Not a failure for callers such as the
    // pre-analysis flush — FLOW reads that intact row.
    if (!hydratedRef.current) return true;
    const json = JSON.stringify(trackerRef.current.toJSON());
    if (json === lastSavedJsonRef.current) return true;

    // Fail fast when offline (see useWritingContent) so the flush can't hang.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return false;
    }

    const res = await withTimeout(
      supabase
        .from("provenance_events")
        .update({
          segment_map: JSON.parse(json),
          updated_at: new Date().toISOString(),
        })
        .eq("project_id", projectId),
      SAVE_TIMEOUT_MS,
    );

    if (!res || res.error) {
      console.error("Failed to save provenance:", res?.error ?? "timed out");
      return false;
    }
    lastSavedJsonRef.current = json;
    return true;
  }, [projectId]);

  /** Save segment map to DB (debounced) */
  const scheduleSave = useCallback(() => {
    if (!projectId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => doSave(), 3000);
  }, [projectId, doSave]);

  /** Immediately flush pending provenance save to DB. Resolves false when
   *  the write failed (segment map NOT persisted). */
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (!projectId) return true;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    return doSave();
  }, [projectId, doSave]);

  /** Get the tracker instance for direct method calls */
  const getTracker = useCallback(() => trackerRef.current, []);

  return {
    getTracker,
    initWithContentLength,
    scheduleSave,
    flushSave,
    provenanceLoaded,
    provenanceLoadFailed,
  };
}
