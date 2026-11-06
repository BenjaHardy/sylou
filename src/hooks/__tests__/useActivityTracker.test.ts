// Hook-level pins for useActivityTracker: while the project is open and in
// use, a heartbeat every 30 s asks the database to record the time
// (record_activity, which adds it by its own clock); the hook never writes
// project_stats itself.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: db.rpc, from: db.from },
}));

import { useActivityTracker } from "../useActivityTracker";

const HEARTBEAT_MS = 30_000;
let visibility: DocumentVisibilityState = "visible";

/** A mouse or keyboard event anywhere on the page. */
function interact(event = "keydown") {
  document.dispatchEvent(new Event(event));
}

async function wait(ms = HEARTBEAT_MS) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

describe("useActivityTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    db.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    db.from.mockReset();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState;
  });

  it("asks the database to record the time every 30 s while the project is in use", async () => {
    renderHook(() => useActivityTracker("p1"));
    interact();
    await wait();
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("record_activity", { _project_id: "p1", _writing: false });

    interact("mousemove");
    await wait();
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("reports writing for 5 minutes after an edit in the editor", async () => {
    const { result } = renderHook(() => useActivityTracker("p1"));
    act(() => result.current.markWriting());
    await wait();
    expect(db.rpc).toHaveBeenLastCalledWith("record_activity", { _project_id: "p1", _writing: true });

    // Still using the page, without editing: 5:30 after the edit it no longer counts as writing.
    for (let i = 0; i < 10; i++) {
      interact();
      await wait();
    }
    expect(db.rpc).toHaveBeenLastCalledWith("record_activity", { _project_id: "p1", _writing: false });
  });

  it("sends nothing while the tab is hidden", async () => {
    renderHook(() => useActivityTracker("p1"));
    interact();
    visibility = "hidden";
    await wait();
    expect(db.rpc).not.toHaveBeenCalled();

    visibility = "visible";
    interact();
    await wait();
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("stops 5 minutes after the last mouse or keyboard input", async () => {
    renderHook(() => useActivityTracker("p1"));
    interact();
    await wait(5 * 60_000);
    expect(db.rpc).toHaveBeenCalledTimes(10);

    await wait();
    expect(db.rpc).toHaveBeenCalledTimes(10);
  });

  it("sends nothing without a project, or once the project is closed", async () => {
    renderHook(() => useActivityTracker(null));
    interact();
    await wait();
    expect(db.rpc).not.toHaveBeenCalled();

    const { unmount } = renderHook(() => useActivityTracker("p1"));
    interact();
    unmount();
    await wait();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("logs a failed heartbeat and keeps going", async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: "network" } });
    renderHook(() => useActivityTracker("p1"));
    interact();
    await wait();
    expect(console.error).toHaveBeenCalledWith("[activity-tracker] heartbeat failed:", { message: "network" });

    interact();
    await wait();
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });
});
