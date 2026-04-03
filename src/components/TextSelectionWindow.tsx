import { useState, useEffect, useRef, useCallback } from "react";
import { X, Loader2, Check, Pencil, XCircle, Send } from "lucide-react";
import type { ChatMessage } from "@/hooks/useChatMessages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ProvenanceTracker } from "@/lib/provenance-tracker";
import { consumeSSEStream } from "@/lib/sse-stream";

type ActionId =
  | "fix-grammar"
  | "translate"
  | "rewrite"
  | "simplify"
  | "expand"
  | "ask"
  | "propose"
  | "sanity-check";

type Phase = "actions" | "loading" | "streaming" | "result" | "input" | "modify";

interface Props {
  selectedText: string;
  anchorRect: DOMRect;
  editorElement: HTMLElement;
  tutorMode: boolean;
  projectId: string;
  threadId: string | null;
  onClose: () => void;
  onAccept: (text: string) => void;
  onAskComplete: (messages: ChatMessage[]) => void;
  onChatRefresh?: () => void;
  provenanceTracker?: ProvenanceTracker;
  conciseMode?: boolean;
  selectionFrom?: number;
  selectionTo?: number;
  /** For Ask streaming: set streaming message into chat */
  appendMessages?: (msgs: ChatMessage[]) => void;
  setMessages?: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
}

const NORMAL_ACTIONS: { id: ActionId; label: string; row: 1 | 2 }[] = [
  { id: "fix-grammar", label: "Fix grammar", row: 1 },
  { id: "translate", label: "Translate", row: 1 },
  { id: "rewrite", label: "Rewrite", row: 1 },
  { id: "simplify", label: "Simplify", row: 1 },
  { id: "expand", label: "Expand", row: 1 },
  { id: "ask", label: "Ask", row: 2 },
  { id: "propose", label: "Propose", row: 2 },
  { id: "sanity-check", label: "Sanity Check", row: 2 },
];

const TUTOR_ACTIONS: { id: ActionId; label: string; row: 1 | 2 }[] = [
  { id: "fix-grammar", label: "Fix grammar", row: 1 },
  { id: "translate", label: "Translate", row: 1 },
  { id: "ask", label: "Ask", row: 1 },
  { id: "sanity-check", label: "Sanity Check", row: 1 },
];

const PREDEFINED: ActionId[] = ["fix-grammar", "translate", "rewrite", "simplify", "expand"];

/** Map UI action id to edge function action_type */
const ACTION_TYPE_MAP: Record<string, string> = {
  "fix-grammar": "fix_grammar",
  rewrite: "rewrite",
  simplify: "simplify",
  expand: "expand",
  translate: "translate",
};

async function updateOutcome(actionId: string, outcome: string) {
  const { error } = await supabase
    .from("ai_editor_actions")
    .update({ outcome })
    .eq("id", actionId);
  if (error) console.error("Failed to update action outcome:", error);
}

/** Get fresh auth headers for raw fetch calls */
async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function TextSelectionWindow({
  selectedText,
  anchorRect,
  editorElement,
  tutorMode,
  projectId,
  threadId,
  onClose,
  onAccept,
  onAskComplete,
  onChatRefresh,
  provenanceTracker,
  conciseMode,
  selectionFrom,
  selectionTo,
  appendMessages,
  setMessages,
}: Props) {
  const [phase, setPhase] = useState<Phase>("actions");
  const [activeAction, setActiveAction] = useState<ActionId | null>(null);
  const [proposedText, setProposedText] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [inputText, setInputText] = useState("");
  const [editableText, setEditableText] = useState("");
  const [currentActionId, setCurrentActionId] = useState<string | null>(null);
  const [loadingStage, setLoadingStage] = useState<"reviewing" | "reading_documents" | "searching_web" | "preparing">("reviewing");
  // For propose confirm flow
  const [pendingSummaryUpdate, setPendingSummaryUpdate] = useState<string | null>(null);
  const [pendingInstruction, setPendingInstruction] = useState<string>("");
  const [pendingSourceBreakdown, setPendingSourceBreakdown] = useState<string | null>(null);
  const [pendingDocumentsReferenced, setPendingDocumentsReferenced] = useState<string[] | null>(null);
  const [pendingWebSearchesPerformed, setPendingWebSearchesPerformed] = useState<string[] | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const actions = tutorMode ? TUTOR_ACTIONS : NORMAL_ACTIONS;

  // Position the panel
  const editorRect = editorElement.getBoundingClientRect();
  const top = anchorRect.bottom - editorRect.top + 8;
  const left = Math.max(
    8,
    Math.min(
      anchorRect.left - editorRect.left,
      editorRect.width - 340
    )
  );

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  const getSourceBreakdown = useCallback(() => {
    if (provenanceTracker && selectionFrom != null && selectionTo != null && selectionFrom < selectionTo) {
      return provenanceTracker.getSourceBreakdown(selectionFrom, selectionTo);
    }
    return undefined;
  }, [provenanceTracker, selectionFrom, selectionTo]);

  // ── Streaming editor-action (predefined actions) ──
  const callEditorActionStreaming = useCallback(
    async (actionType: string, targetLanguage?: string) => {
      setPhase("loading");
      setLoadingStage("preparing");
      setStreamingText("");

      const headers = await getAuthHeaders();
      if (!headers) {
        toast.error("Not authenticated.");
        setPhase("actions");
        return;
      }

      try {
        const selected_text_source = getSourceBreakdown();
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/editor-action`;

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            project_id: projectId,
            action_type: actionType,
            selected_text: selectedText,
            stream: true,
            ...(targetLanguage ? { target_language: targetLanguage } : {}),
            ...(selected_text_source ? { selected_text_source } : {}),
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          let errMsg = "AI action failed. Please try again.";
          try { errMsg = JSON.parse(errText).error || errMsg; } catch {}
          toast.error(errMsg);
          setPhase("actions");
          return;
        }

        const contentType = res.headers.get("content-type") ?? "";

        if (contentType.includes("text/event-stream") && res.body) {
          setPhase("streaming");

          await consumeSSEStream(res.body, {
            onToken: (text) => {
              setStreamingText((prev) => prev + text);
            },
            onDone: (evt) => {
              const result = (evt.result as string) || "";
              setProposedText(result);
              setCurrentActionId((evt.action_id as string) ?? null);
              provenanceTracker?.registerAiResultText(result);
              setPhase("result");
            },
            onError: (err) => {
              console.error("Editor action stream error:", err);
              toast.error("AI action failed. Please try again.");
              setPhase("actions");
              setStreamingText("");
            },
          });
        } else {
          // JSON fallback
          const data = await res.json();
          if (data?.error) {
            toast.error(data.error);
            setPhase("actions");
            return;
          }
          setProposedText(data.proposed_text);
          setCurrentActionId(data.action_id);
          provenanceTracker?.registerAiResultText(data.proposed_text);
          setPhase("result");
        }
      } catch (err) {
        console.error("Editor action failed:", err);
        toast.error("Failed to process AI action.");
        setPhase("actions");
        setStreamingText("");
      }
    },
    [projectId, selectedText, getSourceBreakdown, provenanceTracker]
  );

  // ── Streaming context-prompt (Ask / Propose) ──
  const callContextPromptStreaming = useCallback(
    async (actionType: "ask" | "propose", userInstruction: string) => {
      if (!threadId) {
        toast.error("Chat thread not available.");
        setPhase("actions");
        return;
      }

      setPhase("loading");
      setLoadingStage("reviewing");
      setStreamingText("");

      const headers = await getAuthHeaders();
      if (!headers) {
        toast.error("Not authenticated.");
        setPhase("actions");
        return;
      }

      try {
        const selected_text_source = getSourceBreakdown();
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/context-prompt`;

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            project_id: projectId,
            thread_id: threadId,
            action_type: actionType,
            selected_text: selectedText,
            instruction: userInstruction,
            source_module: "editor",
            concise_mode: conciseMode ?? false,
            stream: true,
            ...(selected_text_source ? { selected_text_source } : {}),
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          let errMsg = "AI action failed. Please try again.";
          try { errMsg = JSON.parse(errText).error || errMsg; } catch {}
          toast.error(errMsg);
          setPhase("actions");
          return;
        }

        const contentType = res.headers.get("content-type") ?? "";

        if (contentType.includes("text/event-stream") && res.body) {
          // For Ask: insert streaming placeholder into chat
          if (actionType === "ask" && setMessages) {
            const streamingAskMsg: ChatMessage = {
              id: "streaming-ask",
              thread_id: threadId,
              role: "assistant",
              content: "",
              created_at: new Date().toISOString(),
              source_type: "ask_response",
              flow_flag: null,
              concise_mode: null,
              tutor_mode: null,
              model_used: null,
            };
            setMessages((prev) => [...prev, streamingAskMsg]);
          }

          // For Propose: show streaming in the window
          if (actionType === "propose") {
            setPhase("streaming");
          }

          await consumeSSEStream(res.body, {
            onPhase: (p) => {
              if (p === "responding") {
                setLoadingStage("preparing");
              } else if (p === "reading_documents") {
                setLoadingStage("reading_documents");
              } else if (p === "searching_web") {
                setLoadingStage("searching_web");
              }
            },
            onToken: (text) => {
              if (actionType === "ask" && setMessages) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === "streaming-ask"
                      ? { ...m, content: m.content + text }
                      : m
                  )
                );
              } else {
                setStreamingText((prev) => prev + text);
              }
            },
            onDone: (evt) => {
              if (actionType === "ask") {
                // Replace streaming placeholder with final messages
                const insertedMessages = (evt.inserted_messages as ChatMessage[]) ?? [];
                if (setMessages) {
                  setMessages((prev) => {
                    const without = prev.filter((m) => m.id !== "streaming-ask");
                    const existingIds = new Set(without.map((m) => m.id));
                    const deduped = insertedMessages.filter((m) => !existingIds.has(m.id));
                    return [...without, ...deduped];
                  });
                } else {
                  onAskComplete(insertedMessages);
                }
                onClose();
              } else {
                // Propose: populate result
                const aiResponse = (evt.ai_response as string) || "";
                setProposedText(aiResponse);
                setCurrentActionId((evt.action_id as string) ?? null);
                setPendingSummaryUpdate((evt.summary_update as string) ?? null);
                setPendingInstruction(userInstruction);
                setPendingSourceBreakdown(selected_text_source ?? null);
                setPendingDocumentsReferenced((evt.documents_referenced as string[]) ?? null);
                setPendingWebSearchesPerformed((evt.web_searches_performed as string[]) ?? null);
                provenanceTracker?.registerAiResultText(aiResponse);
                setPhase("result");
              }
            },
            onError: (err) => {
              console.error("Context prompt stream error:", err);
              if (actionType === "ask" && setMessages) {
                setMessages((prev) => prev.filter((m) => m.id !== "streaming-ask"));
              }
              toast.error("AI action failed. Please try again.");
              setPhase("actions");
              setStreamingText("");
            },
          });
        } else {
          // JSON fallback (non-streaming)
          const data = await res.json();
          if (data?.error) {
            toast.error(data.error);
            setPhase("actions");
            return;
          }

          if (actionType === "ask") {
            onAskComplete(data.inserted_messages ?? []);
            onClose();
          } else {
            setProposedText(data.ai_response);
            setCurrentActionId(data.action_id);
            setPendingSummaryUpdate(data.summary_update);
            setPendingInstruction(userInstruction);
            setPendingSourceBreakdown(selected_text_source ?? null);
            setPendingDocumentsReferenced(data.documents_referenced ?? null);
            setPendingWebSearchesPerformed(data.web_searches_performed ?? null);
            provenanceTracker?.registerAiResultText(data.ai_response);
            setPhase("result");
          }
        }
      } catch (err) {
        console.error("Context prompt failed:", err);
        toast.error("Failed to process AI action.");
        setPhase("actions");
        setStreamingText("");
      }
    },
    [projectId, threadId, selectedText, onAskComplete, onClose, getSourceBreakdown, conciseMode, provenanceTracker, setMessages]
  );

  const handleAction = useCallback(
    (actionId: ActionId) => {
      setActiveAction(actionId);

      if (actionId === "sanity-check") {
        return;
      }

      if (actionId === "ask" || actionId === "propose") {
        setPhase("input");
        return;
      }

      if (PREDEFINED.includes(actionId)) {
        const actionType = ACTION_TYPE_MAP[actionId];
        if (actionId === "translate") {
          setPhase("input");
          return;
        }
        callEditorActionStreaming(actionType);
      }
    },
    [callEditorActionStreaming]
  );

  const handleInputSubmit = () => {
    if (!inputText.trim()) return;
    if (activeAction === "ask") {
      callContextPromptStreaming("ask", inputText.trim());
      setInputText("");
      return;
    }
    if (activeAction === "propose") {
      callContextPromptStreaming("propose", inputText.trim());
      setInputText("");
      return;
    }
    if (activeAction === "translate") {
      callEditorActionStreaming("translate", inputText.trim());
      setInputText("");
      return;
    }
  };

  const handleAccept = async () => {
    // For propose actions with pending summary, confirm (works with or without action_id)
    if (pendingSummaryUpdate !== null) {
      try {
        const { data, error } = await supabase.functions.invoke("context-prompt", {
          body: {
            confirm: true,
            action_id: currentActionId,
            summary_update: pendingSummaryUpdate,
            thread_id: threadId,
            project_id: projectId,
            selected_text: selectedText,
            instruction: pendingInstruction,
            ai_response: proposedText,
            ...(pendingSourceBreakdown ? { selected_text_source: pendingSourceBreakdown } : {}),
            ...(pendingDocumentsReferenced && pendingDocumentsReferenced.length > 0 ? { documents_referenced: pendingDocumentsReferenced } : {}),
            ...(pendingWebSearchesPerformed && pendingWebSearchesPerformed.length > 0 ? { web_searches_performed: pendingWebSearchesPerformed } : {}),
          },
        });
        if (error) {
          console.error("Confirm error:", error);
          toast.error("Failed to log proposal to chat.");
          onChatRefresh?.();
        } else {
          const msgs = data?.inserted_messages ?? [];
          if (msgs.length > 0) {
            onAskComplete(msgs);
          } else {
            onChatRefresh?.();
          }
        }
      } catch (err) {
        console.error("Failed to confirm propose:", err);
        toast.error("Failed to log proposal to chat.");
        onChatRefresh?.();
      }
    } else if (currentActionId) {
      updateOutcome(currentActionId, "accepted");
    }
    onAccept(proposedText);
    onClose();
  };

  const handleAcceptModified = async () => {
    if (pendingSummaryUpdate !== null) {
      try {
        const { data, error } = await supabase.functions.invoke("context-prompt", {
          body: {
            confirm: true,
            modified: true,
            action_id: currentActionId,
            summary_update: pendingSummaryUpdate,
            thread_id: threadId,
            project_id: projectId,
            selected_text: selectedText,
            instruction: pendingInstruction,
            ai_response: editableText,
            ...(pendingSourceBreakdown ? { selected_text_source: pendingSourceBreakdown } : {}),
            ...(pendingDocumentsReferenced && pendingDocumentsReferenced.length > 0 ? { documents_referenced: pendingDocumentsReferenced } : {}),
          },
        });
        if (error) {
          console.error("Confirm modified error:", error);
          toast.error("Failed to log proposal to chat.");
          onChatRefresh?.();
        } else {
          const msgs = data?.inserted_messages ?? [];
          if (msgs.length > 0) {
            onAskComplete(msgs);
          } else {
            onChatRefresh?.();
          }
        }
      } catch (err) {
        console.error("Failed to confirm modified propose:", err);
        toast.error("Failed to log proposal to chat.");
        onChatRefresh?.();
      }
    } else if (currentActionId) {
      updateOutcome(currentActionId, "modified");
    }
    onAccept(editableText);
    onClose();
  };

  const handleReject = async () => {
    if (pendingSummaryUpdate !== null) {
      try {
        await supabase.functions.invoke("context-prompt", {
          body: {
            confirm: false,
            action_id: currentActionId,
            project_id: projectId,
          },
        });
      } catch (err) {
        console.error("Failed to reject propose:", err);
      }
    } else if (currentActionId) {
      updateOutcome(currentActionId, "rejected");
    }
    onClose();
  };

  const isProminent = (id: ActionId) => id === "ask" || id === "propose";

  const row1 = actions.filter((a) => a.row === 1);
  const row2 = actions.filter((a) => a.row === 2);

  // The text to show in the "Proposed" area during streaming
  const displayedProposedText = phase === "streaming" ? streamingText : proposedText;

  return (
    <div
      ref={panelRef}
      className="absolute z-50 w-[330px] rounded-xl shadow-xl border border-border bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-top-2 duration-150"
      style={{ top, left }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          AI Actions
        </span>
        <button
          onClick={onClose}
          className="h-5 w-5 rounded-sm flex items-center justify-center hover:bg-accent transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-3">
        {/* Actions phase */}
        {phase === "actions" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {row1.map((a) => (
                <button
                  key={a.id}
                  onClick={() => handleAction(a.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    isProminent(a.id)
                      ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                      : "bg-secondary text-secondary-foreground border-border hover:bg-accent"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {row2.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {row2.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => handleAction(a.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                      isProminent(a.id)
                        ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                        : "bg-secondary text-secondary-foreground border-border hover:bg-accent"
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Loading phase with two stages */}
        {phase === "loading" && (
          <div className="flex items-center justify-center py-6 gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {loadingStage === "reviewing"
              ? "Reviewing your writing…"
              : loadingStage === "reading_documents"
              ? "Reading imported documents…"
              : loadingStage === "searching_web"
              ? "Searching the web…"
              : "Preparing response…"}
          </div>
        )}

        {/* Streaming phase — show Original + growing Proposed, buttons disabled */}
        {phase === "streaming" && (
          <div className="space-y-3">
            <div className="space-y-2 text-xs">
              <div>
                <span className="font-semibold text-muted-foreground">Original:</span>
                <p className="mt-0.5 p-2 rounded-md bg-muted text-foreground leading-relaxed max-h-24 overflow-y-auto">
                  {selectedText.slice(0, 200)}
                  {selectedText.length > 200 && "…"}
                </p>
              </div>
              <div>
                <span className="font-semibold text-muted-foreground">Proposed:</span>
                <p className="mt-0.5 p-2 rounded-md bg-primary/10 text-foreground leading-relaxed max-h-24 overflow-y-auto">
                  {streamingText}
                  <span className="inline-block w-1.5 h-3.5 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 opacity-50 pointer-events-none">
              <Button size="sm" className="h-7 text-xs gap-1" disabled>
                <Check className="h-3.5 w-3.5" />
                Accept
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled>
                <Pencil className="h-3.5 w-3.5" />
                Modify
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive" disabled>
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          </div>
        )}

        {/* Result phase */}
        {phase === "result" && (
          <div className="space-y-3">
            <div className="space-y-2 text-xs">
              <div>
                <span className="font-semibold text-muted-foreground">Original:</span>
                <p className="mt-0.5 p-2 rounded-md bg-muted text-foreground leading-relaxed max-h-24 overflow-y-auto">
                  {selectedText.slice(0, 200)}
                  {selectedText.length > 200 && "…"}
                </p>
              </div>
              <div>
                <span className="font-semibold text-muted-foreground">Proposed:</span>
                <p className="mt-0.5 p-2 rounded-md bg-primary/10 text-foreground leading-relaxed max-h-24 overflow-y-auto">
                  {proposedText}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleAccept}
              >
                <Check className="h-3.5 w-3.5" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => {
                  setEditableText(proposedText);
                  setPhase("modify");
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Modify
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                onClick={handleReject}
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          </div>
        )}

        {/* Modify phase */}
        {phase === "modify" && (
          <div className="space-y-3">
            <div className="space-y-2 text-xs">
              <div>
                <span className="font-semibold text-muted-foreground">Original:</span>
                <p className="mt-0.5 p-2 rounded-md bg-muted text-foreground leading-relaxed max-h-20 overflow-y-auto">
                  {selectedText.slice(0, 200)}
                  {selectedText.length > 200 && "…"}
                </p>
              </div>
              <div>
                <span className="font-semibold text-muted-foreground">Edit proposal:</span>
                <Textarea
                  value={editableText}
                  onChange={(e) => setEditableText(e.target.value)}
                  className="mt-0.5 text-xs min-h-[60px] resize-none"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleAcceptModified}
              >
                <Check className="h-3.5 w-3.5" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setPhase("result")}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Input phase (Ask / Propose / Translate) */}
        {phase === "input" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {activeAction === "ask"
                ? "Type your question about the selected text…"
                : activeAction === "translate"
                ? "Enter the target language…"
                : "Describe what you want…"}
            </p>
            <Textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                activeAction === "ask"
                  ? "e.g. What does this paragraph imply?"
                  : activeAction === "translate"
                  ? "e.g. French, Spanish, German…"
                  : "e.g. Make this more formal and add a conclusion"
              }
              className="text-xs min-h-[60px] resize-none"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleInputSubmit();
                }
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleInputSubmit}
                disabled={!inputText.trim()}
              >
                <Send className="h-3.5 w-3.5" />
                Submit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setPhase("actions");
                  setActiveAction(null);
                  setInputText("");
                }}
              >
                Back
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
