// Hook-level pin for useImportedDocuments' upload type: the imports bucket
// accepts four MIME types only, so every upload carries the type of its
// extension, whatever type (if any) the browser gave the file.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  uploads: [] as Array<{ bucket: string; path: string; body: Blob }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "u-1" } }, error: null }),
      getSession: () => Promise.resolve({ data: { session: { access_token: "jwt" } }, error: null }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: { id: "d-1" }, error: null }) }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: Blob) => {
          store.uploads.push({ bucket, path, body });
          return Promise.resolve({ data: { path }, error: null });
        },
      }),
    },
  },
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { useImportedDocuments } from "../useImportedDocuments";

describe("useImportedDocuments upload type", () => {
  beforeEach(() => {
    store.uploads.length = 0;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["notes.md", "text/markdown"],
    ["notes.txt", "text/plain"],
    ["paper.pdf", "application/pdf"],
    ["draft.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ])("%s is uploaded as %s, even when the browser gave it no type", async (name, type) => {
    const { result } = renderHook(() => useImportedDocuments("p-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.uploadDocument(new File(["content"], name, { type: "" })));

    expect(store.uploads).toHaveLength(1);
    const [upload] = store.uploads;
    expect(upload.bucket).toBe("imports");
    expect(upload.path).toBe(`u-1/p-1/${name}`);
    expect(upload.body.type).toBe(type);
    expect(upload.body.size).toBe("content".length);
  });
});
