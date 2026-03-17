import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { MessageSquare, Send, Bot, User, X, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useChatThread } from "@/hooks/useChatThread";
import { useChatMessages, ChatMessage } from "@/hooks/useChatMessages";
import { format } from "date-fns";

interface Props {
  projectId: string;
  chatExpanded?: boolean;
  onToggleChat?: () => void;
}

const TIP_DISMISSED_KEY = "ethos-chat-tip-dismissed";

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
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
          isUser
            ? "bg-primary/10 text-foreground"
            : "bg-muted text-foreground"
        }`}
      >
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

export function ChatPanel({ projectId }: Props) {
  const { threadId, threadName } = useChatThread(projectId);
  const { messages, loading, sending, sendMessage } = useChatMessages(threadId);
  const [input, setInput] = useState("");
  const [conciseMode, setConciseMode] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(
    () => localStorage.getItem(TIP_DISMISSED_KEY) === "true"
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    localStorage.setItem(TIP_DISMISSED_KEY, "true");
  };

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--ethos-surface))]">
      {/* Header */}
      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
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
      </div>
    </div>
  );
}
