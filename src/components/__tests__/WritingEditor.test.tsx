// Behaviour pins for the writing editor's loading gate and save wiring,
// with the two persistence hooks replaced by fixtures (they have their own
// tests) and a real TipTap editor underneath:
//   - the spinner stays until BOTH the text and the provenance map arrived,
//     with no editor on screen meanwhile (the September provenance-wipe
//     incident: a keystroke into an empty early editor was saved over the
//     real document);
//   - a failed text load shows the reload panel and never initialises the
//     editor; a failed provenance load opens the editor but warns;
//   - the loaded text seeds the tracker and the parent, typing afterwards
//     reaches the save path, and the parent gets one stable flush that runs
//     both saves.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { ProvenanceTracker } from "@/lib/provenance-tracker";

const h = vi.hoisted(() => ({
  writing: {
    content: "<p>Loaded text</p>",
    loading: true,
    loadFailed: false,
    saveState: { status: "idle" },
    updateContent: vi.fn(),
    isDirty: false,
    manualSave: vi.fn(),
    flushSave: vi.fn(async () => true),
  },
  // One object with stable function identities, like the real hooks'
  // memoised callbacks: a fresh getTracker per render re-fires the editor's
  // initial-content effect on every TipTap transaction.
  prov: {
    provenanceLoaded: false,
    provenanceLoadFailed: false,
    initWithContentLength: vi.fn(),
    scheduleSave: vi.fn(),
    flushSave: vi.fn(async () => true),
    getTracker: () => h.tracker,
  },
  tracker: null as unknown,
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useWritingContent", () => ({ useWritingContent: () => h.writing }));
vi.mock("@/hooks/useProvenanceTracker", () => ({ useProvenanceTracker: () => h.prov }));
// The toolbar reads the project name on mount, for export file names.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { name: "Test project" }, error: null }) }) }),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: h.toast }));

import { WritingEditor } from "@/components/WritingEditor";

type Props = Parameters<typeof WritingEditor>[0];

function renderEditor(over: Partial<Props> = {}) {
  const props: Props = {
    projectId: "p-1",
    threadId: "t-1",
    onAskComplete: vi.fn(),
    onFlushEditor: vi.fn(),
    onEditorContent: vi.fn(),
    onProvenanceTracker: vi.fn(),
    ...over,
  };
  const utils = render(<WritingEditor {...props} />);
  return { ...utils, props, rerender: () => utils.rerender(<WritingEditor {...props} />) };
}

beforeAll(() => {
  // jsdom has no layout observer; the editor's pagination watches its size.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

const spinner = () => document.querySelector("svg.animate-spin");
const editorDom = () => document.querySelector(".tiptap") as (HTMLElement & { editor?: Editor }) | null;

beforeEach(() => {
  h.writing.loading = true;
  h.writing.loadFailed = false;
  h.writing.content = "<p>Loaded text</p>";
  h.writing.updateContent.mockReset();
  h.writing.flushSave.mockReset().mockResolvedValue(true);
  h.prov.provenanceLoaded = false;
  h.prov.provenanceLoadFailed = false;
  h.prov.initWithContentLength.mockReset();
  h.prov.scheduleSave.mockReset();
  h.prov.flushSave.mockReset().mockResolvedValue(true);
  h.tracker = new ProvenanceTracker();
  const tracker = h.tracker as ProvenanceTracker;
  // The real hook seeds the tracker here; the fixture does the same.
  h.prov.initWithContentLength.mockImplementation((len: number) => tracker.init(null, len));
  h.toast.error.mockReset();
  h.toast.warning.mockReset();
});

describe("WritingEditor", () => {
  it("keeps the spinner until both the text and the provenance map have arrived, with no editor on screen", () => {
    const { props, rerender } = renderEditor();
    expect(spinner()).toBeInTheDocument();
    expect(editorDom()).toBeNull();

    // Text arrived, provenance not yet: still gated.
    h.writing.loading = false;
    rerender();
    expect(spinner()).toBeInTheDocument();
    expect(editorDom()).toBeNull();
    expect(h.prov.initWithContentLength).not.toHaveBeenCalled();
    expect(props.onEditorContent).not.toHaveBeenCalled();

    // Both arrived: the editor shows the text in the same render.
    h.prov.provenanceLoaded = true;
    rerender();
    expect(spinner()).not.toBeInTheDocument();
    expect(editorDom()).toHaveTextContent("Loaded text");
    // "<p>Loaded text</p>": p(1) + 11 characters + p(1).
    expect(h.prov.initWithContentLength).toHaveBeenCalledTimes(1);
    expect(h.prov.initWithContentLength).toHaveBeenCalledWith(13);
    expect(props.onEditorContent).toHaveBeenCalledWith("<p>Loaded text</p>");
    expect(props.onProvenanceTracker).toHaveBeenCalledWith(h.tracker);
    // Placing the loaded text is not an edit: nothing was saved.
    expect(h.writing.updateContent).not.toHaveBeenCalled();
  });

  it("a failed text load shows the reload panel, warns, and never initialises the editor", () => {
    h.writing.loading = false;
    h.writing.loadFailed = true;
    h.prov.provenanceLoaded = true;
    renderEditor();

    expect(screen.getByText(/This project's text could not be loaded/)).toBeInTheDocument();
    expect(editorDom()).toBeNull();
    expect(h.prov.initWithContentLength).not.toHaveBeenCalled();
    expect(h.writing.updateContent).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalledWith(expect.stringMatching(/could not be loaded/));
  });

  it("a failed provenance load opens the editor but warns that provenance is not saved", () => {
    h.writing.loading = false;
    h.prov.provenanceLoaded = true;
    h.prov.provenanceLoadFailed = true;
    renderEditor();

    expect(editorDom()).toHaveTextContent("Loaded text");
    expect(h.toast.warning).toHaveBeenCalledWith(expect.stringMatching(/Provenance data could not be loaded/));
  });

  it("typing after the load reaches the save path with the new HTML and schedules a provenance save", () => {
    h.writing.loading = false;
    h.prov.provenanceLoaded = true;
    const { props } = renderEditor();
    const editor = editorDom()!.editor!;

    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " and more");
    });

    expect(h.writing.updateContent).toHaveBeenCalledWith("<p>Loaded text and more</p>");
    expect(props.onEditorContent).toHaveBeenLastCalledWith("<p>Loaded text and more</p>");
    expect(h.prov.scheduleSave).toHaveBeenCalled();
    const segments = (h.tracker as ProvenanceTracker).getSegments();
    expect(segments.reduce((n, s) => n + (s.end - s.start), 0)).toBe(editor.state.doc.content.size);
  });

  it("hands the parent one flush that runs both saves and reports a failed one", async () => {
    h.writing.loading = false;
    h.prov.provenanceLoaded = true;
    const { props } = renderEditor();

    const flush = (props.onFlushEditor as ReturnType<typeof vi.fn>).mock.calls[0][0] as () => Promise<boolean>;
    await expect(flush()).resolves.toBe(true);
    expect(h.writing.flushSave).toHaveBeenCalledTimes(1);
    expect(h.prov.flushSave).toHaveBeenCalledTimes(1);

    h.prov.flushSave.mockResolvedValueOnce(false);
    await expect(flush()).resolves.toBe(false);
  });

  it("hiding the tab flushes both saves", () => {
    h.writing.loading = false;
    h.prov.provenanceLoaded = true;
    renderEditor();

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    fireEvent(document, new Event("visibilitychange"));
    expect(h.writing.flushSave).toHaveBeenCalledTimes(1);
    expect(h.prov.flushSave).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
});
