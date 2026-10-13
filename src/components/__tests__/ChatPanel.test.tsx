// Behaviour pins for the chat panel as the user sees it: the bubble kinds and
// their labels, the empty and loading states, the sending indicator per
// phase, the composer (Enter sends, Shift+Enter does not, disabled while
// sending), the web-search toggle gated by the instance configuration, the
// model and reasoning label, the budget line, the tip banner, the document
// upload button, and the conversation-memory divider.
//
// The panel composes six hooks; each is replaced by a fixture the test
// controls, so the assertions are about rendering and wiring, not about
// fetching (the hooks have their own tests).
import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/hooks/useChatMessages";

const h = vi.hoisted(() => ({
  thread: {
    threads: [
      { id: "t-1", name: "Main", project_id: "p-1", created_at: "", updated_at: "" },
      { id: "t-2", name: "Ideas", project_id: "p-1", created_at: "", updated_at: "" },
    ],
    activeThreadId: "t-1",
    activeThreadName: "Main",
    setActiveThreadId: vi.fn(),
    createThread: vi.fn(),
    renameThread: vi.fn(),
    loading: false,
  },
  chat: {
    messages: [] as unknown[],
    loading: false,
    sending: false,
    phase: null as string | null,
    sendMessage: vi.fn(),
    budgetRemaining: null as number | null,
    refreshMessages: vi.fn(),
    appendMessages: vi.fn(),
    setMessages: vi.fn(),
  },
  settings: {
    preferred_chat_model: "zai-glm-5-3",
    preferred_chat_reasoning: {} as Record<string, string>,
  },
  bookmarks: {
    bookmarks: [],
    loading: false,
    createBookmark: vi.fn(),
    updateBookmark: vi.fn(),
    deleteBookmark: vi.fn(),
    getBookmarkForMessage: () => undefined,
    refreshBookmarks: vi.fn(),
  },
  memory: { memory: null as Record<string, unknown> | null, refetch: vi.fn(async () => null) },
  instance: { webSearchEnabled: true, loading: false },
}));

vi.mock("@/hooks/useChatThread", () => ({ useChatThread: () => h.thread }));
vi.mock("@/hooks/useChatMessages", () => ({ useChatMessages: () => h.chat }));
vi.mock("@/hooks/useUserSettings", () => ({
  useUserSettings: () => ({ settings: h.settings, update: vi.fn() }),
}));
vi.mock("@/hooks/useBookmarks", () => ({ useBookmarks: () => h.bookmarks }));
vi.mock("@/hooks/useConversationMemory", () => ({ useConversationMemory: () => h.memory }));
vi.mock("@/hooks/useInstanceConfig", () => ({ useInstanceConfig: () => h.instance }));

import { ChatPanel } from "@/components/ChatPanel";

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m",
  thread_id: "t-1",
  role: "user",
  content: "",
  created_at: "2026-10-13T10:00:00.000Z",
  source_type: null,
  flow_flag: null,
  concise_mode: null,
  tutor_mode: null,
  model_used: null,
  ...over,
});

type Props = ComponentProps<typeof ChatPanel>;

function renderPanel(props: Partial<Props> = {}) {
  const all: Props = { projectId: "p-1", conciseMode: false, onConciseModeChange: vi.fn(), ...props };
  const utils = render(<ChatPanel {...all} />);
  return {
    ...utils,
    props: all,
    rerender: (next: Partial<Props> = {}) => utils.rerender(<ChatPanel {...all} {...next} />),
  };
}

const composer = () => screen.getByPlaceholderText("Type a message…") as HTMLTextAreaElement;
const sendButton = () => composer().parentElement!.querySelector("button")!;
const typeAndEnter = (text: string) => {
  fireEvent.change(composer(), { target: { value: text } });
  fireEvent.keyDown(composer(), { key: "Enter" });
};

beforeEach(() => {
  h.chat.messages = [];
  h.chat.loading = false;
  h.chat.sending = false;
  h.chat.phase = null;
  h.chat.budgetRemaining = null;
  h.chat.sendMessage.mockReset();
  h.settings.preferred_chat_model = "zai-glm-5-3";
  h.settings.preferred_chat_reasoning = {};
  h.memory.memory = null;
  h.instance.webSearchEnabled = true;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ChatPanel", () => {
  it("renders user, assistant, Ask and writing-summary bubbles with their labels; assistant text is markdown, user text is not", () => {
    h.chat.messages = [
      msg({ id: "m-1", role: "user", content: "Hello **there**" }),
      msg({ id: "m-2", role: "assistant", content: "Hi, **bold** reply", model_used: "zai-glm-5-3" }),
      msg({ id: "m-3", role: "user", content: "Explain this", source_type: "ask_prompt" }),
      msg({ id: "m-4", role: "assistant", content: "Sure.", source_type: "ask_response" }),
      msg({ id: "m-5", role: "assistant", content: "Summary body", source_type: "writing_summary" }),
    ];
    renderPanel();

    // The user's text is shown verbatim, the assistant's through markdown.
    expect(screen.getByText("Hello **there**")).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");

    const articles = screen.getAllByRole("article", { name: "AI assistant message" });
    expect(articles).toHaveLength(2);
    expect(articles[0]).toHaveAttribute("data-ai-model", "zai-glm-5-3");
    expect(articles[1]).toHaveAttribute("data-ai-model", "unspecified");
    expect(screen.getAllByText("AI Assistant")).toHaveLength(2);

    expect(screen.getByText("Ask · Text Selection")).toBeInTheDocument();
    expect(screen.getByText("Ask · AI Response")).toBeInTheDocument();

    // The summary bubble is collapsed until its label is clicked.
    expect(screen.queryByText("Summary body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Writing Summary Update"));
    expect(screen.getByText("Summary body")).toBeInTheDocument();
  });

  it("an empty thread invites the first message; a loading thread shows neither bubbles nor the invitation", () => {
    const { rerender } = renderPanel();
    expect(screen.getByText("Start a conversation with your AI writing assistant.")).toBeInTheDocument();

    h.chat.loading = true;
    rerender();
    expect(screen.queryByText("Start a conversation with your AI writing assistant.")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("while sending, the indicator follows the phase and the composer refuses to send", () => {
    h.chat.messages = [msg({ id: "m-1", content: "Hello" })];
    h.chat.sending = true;
    h.chat.phase = "thinking";
    const { rerender } = renderPanel();
    expect(screen.getByText(/^Thinking…/)).toBeInTheDocument();

    h.chat.phase = "searching_web";
    rerender();
    expect(screen.getByText("Searching the web…")).toBeInTheDocument();

    h.chat.phase = "reading_documents";
    rerender();
    expect(screen.getByText("Reading imported documents…")).toBeInTheDocument();

    typeAndEnter("another one");
    expect(h.chat.sendMessage).not.toHaveBeenCalled();
    expect(sendButton()).toBeDisabled();
  });

  it("Enter sends the message with the concise flag and clears the box; Shift+Enter and an empty box do not send", () => {
    const { rerender } = renderPanel();
    expect(sendButton()).toBeDisabled();

    fireEvent.change(composer(), { target: { value: "Hello" } });
    expect(sendButton()).toBeEnabled();
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(h.chat.sendMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(h.chat.sendMessage).toHaveBeenCalledWith("Hello", false, false);
    expect(composer().value).toBe("");

    typeAndEnter("   ");
    expect(h.chat.sendMessage).toHaveBeenCalledTimes(1);

    rerender({ conciseMode: true });
    typeAndEnter("Short please");
    expect(h.chat.sendMessage).toHaveBeenLastCalledWith("Short please", true, false);
  });

  it("the web-search toggle exists only when the instance has search configured, and its state travels with the next message", () => {
    h.instance.webSearchEnabled = false;
    const first = renderPanel();
    expect(screen.getByRole("button", { name: "Web search not configured" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Toggle web search" })).not.toBeInTheDocument();
    first.unmount();

    h.instance.webSearchEnabled = true;
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Toggle web search" }));
    typeAndEnter("What happened today?");
    expect(h.chat.sendMessage).toHaveBeenCalledWith("What happened today?", false, true);
  });

  it("a controlled web-search preference reports toggles to the parent instead of flipping locally", () => {
    const onWebSearchEnabledChange = vi.fn();
    renderPanel({ webSearchEnabled: true, onWebSearchEnabledChange });
    fireEvent.click(screen.getByRole("button", { name: "Toggle web search" }));
    expect(onWebSearchEnabledChange).toHaveBeenCalledWith(false);
    // Still on (the parent did not change the prop): the message carries it.
    typeAndEnter("Still searching");
    expect(h.chat.sendMessage).toHaveBeenCalledWith("Still searching", false, true);
  });

  it("the header names the active model with its reasoning level, and the concise switch reports changes", () => {
    const { props, rerender } = renderPanel();
    const label = () => screen.getByTitle("Active chat model and reasoning level — change in Settings");
    expect(label()).toHaveTextContent("Z.ai GLM 5.3 (via Mistral) · Reasoning: High");

    h.settings.preferred_chat_model = "claude-sonnet-4-6";
    h.settings.preferred_chat_reasoning = { "claude-sonnet-4-6": "medium" };
    rerender();
    expect(label()).toHaveTextContent("Claude Sonnet 4.6 · Reasoning: Medium");

    h.settings.preferred_chat_model = "mistral-large-2512";
    rerender();
    expect(label()).toHaveTextContent("Mistral Large 3");
    expect(label()).not.toHaveTextContent("Reasoning");

    expect(screen.getByText("Main")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(props.onConciseModeChange).toHaveBeenCalledWith(true);
  });

  it("the budget line appears only when the operator set a cap", () => {
    const { rerender } = renderPanel();
    expect(screen.queryByText(/tokens remaining/)).not.toBeInTheDocument();

    h.chat.budgetRemaining = 1234;
    rerender();
    // The thousands separator depends on the machine's locale.
    expect(screen.getByText(/^1\D?234 tokens remaining$/)).toBeInTheDocument();
  });

  it("the tip banner can be dismissed, the upload button needs a handler and shows the uploading state, the collapse control names its direction", () => {
    const onUploadDocument = vi.fn();
    const onToggleChat = vi.fn();
    const { rerender } = renderPanel({ onUploadDocument, onToggleChat, chatExpanded: false });

    const tip = screen.getByText("Tip:").closest("div")!;
    expect(tip).toHaveTextContent(/Select text in your editor/);
    fireEvent.click(within(tip).getByRole("button"));
    expect(screen.queryByText("Tip:")).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Upload document to project" })).toBeEnabled();
    rerender({ documentUploading: true });
    expect(screen.getByRole("button", { name: "Upload document to project" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Expand chat panel" }));
    expect(onToggleChat).toHaveBeenCalled();
    rerender({ chatExpanded: true });
    expect(screen.getByRole("button", { name: "Collapse chat panel" })).toBeInTheDocument();

    document.body.innerHTML = "";
    renderPanel();
    expect(screen.queryByRole("button", { name: "Upload document to project" })).not.toBeInTheDocument();
  });

  it("the conversation-memory divider sits after the last message the memory covers, or after everything when all is covered", () => {
    h.chat.messages = [
      msg({ id: "m-1", content: "one", created_at: "2026-10-13T10:00:00.000Z" }),
      msg({ id: "m-2", content: "two", created_at: "2026-10-13T10:05:00.000Z" }),
      msg({ id: "m-3", content: "three", created_at: "2026-10-13T10:10:00.000Z" }),
    ];
    h.memory.memory = {
      covers_through: "2026-10-13T10:05:00.000Z",
      covered_message_count: 2,
      updated_at: "2026-10-13T10:06:00.000Z",
      model_used: null,
      summary_text: "Earlier, one and two.",
    };
    const { container, rerender } = renderPanel();

    const divider = () => screen.getByText(/In conversation memory/);
    const bubble = (id: string) => container.querySelector(`[data-message-id="${id}"]`)!;
    const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(bubble("m-2"), divider())).toBe(true);
    expect(after(divider(), bubble("m-3"))).toBe(true);

    h.memory.memory = { ...h.memory.memory, covers_through: "2026-10-13T10:10:00.000Z", covered_message_count: 3 };
    rerender();
    expect(after(bubble("m-3"), divider())).toBe(true);
    expect(screen.getAllByText(/In conversation memory/)).toHaveLength(1);
  });
});
