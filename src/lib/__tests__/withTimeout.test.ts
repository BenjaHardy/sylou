import { describe, it, expect } from "vitest";
import { withTimeout } from "@/lib/withTimeout";

describe("withTimeout", () => {
  it("resolves the value when the promise settles in time", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000);
    expect(result).toBe("ok");
  });

  it("resolves null when the promise does not settle in time", async () => {
    // A promise that never settles — the offline-hang case.
    const result = await withTimeout(new Promise<string>(() => {}), 10);
    expect(result).toBeNull();
  });

  it("resolves null when the promise rejects", async () => {
    const result = await withTimeout(Promise.reject(new Error("boom")), 1000);
    expect(result).toBeNull();
  });

  it("does not reject even when the wrapped promise rejects", async () => {
    // Would throw if withTimeout propagated the rejection.
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000)).resolves.toBeNull();
  });
});
