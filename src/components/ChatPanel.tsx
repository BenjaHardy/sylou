import { useState, useRef, useEffect, KeyboardEvent, useCallback } from "react";
import { MessageSquare, Send, Bot, User, X, Info, ChevronLeft, ChevronRight, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useChatThread } from "@/hooks/useChatThread";
import { useChatMessages, ChatMessage } from "@/hooks/useChatMessages";
import { format } from "date-fns";
import type { ProvenanceTracker } from "@/lib/provenance-tracker";

interface Props {
  projectId: string;
  chatExpanded?: boolean;
  onToggleChat?: () => void;
  refreshTrigger?: number;
  injectMessages?: ChatMessage[];
  onMessagesInjected?: () => void;
  provenanceTracker?: ProvenanceTracker;
}



const SOURCE_LABELS: Record<string, string> = {
  ask_prompt: "Ask · Text Selection",
  ask_response: "Ask · AI Response",
  propose_prompt: "Propose · Text Selection",
  propose_response: "Propose · AI Response",
  writing_summary: "Writing Summary Update",
};

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

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const sourceType = message.source_type ?? "chat";
  const isContextMessage = ["ask_prompt", "ask_response", "propose_prompt", "propose_response"].includes(sourceType);

  // Writing summary messages get special collapsed treatment
  if (sourceType === "writing_summary") {
    return <WritingSummaryBubble message={message} />;
  }

  const sourceLabel = SOURCE_LABELS[sourceType];

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`} data-chat-role={message.role}>
      <div
        className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
          isUser
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
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
        {sourceLabel && (
          <span className="block text-[10px] uppercase tracking-wider font-semibold text-primary/60 mb-1">
            {sourceLabel}
          </span>
        )}
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <span
          className={`block text-[10px] mt-1.5 ${
            isUser ? "text-primary/50 text-right" : "text-muted-foreground/60"
          }`}
        >
          {format(new Date(message.created_at), "h:mm a")}
        </span>
      </div>
    </div>
  );
}

export function ChatPanel({ projectId, chatExpanded, onToggleChat, refreshTrigger, injectMessages, onMessagesInjected, provenanceTracker }: Props) {
  const { threadId, threadName } = useChatThread(projectId);
  const { messages, loading, sending, sendMessage, budgetRemaining, refreshMessages, appendMessages } = useChatMessages(threadId);
  const [input, setInput] = useState("");
  const [conciseMode, setConciseMode] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Listen for copy events within chat to tag clipboard with message role
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container || !provenanceTracker) return;

    const handleCopy = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const anchor = sel.anchorNode;
      if (!anchor) return;

      // Walk up from the selection to find the nearest [data-chat-role] element
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

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const maxH = 4 * 24; // ~4 lines
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, maxH) + "px";
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || sending) return;
    sendMessage(input, conciseMode);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const dismissTip = () => {
    setTipDismissed(true);
  };

  return (
    <div ref={chatContainerRef} className="flex flex-col h-full bg-[hsl(var(--ethos-surface))]">
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
          <span className="text-sm font-medium text-foreground">{threadName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Concise</span>
          <Switch
            checked={conciseMode}
            onCheckedChange={setConciseMode}
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              Start a conversation with your AI writing assistant.
            </p>
          </div>
        ) : (
          messages.map((msg) => <ChatBubble key={msg.id} message={msg} />)
        )}

        {sending && (
          <div className="flex gap-2.5">
            <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div className="bg-muted rounded-xl px-3.5 py-2.5">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </div>

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
        {budgetRemaining != null && (
          <p className="text-[10px] text-muted-foreground/60 mt-1.5 text-right">
            {budgetRemaining.toLocaleString()} tokens remaining
          </p>
        )}
      </div>
    </div>
  );
}
