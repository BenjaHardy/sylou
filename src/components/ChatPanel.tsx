import { Fragment, useState, useRef, useEffect, KeyboardEvent, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { ComponentProps } from "react";
import { useSmoothedText } from "@/hooks/useSmoothedText";
import { isNearBottom } from "@/lib/stream-smoothing";
import remarkGfm from "remark-gfm";
import { MessageSquare, Send, User, X, Info, ChevronLeft, ChevronRight, FileText, ChevronDown, ChevronUp, BookmarkIcon, Globe, Paperclip } from "lucide-react";
import sylouShiba from "@/assets/sylou-shiba.png";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useChatThread } from "@/hooks/useChatThread";
import { useConversationMemory } from "@/hooks/useConversationMemory";
import {
  ConversationMemoryDivider,
  ConversationMemoryDialog,
} from "@/components/ConversationMemoryView";
import { useChatMessages, ChatMessage } from "@/hooks/useChatMessages";
import { ChatThreadSelector } from "@/components/ChatThreadSelector";
import { BookmarkPopover } from "@/components/BookmarkPopover";
import { BookmarkListPanel } from "@/components/BookmarkListPanel";
import { useBookmarks } from "@/hooks/useBookmarks";
import { format } from "date-fns";
import type { ProvenanceTracker } from "@/lib/provenance-tracker";
import { useUserSettings } from "@/hooks/useUserSettings";
import { MODEL_LABELS } from "@/lib/models";
import { useInstanceConfig } from "@/hooks/useInstanceConfig";

interface Props {
  projectId: string;
  chatExpanded?: boolean;
  onToggleChat?: () => void;
  refreshTrigger?: number;
  injectMessages?: ChatMessage[];
  onMessagesInjected?: () => void;
  provenanceTracker?: ProvenanceTracker;
  conciseMode: boolean;
  onConciseModeChange: (value: boolean) => void;
  onSetMessages?: (setter: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void) => void;
  onActiveThreadChange?: (threadId: string | null) => void;
  onUploadDocument?: (file: File) => void;
  documentUploading?: boolean;
  webSearchEnabled?: boolean;
  onWebSearchEnabledChange?: (value: boolean) => void;
}

const BOOKMARK_BAR_COLORS: Record<string, string> = {
  blue: "bg-blue-500",
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
  purple: "bg-purple-500",
};

const SOURCE_LABELS: Record<string, string> = {
  ask_prompt: "Ask · Text Selection",
  ask_response: "Ask · AI Response",
  propose_prompt: "Propose · Text Selection",
  propose_response: "Propose · AI Response",
  writing_summary: "Writing Summary Update",
};

// Markdown renderer config for assistant bubbles — static (zero captures),
// hoisted so the streaming and persisted branches share one object.
const markdownComponents: ComponentProps<typeof ReactMarkdown>["components"] = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 last:mb-0 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 last:mb-0 space-y-1">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    return isBlock ? (
      <code className={`block bg-muted/60 rounded px-2 py-1.5 text-xs my-2 overflow-x-auto ${className}`}>{children}</code>
    ) : (
      <code className="bg-muted/60 rounded px-1 py-0.5 text-xs">{children}</code>
    );
  },
  pre: ({ children }) => <pre className="mb-2 last:mb-0">{children}</pre>,
  h1: ({ children }) => <p className="font-bold mb-2">{children}</p>,
  h2: ({ children }) => <p className="font-bold mb-2">{children}</p>,
  h3: ({ children }) => <p className="font-semibold mb-1.5">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">{children}</a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/30 pl-3 my-2 text-muted-foreground italic">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border/50 last:border-0">{children}</tr>,
  th: ({ children }) => <th className="text-left font-semibold px-2 py-1.5 align-top">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1.5 align-top">{children}</td>,
};

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="prose-chat break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

// LIVE streaming bubbles ("streaming-assistant" + the Ask flow's
// "streaming-ask") reveal their text through useSmoothedText: Anthropic
// streams multi-word delta clumps (verified 2026-08; Mistral drips
// near-token fragments), and the adaptive reveal repaints the clumps
// smoothly without touching content, persistence, or the SSE lifecycle
// (see src/lib/stream-smoothing.ts). Persisted bubbles render direct;
// the TextSelectionWindow's own panes are deliberately not covered.
function StreamingAssistantMarkdown({ content }: { content: string }) {
  const displayed = useSmoothedText(content);
  return <AssistantMarkdown content={displayed} />;
}

function WritingSummaryBubble({ message }: { message: ChatMessage }) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="flex gap-2.5">
      <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 bg-accent/60 text-accent-foreground">
        <FileText className="h-3.5 w-3.5" />
      </div>
      <div className="max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed bg-accent/30 text-foreground border border-accent/40">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <span className="text-[10px] uppercase tracking-wider font-semibold text-accent-foreground/70">
            {SOURCE_LABELS[message.source_type ?? ""] ?? "Writing Summary"}
          </span>
          {collapsed ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronUp className="h-3 w-3 ml-auto" />}
        </button>
        {!collapsed && (
          <p className="whitespace-pre-wrap break-words mt-2 text-xs text-muted-foreground">
            {message.content}
          </p>
        )}
        <span className="block text-[10px] mt-1.5 text-muted-foreground/60">
          {format(new Date(message.created_at), "h:mm a")}
        </span>
      </div>
    </div>
  );
}

interface ChatBubbleProps {
  message: ChatMessage;
  bookmark: ReturnType<ReturnType<typeof useBookmarks>["getBookmarkForMessage"]>;
  onCreateBookmark: () => void;
  onUpdateBookmark: (id: string, updates: { color?: string; annotation?: string }) => void;
  onDeleteBookmark: (id: string) => void;
}

function ChatBubble({ message, bookmark, onCreateBookmark, onUpdateBookmark, onDeleteBookmark }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const sourceType = message.source_type ?? "chat";
  const isContextMessage = ["ask_prompt", "ask_response", "propose_prompt", "propose_response"].includes(sourceType);

  if (sourceType === "writing_summary") {
    return (
      <div data-message-id={message.id} className="relative group/msg">
        <WritingSummaryBubble message={message} />
        {/* Bookmark hover icon */}
        {!bookmark && (
          <button
            onClick={onCreateBookmark}
            className="absolute right-2 top-2 opacity-0 group-hover/msg:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-primary"
            aria-label="Bookmark this message"
          >
            <BookmarkIcon className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Bookmark bar */}
        {bookmark && (
          <BookmarkPopover bookmark={bookmark} onUpdate={onUpdateBookmark} onDelete={onDeleteBookmark}>
            <button
              className={`absolute right-2 top-0 bottom-0 w-[3px] rounded ${BOOKMARK_BAR_COLORS[bookmark.color] ?? BOOKMARK_BAR_COLORS.blue} cursor-pointer hover:w-[5px] transition-all`}
              aria-label="Edit bookmark"
            />
          </BookmarkPopover>
        )}
      </div>
    );
  }

  const sourceLabel = SOURCE_LABELS[sourceType];

  const assistantAttrs = !isUser
    ? {
        role: "article" as const,
        "aria-label": "AI assistant message",
        "data-ai-generated": "true",
        "data-ai-model": message.model_used ?? "unspecified",
      }
    : {};

  return (
    <div data-message-id={message.id} className="relative group/msg" {...assistantAttrs}>
      <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`} data-chat-role={message.role}>
        <div
          className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
            isUser
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {isUser ? <User className="h-3.5 w-3.5" /> : <img src={sylouShiba} alt="Sylou" className="h-3.5 w-3.5 object-contain" />}
        </div>
        <div
          className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
            isContextMessage
              ? isUser
                ? "bg-primary/5 text-foreground border border-primary/20"
                : "bg-muted/80 text-foreground border border-border"
              : isUser
                ? "bg-primary/10 text-foreground"
                : "bg-muted text-foreground"
          }`}
        >
          {!isUser && (
            <span className="block text-xs font-medium text-muted-foreground mb-1">
              AI Assistant
            </span>
          )}
          {sourceLabel && (
            <span className="block text-[10px] uppercase tracking-wider font-semibold text-primary/60 mb-1">
              {sourceLabel}
            </span>
          )}
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : message.id === "streaming-assistant" || message.id === "streaming-ask" ? (
            <StreamingAssistantMarkdown content={message.content} />
          ) : (
            <AssistantMarkdown content={message.content} />
          )}

          <span
            className={`block text-[10px] mt-1.5 ${
              isUser ? "text-primary/50 text-right" : "text-muted-foreground/60"
            }`}
          >
            {format(new Date(message.created_at), "h:mm a")}
          </span>
        </div>
      </div>

      {/* Bookmark hover icon (right edge) */}
      {!bookmark && (
        <button
          onClick={onCreateBookmark}
          className="absolute right-2 top-2 opacity-0 group-hover/msg:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-primary"
          aria-label="Bookmark this message"
        >
          <BookmarkIcon className="h-3.5 w-3.5" />
        </button>
      )}
      {/* Bookmark colored bar */}
      {bookmark && (
        <BookmarkPopover bookmark={bookmark} onUpdate={onUpdateBookmark} onDelete={onDeleteBookmark}>
          <button
            className={`absolute right-2 top-0 bottom-0 w-[3px] rounded ${BOOKMARK_BAR_COLORS[bookmark.color] ?? BOOKMARK_BAR_COLORS.blue} cursor-pointer hover:w-[5px] transition-all`}
            aria-label="Edit bookmark"
          />
        </BookmarkPopover>
      )}
    </div>
  );
}

export function ChatPanel({ projectId, chatExpanded, onToggleChat, refreshTrigger, injectMessages, onMessagesInjected, provenanceTracker, conciseMode, onConciseModeChange, onSetMessages, onActiveThreadChange, onUploadDocument, documentUploading, webSearchEnabled: webSearchEnabledProp, onWebSearchEnabledChange }: Props) {
  const { threads, activeThreadId, setActiveThreadId, createThread, renameThread } = useChatThread(projectId);
  const { messages, loading, sending, phase, sendMessage, budgetRemaining, refreshMessages, appendMessages, setMessages } = useChatMessages(activeThreadId);
  const { settings: userSettings } = useUserSettings();
  const { bookmarks, createBookmark, updateBookmark, deleteBookmark, getBookmarkForMessage } = useBookmarks(projectId);
  const { memory, refetch: refetchMemory } = useConversationMemory(activeThreadId);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);
  const [showMemoryPill, setShowMemoryPill] = useState(false);
  const memoryCoversRef = useRef<string | null>(null);
  useEffect(() => {
    memoryCoversRef.current = memory?.covers_through ?? null;
  }, [memory]);

  // Divider position: the first message newer than the memory's watermark
  // (-1 = everything covered → divider renders after the last message).
  // Ephemeral client ids carry toISOString() timestamps while DB rows use
  // the PostgREST format — Date-parse both sides rather than trusting the
  // string formats to align.
  const memoryDividerIndex = useMemo(() => {
    if (!memory) return null;
    const watermark = new Date(memory.covers_through).getTime();
    return messages.findIndex((m) => new Date(m.created_at).getTime() > watermark);
  }, [memory, messages]);

  // conversation-memory refresh detection — client-side by design: the
  // server refreshes AFTER `done` is sent, so no stream payload can
  // announce it. When a new message lands (chat exchange or Ask/Propose
  // insertion), schedule two quiet refetches bracketing the tail's
  // summarize time; if the watermark advanced, surface the pill (the
  // divider moves with the refetched row). Token updates re-run this
  // effect without changing the last id, so only the timers armed by the
  // final (post-done) update survive to fire.
  const lastMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;
    const prevId = lastMsgIdRef.current;
    lastMsgIdRef.current = lastId;
    if (!lastId || lastId === prevId || prevId === null) return;
    const timers = [12_000, 30_000].map((ms) =>
      setTimeout(async () => {
        const before = memoryCoversRef.current;
        const fresh = await refetchMemory();
        if (fresh && fresh.covers_through !== before) setShowMemoryPill(true);
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [messages, refetchMemory]);

  useEffect(() => {
    if (!showMemoryPill) return;
    const t = setTimeout(() => setShowMemoryPill(false), 5000);
    return () => clearTimeout(t);
  }, [showMemoryPill]);
  const [input, setInput] = useState("");
  // User preference (what they've toggled). Distinct from instance capability
  // (whether web search is configured on this deployment at all). Preserve
  // this preference even when capability is off — that way, an operator
  // adding BRAVE_SEARCH_API_KEY back later restores the user's prior toggle.
  const [localUserWantsWebSearch, setLocalUserWantsWebSearch] = useState(false);
  const userWantsWebSearch = webSearchEnabledProp ?? localUserWantsWebSearch;
  const setUserWantsWebSearch = onWebSearchEnabledChange ?? setLocalUserWantsWebSearch;
  const { webSearchEnabled: webSearchConfigured } = useInstanceConfig();
  // Effective state: send to backend & paint as active only when both true.
  const webSearchActive = userWantsWebSearch && webSearchConfigured;
  const [tipDismissed, setTipDismissed] = useState(false);
  const [showBookmarkList, setShowBookmarkList] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const pendingScrollTarget = useRef<string | null>(null);

  // Scroll-to-bookmark: watch messages for the target appearing
  useEffect(() => {
    if (!pendingScrollTarget.current) return;
    const targetId = pendingScrollTarget.current;
    const found = messages.find((m) => m.id === targetId);
    if (found) {
      pendingScrollTarget.current = null;
      // Use requestAnimationFrame to ensure DOM is rendered
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-message-id="${targetId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-2", "ring-primary/50");
          setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 2000);
        }
      });
    }
  }, [messages]);

  const handleBookmarkNavigate = useCallback((threadId: string, messageId: string) => {
    pendingScrollTarget.current = messageId;
    setShowBookmarkList(false);
    if (threadId !== activeThreadId) {
      setActiveThreadId(threadId);
      onActiveThreadChange?.(threadId);
    } else {
      // Same thread — scroll immediately
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-message-id="${messageId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-2", "ring-primary/50");
          setTimeout(() => el.classList.remove("ring-2", "ring-primary/50"), 2000);
          pendingScrollTarget.current = null;
        }
      });
    }
  }, [activeThreadId, setActiveThreadId, onActiveThreadChange]);

  // Build allMessages map for bookmark list previews
  const allMessagesRef = useRef<Record<string, ChatMessage[]>>({});
  useEffect(() => {
    if (activeThreadId && messages.length > 0) {
      allMessagesRef.current = { ...allMessagesRef.current, [activeThreadId]: messages };
    }
  }, [activeThreadId, messages]);

  // Notify parent of active thread (including initial load)
  useEffect(() => {
    onActiveThreadChange?.(activeThreadId);
  }, [activeThreadId, onActiveThreadChange]);

  // Expose setMessages to parent for Ask streaming
  useEffect(() => {
    onSetMessages?.(setMessages);
  }, [onSetMessages, setMessages]);

  // Listen for copy events within chat to tag clipboard with message role
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container || !provenanceTracker) return;

    const handleCopy = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const anchor = sel.anchorNode;
      if (!anchor) return;

      let el: HTMLElement | null = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
      while (el && el !== container) {
        if (el.dataset?.chatRole) {
          const role = el.dataset.chatRole as "user" | "assistant";
          provenanceTracker.setChatClipboardRole(role);
          return;
        }
        el = el.parentElement;
      }
    };

    container.addEventListener("copy", handleCopy);
    return () => container.removeEventListener("copy", handleCopy);
  }, [provenanceTracker]);

  // Inject messages directly when provided (from Ask/Propose flows)
  useEffect(() => {
    if (injectMessages && injectMessages.length > 0) {
      appendMessages(injectMessages);
      onMessagesInjected?.();
    }
  }, [injectMessages, appendMessages, onMessagesInjected]);

  // Refresh messages when trigger changes (e.g. after Ask/Propose)
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      refreshMessages();
    }
  }, [refreshTrigger, refreshMessages]);

  // Scroll-follow: pin to the bottom only while the user IS at the bottom.
  // Scrolling up during a stream "holds" the view (no more shove-back);
  // scrolling back down, switching threads, or sending a message
  // re-engages the follow.
  const followStreamRef = useRef(true);

  useEffect(() => {
    followStreamRef.current = true;
  }, [activeThreadId]);

  useEffect(() => {
    if (sending) followStreamRef.current = true;
  }, [sending]);

  // Scroll to bottom on new messages (when following)
  useEffect(() => {
    if (followStreamRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // While a bubble is streaming, the smoothed reveal grows the content
  // BETWEEN commits of `messages` (useSmoothedText repaints ~30Hz inside
  // the bubble), so the per-message effect above jumps in provider-clump
  // rhythm. Follow per animation frame instead, so the pane slides as
  // smoothly as the text pours — and holds when the user scrolled up.
  const hasStreamingBubble = messages.some(
    (m) => m.id === "streaming-assistant" || m.id === "streaming-ask",
  );
  useEffect(() => {
    if (!hasStreamingBubble) return;
    let raf = requestAnimationFrame(function loop() {
      if (followStreamRef.current && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [hasStreamingBubble]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const maxH = 4 * 24;
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, maxH) + "px";
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || sending) return;
    sendMessage(input, conciseMode, webSearchActive);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Keyboard shortcut: Ctrl/Cmd + Shift + K → toggle Bookmarks
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && (e.key === "K" || e.key === "k")) {
        e.preventDefault();
        setShowBookmarkList((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isMac = useMemo(() => typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform), []);
  const bookmarkShortcutLabel = isMac ? "⌘⇧K" : "Ctrl+Shift+K";

  const dismissTip = () => {
    setTipDismissed(true);
  };

  return (
    <div ref={chatContainerRef} className="relative flex flex-col h-full min-h-0 bg-[hsl(var(--ethos-surface))]">
      {/* Bookmark list overlay */}
      {showBookmarkList && (
        <BookmarkListPanel
          bookmarks={bookmarks}
          threads={threads}
          allMessages={allMessagesRef.current}
          onNavigate={handleBookmarkNavigate}
          onClose={() => setShowBookmarkList(false)}
        />
      )}

      {/* Header */}
      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          {onToggleChat && (
            <button
              onClick={onToggleChat}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md"
              aria-label={chatExpanded ? "Collapse chat panel" : "Expand chat panel"}
            >
              {chatExpanded ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          )}
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <ChatThreadSelector
            threads={threads}
            activeThreadId={activeThreadId}
            onSelect={(id) => { setActiveThreadId(id); onActiveThreadChange?.(id); }}
            onCreate={(name) => { createThread(name); }}
            onRename={renameThread}
          />
          <span className="text-[10px] text-muted-foreground/70 hidden md:inline" title="Active chat model — change in Settings">
            {MODEL_LABELS[userSettings.preferred_chat_model] ?? "Model"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowBookmarkList((v) => !v)}
                  className={`p-1 rounded-md transition-colors ${
                    showBookmarkList ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label="Toggle bookmarks"
                >
                  <BookmarkIcon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <span>Toggle Bookmarks ({bookmarkShortcutLabel})</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="text-xs text-muted-foreground">Concise</span>
          <Switch
            checked={conciseMode}
            onCheckedChange={onConciseModeChange}
            className="scale-75"
          />
        </div>
      </div>

      {/* Tip banner */}
      {!tipDismissed && (
        <div className="mx-3 mt-2 px-3 py-2 bg-primary/5 border border-primary/15 rounded-lg flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary/60" />
          <span className="flex-1">
            <span className="font-medium text-foreground">Tip:</span> Select text in
            your editor and use Ask or Propose for context-aware AI feedback.
          </span>
          <button onClick={dismissTip} className="text-muted-foreground/60 hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          followStreamRef.current = isNearBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
        }}
        className="flex-1 overflow-y-auto px-3 py-4 space-y-4"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <img src={sylouShiba} alt="Sylou" className="h-8 w-8 object-contain opacity-40 mb-2" />
            <p className="text-sm text-muted-foreground">
              Start a conversation with your AI writing assistant.
            </p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <Fragment key={msg.id}>
              {memoryDividerIndex === i && (
                <ConversationMemoryDivider onClick={() => setMemoryDialogOpen(true)} />
              )}
              <ChatBubble
                message={msg}
                bookmark={getBookmarkForMessage(msg.id)}
                onCreateBookmark={() => activeThreadId && createBookmark(activeThreadId, msg.id)}
                onUpdateBookmark={updateBookmark}
                onDeleteBookmark={deleteBookmark}
              />
            </Fragment>
          ))
        )}

        {/* All messages covered (the normal state right after a refresh):
            the divider sits at the end of the scrollback. */}
        {!loading && memory && memoryDividerIndex === -1 && (
          <ConversationMemoryDivider onClick={() => setMemoryDialogOpen(true)} />
        )}

        {sending && !messages.some((m) => m.id === "streaming-assistant" || m.id === "streaming-ask") && (
          <div className="flex gap-2.5">
            <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
              <img src={sylouShiba} alt="Sylou" className="h-3.5 w-3.5 object-contain" />
            </div>
            <div className="bg-muted rounded-xl px-3.5 py-2.5">
              {phase === "searching_web" ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Searching the web…</span>
                </div>
              ) : phase === "reading_documents" ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Reading imported documents…</span>
                </div>
              ) : (
                <div className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showMemoryPill && (
        <div className="flex justify-center py-1">
          <span className="text-[11px] text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">
            Conversation memory updated
          </span>
        </div>
      )}

      <ConversationMemoryDialog
        open={memoryDialogOpen}
        onOpenChange={setMemoryDialogOpen}
        memory={memory}
      />

      {/* Input */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="h-9 w-9 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1 mt-1.5">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                {webSearchConfigured ? (
                  <button
                    onClick={() => setUserWantsWebSearch(!userWantsWebSearch)}
                    className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-md transition-colors ${
                      webSearchActive
                        ? "text-primary bg-primary/10"
                        : "text-muted-foreground/40 hover:text-muted-foreground"
                    }`}
                    aria-label="Toggle web search"
                  >
                    <Globe className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  // Radix TooltipTrigger asChild does not forward pointer
                  // events to natively-disabled buttons. Wrap in a span so
                  // hover/focus still reach the tooltip.
                  <span tabIndex={0} className="inline-flex">
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      aria-label="Web search not configured"
                      className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground/40 opacity-40 cursor-not-allowed pointer-events-none"
                    >
                      <Globe className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent side="top">
                <span>
                  {webSearchConfigured
                    ? webSearchActive
                      ? "Web search enabled"
                      : "Enable web search"
                    : "Web search is not configured on this instance. Ask the operator to set the BRAVE_SEARCH_API_KEY environment variable to enable it."}
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {onUploadDocument && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => docFileInputRef.current?.click()}
                    disabled={documentUploading}
                    className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md transition-colors text-muted-foreground/40 hover:text-muted-foreground disabled:opacity-50"
                    aria-label="Upload document to project"
                  >
                    {documentUploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Paperclip className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span>Upload document to project (.pdf, .docx, .txt, .md)</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <input
            ref={docFileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && onUploadDocument) {
                onUploadDocument(file);
                if (docFileInputRef.current) docFileInputRef.current.value = "";
              }
            }}
          />
          {budgetRemaining != null && (
            <p className="text-[10px] text-muted-foreground/60 ml-auto">
              {budgetRemaining.toLocaleString()} tokens remaining
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground text-center pt-2">
          You're chatting with an AI assistant. AI responses may be incorrect, verify what matters.
        </p>
      </div>

    </div>
  );
}
