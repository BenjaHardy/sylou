// Hook-level pins for useProvenanceTracker's hydration guard: the DB map may
// only be overwritten by a tracker that applied THIS project's loaded map to
// the loaded document. Regression pins for the ways an intact map was lost
// (2026-09, a long-lived test project came back all-"typed"):
//   - leaving the project between the provenance fetch and the slower
//     writing-content fetch: the switch/unmount flush wrote `[]`;
//   - a failed provenance fetch: the "no map → all typed" fallback was
//     persisted by the next edit;
//   - a stale response from a previous project landing on the new one.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LoadResult = { data: { segment_map: unknown } | null; error: { message: string } | null };

const db = vi.hoisted(() => ({
  loads: [] as Array<{ id: string; resolve: (r: LoadResult) => void }>,
  updates: [] as Array<{ id: string; segment_map: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: () =>
            new Promise<LoadResult>((resolve) => {
              db.loads.push({ id, resolve });
            }),
        }),
      }),
      update: (payload: { segment_map: unknown }) => ({
        eq: (_col: string, id: string) => {
          db.updates.push({ id, segment_map: payload.segment_map });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  },
}));

import type { ProvenanceSegment } from "@/lib/provenance-tracker";
import { useProvenanceTracker } from "../useProvenanceTracker";

const MAP: ProvenanceSegment[] = [
  { start: 0, end: 10, source: "typed" },
  { start: 10, end: 40, source: "chat_ai" },
];
const DOC_LEN = 40;

async function resolveLoad(index: number, result: LoadResult) {
  await act(async () => {
    db.loads[index].resolve(result);
  });
}

describe("useProvenanceTracker hydration guard", () => {
  beforeEach(() => {
    db.loads.length = 0;
    db.updates.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("control: a hydrated tracker's changes are saved by flushSave and by the unmount flush", async () => {
    const { result, unmount } = renderHook(() => useProvenanceTracker("p1"));
    await resolveLoad(0, { data: { segment_map: MAP }, error: null });
    expect(result.current.provenanceLoaded).toBe(true);
    expect(result.current.provenanceLoadFailed).toBe(false);

    act(() => result.current.initWithContentLength(DOC_LEN));
    expect(result.current.getTracker().getSegments()).toEqual(MAP);

    // Nothing changed yet: flush is a no-op.
    expect(await result.current.flushSave()).toBe(true);
    expect(db.updates).toHaveLength(0);

    // Change the map (re-init as all typed stands in for an edit), then flush.
    act(() => result.current.getTracker().init(null, DOC_LEN));
    expect(await result.current.flushSave()).toBe(true);
    expect(db.updates).toEqual([{ id: "p1", segment_map: [{ start: 0, end: DOC_LEN, source: "typed" }] }]);

    // Another change, left unsaved: the unmount safety net writes it.
    act(() => result.current.getTracker().init(MAP, DOC_LEN + 5));
    unmount();
    expect(db.updates).toHaveLength(2);
    expect(db.updates[1]).toEqual({
      id: "p1",
      segment_map: [...MAP, { start: DOC_LEN, end: DOC_LEN + 5, source: "typed" }],
    });
  });

  it("does not write when the user leaves before the document was initialised (wipe race)", async () => {
    const { result, unmount } = renderHook(() => useProvenanceTracker("p1"));
    await resolveLoad(0, { data: { segment_map: MAP }, error: null });
    expect(result.current.provenanceLoaded).toBe(true);

    // The writing content is still loading, so initWithContentLength never
    // ran: the in-memory tracker is empty. Leaving must not persist `[]`.
    expect(result.current.getTracker().getSegments()).toEqual([]);
    expect(await result.current.flushSave()).toBe(true);
    unmount();
    expect(db.updates).toHaveLength(0);
  });

  it("never persists after a failed provenance fetch (in-memory tracking only)", async () => {
    const { result, unmount } = renderHook(() => useProvenanceTracker("p1"));
    await resolveLoad(0, { data: null, error: { message: "network" } });
    // The editor still opens, and the caller is told to warn.
    expect(result.current.provenanceLoaded).toBe(true);
    expect(result.current.provenanceLoadFailed).toBe(true);

    // The document initialises as typed in memory (no map to apply)...
    act(() => result.current.initWithContentLength(DOC_LEN));
    expect(result.current.getTracker().getSegments()).toEqual([{ start: 0, end: DOC_LEN, source: "typed" }]);

    // ...but that fallback must never reach the DB, on flush or on unmount.
    expect(await result.current.flushSave()).toBe(true);
    act(() => result.current.getTracker().init(null, DOC_LEN + 3));
    expect(await result.current.flushSave()).toBe(true);
    unmount();
    expect(db.updates).toHaveLength(0);
  });

  it("ignores a stale response from a previous project", async () => {
    const { result, rerender } = renderHook(({ id }) => useProvenanceTracker(id), {
      initialProps: { id: "p1" },
    });
    rerender({ id: "p2" });
    expect(db.loads.map((l) => l.id)).toEqual(["p1", "p2"]);

    // p2 (a fresh project, empty map) resolves first; p1's map arrives late.
    await resolveLoad(1, { data: { segment_map: [] }, error: null });
    await resolveLoad(0, { data: { segment_map: MAP }, error: null });
    expect(result.current.provenanceLoaded).toBe(true);

    act(() => result.current.initWithContentLength(DOC_LEN));
    // p1's map must not be applied to p2's document.
    expect(result.current.getTracker().getSegments()).toEqual([{ start: 0, end: DOC_LEN, source: "typed" }]);

    // p2 loaded fine, so p2's own (typed) map is persisted under p2.
    expect(await result.current.flushSave()).toBe(true);
    expect(db.updates).toEqual([{ id: "p2", segment_map: [{ start: 0, end: DOC_LEN, source: "typed" }] }]);
  });
});
