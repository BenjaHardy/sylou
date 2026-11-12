// Behaviour pins for the AI selection window: the action list per mode, the
// large-selection gate, the editor-action and Ask / Propose streams as the
// window shows them, Accept / Reject and the CONFIRM call, the cut-off and
// refusal notices, the inline error path, and the outside-click protection.
//
// The network edge is the only thing faked: the auth session, `fetch` (the
// stream is a real byte stream of canned events, parsed by the real
// consumer) and the CONFIRM invoke.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above every import, so their state must be too.
const { invokeMock, toastMock, session } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  toastMock: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
  session: { token: "token" as string | null },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: session.token ? { access_token: session.token } : null } }),
    },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

import { TextSelectionWindow } from "@/components/TextSelectionWindow";
import { LARGE_SELECTION_CHARS } from "@/lib/editor-limits";
import { STREAM_CUT_OFF_MESSAGE } from "@/lib/sse-stream";

const fetchMock = vi.fn();
const enc = new TextEncoder();

/** A finished stream of the given events (one `data:` line each). */
function sseResponse(...events: Record<string, unknown>[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A stream the test feeds event by event, to observe the window between them. */
function controlledSSE() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const response = new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  return {
    response,
    push: (event: Record<string, unknown>) =>
      act(async () => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
      }),
    close: () =>
      act(async () => {
        controller.close();
      }),
  };
}

type Props = Parameters<typeof TextSelectionWindow>[0];

function renderWindow(overrides: Partial<Props> = {}) {
  const editorElement = document.createElement("div");
  document.body.appendChild(editorElement);
  const props: Props = {
    selectedText: "The quick brown fox.",
    anchorRect: { top: 100, bottom: 120, left: 50, right: 150, width: 100, height: 20 } as DOMRect,
    editorElement,
    tutorMode: false,
    projectId: "project-1",
    threadId: "thread-1",
    onClose: vi.fn(),
    onAccept: vi.fn(),
    onAskComplete: vi.fn(),
    ...overrides,
  };
  const utils = render(<TextSelectionWindow {...props} />);
  return { ...utils, props };
}

const button = (name: RegExp | string) => screen.getByRole("button", { name });
const queryButton = (name: RegExp | string) => screen.queryByRole("button", { name });
const lastFetchBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
/** Waits for the text to be on screen in the window's settled state: a
 *  stream that finishes at once replaces the streaming box with the result
 *  box, so a single find could catch the box React is about to drop. */
const expectText = (text: string) => waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());

beforeAll(() => {
  // jsdom has no layout: the window scrolls itself into view on open.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  vi.stubGlobal("fetch", fetchMock);
});

beforeEach(() => {
  fetchMock.mockReset();
  invokeMock.mockReset().mockResolvedValue({ data: { inserted_messages: [] }, error: null });
  toastMock.info.mockReset();
  toastMock.error.mockReset();
  session.token = "token";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TextSelectionWindow", () => {
  it("offers the five editor actions plus Ask and Propose; tutor mode and creative modules offer less", () => {
    const { unmount } = renderWindow();
    for (const name of ["Fix grammar", "Translate", "Rewrite", "Simplify", "Expand", "Ask", "Propose"]) {
      expect(button(name)).toBeInTheDocument();
    }
    unmount();

    const tutor = renderWindow({ tutorMode: true });
    expect(button("Fix grammar")).toBeInTheDocument();
    expect(button("Translate")).toBeInTheDocument();
    expect(button("Ask")).toBeInTheDocument();
    expect(queryButton("Rewrite")).not.toBeInTheDocument();
    expect(queryButton("Propose")).not.toBeInTheDocument();
    tutor.unmount();

    renderWindow({ sourceModule: "worldbuilding" });
    expect(button("Ask")).toBeInTheDocument();
    expect(queryButton("Fix grammar")).not.toBeInTheDocument();
    expect(queryButton("Propose")).not.toBeInTheDocument();
  });

  it("hides the editor actions behind the large-selection notice until acknowledged; Ask and Propose stay", () => {
    renderWindow({ selectedText: "x".repeat(LARGE_SELECTION_CHARS + 1) });

    expect(screen.getByRole("status")).toHaveTextContent(/the result may be cut off/);
    expect(queryButton("Fix grammar")).not.toBeInTheDocument();
    expect(button("Ask")).toBeInTheDocument();
    expect(button("Propose")).toBeInTheDocument();

    fireEvent.click(button("I understand, show the editor actions"));
    expect(button("Fix grammar")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("an editor action streams into the Proposed box, then Accept records the decision and inserts the text", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse({ token: "The quick " }, { token: "brown fox jumps." }, {
        done: true,
        result: "The quick brown fox jumps.",
        action_id: "act-1",
      }),
    );
    const { props } = renderWindow();

    fireEvent.click(button("Fix grammar"));

    await expectText("The quick brown fox jumps.");
    expect(button(/^Accept$/)).toBeEnabled();
    expect(fetchMock.mock.calls[0][0]).toBe("https://test.supabase.co/functions/v1/editor-action");
    expect(lastFetchBody()).toMatchObject({
      project_id: "project-1",
      action_type: "fix_grammar",
      selected_text: "The quick brown fox.",
      stream: true,
    });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer token");

    fireEvent.click(button(/^Accept$/));
    await waitFor(() => expect(props.onAccept).toHaveBeenCalledWith("The quick brown fox jumps."));
    expect(invokeMock).toHaveBeenCalledWith("context-prompt", {
      body: { confirm: true, action_id: "act-1", project_id: "project-1" },
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("Ask: sends the instruction, shows the stages the function reports, hands the logged messages to the chat and closes", async () => {
    const stream = controlledSSE();
    fetchMock.mockResolvedValueOnce(stream.response);
    const { props } = renderWindow({ webSearchEnabled: true, conciseMode: true });

    fireEvent.click(button("Ask"));
    const box = screen.getByPlaceholderText(/What does this paragraph imply/);
    expect(button("Submit")).toBeDisabled();
    fireEvent.change(box, { target: { value: "Why the fox?" } });
    fireEvent.click(button("Submit"));

    expect(await screen.findByText("Reviewing your writing…")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("https://test.supabase.co/functions/v1/context-prompt");
    expect(lastFetchBody()).toMatchObject({
      action_type: "ask",
      instruction: "Why the fox?",
      thread_id: "thread-1",
      concise_mode: true,
      web_search_enabled: true,
      stream: true,
    });

    await stream.push({ phase: "searching_web" });
    expect(await screen.findByText("Searching the web…")).toBeInTheDocument();
    await stream.push({ phase: "thinking" });
    expect(await screen.findByText(/^Thinking…/)).toBeInTheDocument();

    const inserted = [{ id: "m-1", role: "user" }, { id: "m-2", role: "assistant" }];
    await stream.push({ token: "Because" });
    await stream.push({ done: true, inserted_messages: inserted });
    await waitFor(() => expect(props.onAskComplete).toHaveBeenCalledWith(inserted));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("Propose: streams into the window; a reply flagged as cut off warns, and Accept asks for confirmation first", async () => {
    const stream = controlledSSE();
    fetchMock.mockResolvedValueOnce(stream.response);
    const { props } = renderWindow();

    fireEvent.click(button("Propose"));
    fireEvent.change(screen.getByPlaceholderText(/Make this more formal/), {
      target: { value: "Make it formal" },
    });
    fireEvent.click(button("Submit"));

    await stream.push({ token: "A formal " });
    await stream.push({ token: "fox." });
    expect(await screen.findByText("A formal fox.")).toBeInTheDocument();
    expect(screen.getByText("Proposed:")).toBeInTheDocument();

    const inserted = [{ id: "m-3", role: "assistant" }];
    await stream.push({
      done: true,
      ai_response: "A formal fox.",
      action_id: "act-2",
      truncated: true,
      inserted_messages: inserted,
    });

    expect(await screen.findByText(/stopped at its output limit/)).toBeInTheDocument();
    // The exchange is already logged at delivery: the chat gets it before any decision.
    expect(props.onAskComplete).toHaveBeenCalledWith(inserted);
    expect(props.onAccept).not.toHaveBeenCalled();

    fireEvent.click(button(/^Accept$/));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Accept a cut-off result?");
    expect(props.onAccept).not.toHaveBeenCalled();

    fireEvent.click(button("Accept anyway"));
    await waitFor(() => expect(props.onAccept).toHaveBeenCalledWith("A formal fox."));
    expect(invokeMock).toHaveBeenCalledWith("context-prompt", {
      body: { confirm: true, action_id: "act-2", project_id: "project-1" },
    });
  });

  it("a provider refusal is shown as a notice with Reject only, and Reject records the decision", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse({ done: true, ai_response: "I can't help with that request.", refused: true, action_id: "act-3" }),
    );
    const { props } = renderWindow();

    fireEvent.click(button("Propose"));
    fireEvent.change(screen.getByPlaceholderText(/Make this more formal/), { target: { value: "Do it" } });
    fireEvent.click(button("Submit"));

    expect(await screen.findByRole("status")).toHaveTextContent("I can't help with that request.");
    expect(screen.queryByText("Proposed:")).not.toBeInTheDocument();
    expect(queryButton(/^Accept$/)).not.toBeInTheDocument();

    fireEvent.click(button("Reject"));
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith("context-prompt", {
      body: { confirm: false, action_id: "act-3", project_id: "project-1" },
    });
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it("a failure reported by the function is shown inline, with the instruction kept for a retry", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse({ error: "Monthly token budget exceeded", done: true }));
    const { props } = renderWindow();

    fireEvent.click(button("Ask"));
    fireEvent.change(screen.getByPlaceholderText(/What does this paragraph imply/), {
      target: { value: "Why?" },
    });
    fireEvent.click(button("Submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Monthly token budget exceeded");
    expect(screen.getByPlaceholderText(/What does this paragraph imply/)).toHaveValue("Why?");
    expect(button("Submit")).toBeEnabled();
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.click(button("Back"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(button("Fix grammar")).toBeInTheDocument();
  });

  it("a stream that ends without any event shows the cut-off message; an HTTP error shows the body's message", async () => {
    const stream = controlledSSE();
    fetchMock.mockResolvedValueOnce(stream.response);
    const first = renderWindow();

    fireEvent.click(button("Rewrite"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await stream.close();
    expect(await screen.findByRole("alert")).toHaveTextContent(STREAM_CUT_OFF_MESSAGE);
    first.unmount();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unsupported model: nope" }), { status: 400 }),
    );
    renderWindow();
    fireEvent.click(button("Simplify"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported model: nope");
  });

  it("without a session the action is refused with a toast and the window stays on the actions", async () => {
    session.token = null;
    renderWindow();

    fireEvent.click(button("Expand"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Not authenticated."));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(button("Fix grammar")).toBeInTheDocument();
  });

  it("an outside click closes the window on the action list, but is swallowed while a proposal awaits a decision; Escape always closes", async () => {
    const { props } = renderWindow();
    // The outside-click listener is attached shortly after opening.
    await new Promise((r) => setTimeout(r, 80));
    fireEvent.mouseDown(document.body);
    expect(props.onClose).toHaveBeenCalledTimes(1);

    document.body.innerHTML = "";
    fetchMock.mockResolvedValueOnce(
      sseResponse({ done: true, result: "Jumping fox.", action_id: "act-4" }),
    );
    const second = renderWindow();
    fireEvent.click(button("Fix grammar"));
    await expectText("Jumping fox.");
    expect(button(/^Accept$/)).toBeEnabled();

    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(second.props.onClose).not.toHaveBeenCalled();
    expect(toastMock.info).toHaveBeenCalledWith(expect.stringMatching(/Review the proposal/));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(second.props.onClose).toHaveBeenCalledTimes(1);
  });
});
