// Hook-level pins for useWritingContent's load-failure guard: when the
// content fetch fails, the editor holds something that is NOT this document,
// so saves are refused (a write would replace the real text). Companion to
// useProvenanceTracker.test.ts (the provenance map is clamped to whatever
// document the editor initialised on).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LoadResult = { data: { content: string } | null; error: { message: string } | null };

const db = vi.hoisted(() => ({
  loads: [] as Array<{ id: string; resolve: (r: LoadResult) => void }>,
  updates: [] as Array<{ table: string; id: string; content: string }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: () =>
            new Promise<LoadResult>((resolve) => {
              db.loads.push({ id, resolve });
            }),
        }),
      }),
      update: (payload: { content: string }) => ({
        eq: (_col: string, id: string) => {
          db.updates.push({ table, id, content: payload.content });
          return Promise.resolve({ error: null });
        },
      }),
      insert: () => Promise.resolve({ error: null }),
    }),
  },
}));

import { useWritingContent } from "../useWritingContent";

async function resolveLoad(index: number, result: LoadResult) {
  await act(async () => {
    db.loads[index].resolve(result);
  });
}

describe("useWritingContent load-failure guard", () => {
  beforeEach(() => {
    db.loads.length = 0;
    db.updates.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("control: edits are saved after a successful load", async () => {
    const { result } = renderHook(() => useWritingContent("p1"));
    await resolveLoad(0, { data: { content: "<p>a</p>" }, error: null });
    expect(result.current.loading).toBe(false);
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.content).toBe("<p>a</p>");

    act(() => result.current.updateContent("<p>ab</p>"));
    expect(await result.current.flushSave()).toBe(true);
    expect(db.updates).toEqual([{ table: "writing_content", id: "p1", content: "<p>ab</p>" }]);
  });

  it("refuses to save when the content failed to load", async () => {
    const { result } = renderHook(() => useWritingContent("p1"));
    await resolveLoad(0, { data: null, error: { message: "network" } });
    expect(result.current.loading).toBe(false);
    expect(result.current.loadFailed).toBe(true);

    // An untouched editor still flushes cleanly (nothing to save)...
    expect(await result.current.flushSave()).toBe(true);

    // ...but keystrokes into the not-loaded document are never written.
    act(() => result.current.updateContent("<p>x</p>"));
    let ok = true;
    await act(async () => {
      ok = await result.current.flushSave();
    });
    expect(ok).toBe(false);
    expect(result.current.saveState.status).toBe("error");
    expect(db.updates).toHaveLength(0);
  });

  it("clears the failure flag when a later project loads", async () => {
    const { result, rerender } = renderHook(({ id }) => useWritingContent(id), {
      initialProps: { id: "p1" },
    });
    await resolveLoad(0, { data: null, error: { message: "network" } });
    expect(result.current.loadFailed).toBe(true);

    rerender({ id: "p2" });
    await resolveLoad(1, { data: { content: "<p>b</p>" }, error: null });
    expect(result.current.loadFailed).toBe(false);

    act(() => result.current.updateContent("<p>bc</p>"));
    expect(await result.current.flushSave()).toBe(true);
    expect(db.updates).toEqual([{ table: "writing_content", id: "p2", content: "<p>bc</p>" }]);
  });
});
