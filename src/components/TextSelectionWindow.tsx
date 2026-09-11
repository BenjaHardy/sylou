import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { X, Loader2, Check, XCircle, Send } from "lucide-react";
import type { ChatMessage } from "@/hooks/useChatMessages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ProvenanceTracker } from "@/lib/provenance-tracker";
import { consumeSSEStream } from "@/lib/sse-stream";
import { assessSelectionSize } from "@/lib/editor-limits";
import { LargeSelectionNotice } from "@/components/text-selection/LargeSelectionNotice";
import { TruncatedAcceptDialog } from "@/components/text-selection/TruncatedAcceptDialog";

type ActionId =
  | "fix-grammar"
  | "translate"
  | "rewrite"
  | "simplify"
  | "expand"
  | "ask"
  | "propose";


type Phase = "actions" | "loading" | "streaming" | "result" | "input";

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
  webSearchEnabled?: boolean;
  /** Source module: 'editor' (default), 'worldbuilding', 'character_chart', 'timeline' */
  sourceModule?: string;
}

const NORMAL_ACTIONS: { id: ActionId; label: string; row: 1 | 2 }[] = [
  { id: "fix-grammar", label: "Fix grammar", row: 1 },
  { id: "translate", label: "Translate", row: 1 },
  { id: "rewrite", label: "Rewrite", row: 1 },
  { id: "simplify", label: "Simplify", row: 1 },
  { id: "expand", label: "Expand", row: 1 },
  { id: "ask", label: "Ask", row: 2 },
  { id: "propose", label: "Propose", row: 2 },
];

const TUTOR_ACTIONS: { id: ActionId; label: string; row: 1 | 2 }[] = [
  { id: "fix-grammar", label: "Fix grammar", row: 1 },
  { id: "translate", label: "Translate", row: 1 },
  { id: "ask", label: "Ask", row: 1 },
];


const CREATIVE_ACTIONS: { id: ActionId; label: string; row: 1 | 2 }[] = [
  { id: "ask", label: "Ask", row: 1 },
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
  setMessages,
  webSearchEnabled,
  sourceModule = "editor",
}: Props) {
  const [phase, setPhase] = useState<Phase>("actions");
  const [activeAction, setActiveAction] = useState<ActionId | null>(null);
  const [proposedText, setProposedText] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [inputText, setInputText] = useState("");
  
  const [currentActionId, setCurrentActionId] = useState<string | null>(null);
  const [loadingStage, setLoadingStage] = useState<"reviewing" | "reading_documents" | "searching_web" | "preparing">("reviewing");
  // For propose confirm flow
  const [accepting, setAccepting] = useState(false);
  const acceptingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Large-selection safety: the server flags a reply cut off at the output
  // limit (`truncated` on the done event); Accept then asks for
  // confirmation. The editor actions hide behind a notice for selections
  // their budget cannot rewrite, until the user acknowledges it.
  const [resultTruncated, setResultTruncated] = useState(false);
  const [confirmAcceptOpen, setConfirmAcceptOpen] = useState(false);
  const [largeSelectionAcknowledged, setLargeSelectionAcknowledged] = useState(false);

  const isCreativeModule = sourceModule !== "editor";
  const actions = isCreativeModule ? CREATIVE_ACTIONS : tutorMode ? TUTOR_ACTIONS : NORMAL_ACTIONS;

  // Anchor geometry, resolved ONCE per open into the editor wrapper's
  // content coordinates (the panel is an absolute child of that scrollable
  // wrapper — see AISelectionButton). anchorRect is a viewport rect frozen
  // at open time; combining it with the LIVE scroll offset on every render
  // made the panel drift by the scroll delta on each keystroke once the
  // user had scrolled down to reach it.
  const anchor = useMemo(() => {
    const editorRect = editorElement.getBoundingClientRect();
    const scrollTop = editorElement.scrollTop;
    return {
      top: anchorRect.top - editorRect.top + scrollTop,
      bottom: anchorRect.bottom - editorRect.top + scrollTop,
      left: Math.max(
        8,
        Math.min(
          anchorRect.left - editorRect.left + editorElement.scrollLeft,
          editorElement.scrollLeft + editorRect.width - 340,
        ),
      ),
      // Visible room around the selection at open time, for the flip below.
      spaceBelow: editorRect.height - (anchorRect.bottom - editorRect.top),
      spaceAbove: anchorRect.top - editorRect.top,
    };
  }, [anchorRect, editorElement]);

  // The panel grows with its phase (actions → input → streaming → result);
  // measure it so it can sit ABOVE the selection when there is no room
  // below, keeping the selected text visible. Placed below otherwise, and
  // below as a last resort when it fits neither side.
  const [panelHeight, setPanelHeight] = useState(0);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const measure = () => setPanelHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const GAP = 8;
  const placeAbove =
    panelHeight + GAP > anchor.spaceBelow && anchor.spaceAbove >= panelHeight + GAP;
  const top = placeAbove ? Math.max(0, anchor.top - panelHeight - GAP) : anchor.bottom + GAP;
  const left = anchor.left;

  // The selection may sit at the very bottom of the visible editor: bring
  // the panel into view once on open instead of leaving it off-screen.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  // Close on Escape (the confirm dialog handles its own Escape first).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmAcceptOpen) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, confirmAcceptOpen]);

  // While a run is in flight (loading/streaming), a proposal awaits a
  // decision (result), or a CONFIRM is being recorded (accepting), the
  // window must not die to a stray outside click — and the click must not
  // reach the document either: Accept inserts at the editor's LIVE
  // selection (WritingEditor.handleAcceptProposal → insertContent), so a
  // click that moved the selection would make Accept misinsert at the
  // click point. Escape and the ✕ button remain the explicit outs; wheel
  // scrolling is untouched (capture-phase listeners, no overlay element).
  const isProtected =
    phase === "loading" || phase === "streaming" || phase === "result" || accepting;

  // Close on click outside (menu/input phases); swallow + explain while protected.
  const lastBlockedToastRef = useRef(0);
  useEffect(() => {
    if (isProtected) {
      const swallow = (e: Event) => {
        // The truncated-result confirm dialog renders in a portal outside
        // the panel; its buttons must not be swallowed.
        if (confirmAcceptOpen) return;
        if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
          e.preventDefault();
          e.stopPropagation();
          // Toast once per physical click (mousedown+click both land here),
          // throttled so rapid clicking doesn't stack a wall of them.
          if (e.type === "mousedown") {
            const now = Date.now();
            if (now - lastBlockedToastRef.current > 2500) {
              lastBlockedToastRef.current = now;
              toast.info(
                phase === "result"
                  ? "Review the proposal — Accept or Reject it, or close the window (✕ or Esc)."
                  : "An AI action is in progress — wait for it to finish, or close the window (✕ or Esc).",
              );
            }
          }
        }
      };
      document.addEventListener("mousedown", swallow, true);
      document.addEventListener("click", swallow, true);
      // Passive signal that outside interaction is blocked; the panel root
      // sets cursor-auto so its own subtree keeps normal cursors.
      document.body.style.cursor = "not-allowed";
      return () => {
        document.removeEventListener("mousedown", swallow, true);
        document.removeEventListener("click", swallow, true);
        document.body.style.cursor = "";
      };
    }
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
  }, [onClose, isProtected, phase, confirmAcceptOpen]);

  const getSourceBreakdown = useCallback(() => {
    if (isCreativeModule) return undefined;
    if (provenanceTracker && selectionFrom != null && selectionTo != null && selectionFrom < selectionTo) {
      return provenanceTracker.getSourceBreakdown(selectionFrom, selectionTo);
    }
    return undefined;
  }, [provenanceTracker, selectionFrom, selectionTo, isCreativeModule]);

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
          try { errMsg = JSON.parse(errText).error || errMsg; } catch { /* keep default errMsg */ }
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
              setResultTruncated(evt.truncated === true);
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
            source_module: sourceModule,
            concise_mode: conciseMode ?? false,
            stream: true,
            ...(selected_text_source ? { selected_text_source } : {}),
            ...(webSearchEnabled ? { web_search_enabled: true } : {}),
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          let errMsg = "AI action failed. Please try again.";
          try { errMsg = JSON.parse(errText).error || errMsg; } catch { /* keep default errMsg */ }
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
                // Propose: the exchange is already logged server-side at
                // delivery (CLAUDE.md §4) — surface it in the chat
                // now, before any decision; CONFIRM only records the outcome.
                const insertedMessages = (evt.inserted_messages as ChatMessage[]) ?? [];
                if (insertedMessages.length > 0) {
                  if (setMessages) {
                    setMessages((prev) => {
                      const existingIds = new Set(prev.map((m) => m.id));
                      return [...prev, ...insertedMessages.filter((m) => !existingIds.has(m.id))];
                    });
                  } else {
                    onAskComplete(insertedMessages);
                  }
                }
                const aiResponse = (evt.ai_response as string) || "";
                setProposedText(aiResponse);
                setResultTruncated(evt.truncated === true);
                setCurrentActionId((evt.action_id as string) ?? null);
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
            // Exchange already logged at delivery — surface it (see onDone).
            const insertedMessages = (data.inserted_messages as ChatMessage[]) ?? [];
            if (insertedMessages.length > 0) onAskComplete(insertedMessages);
            setProposedText(data.ai_response);
            setCurrentActionId(data.action_id);
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
      setResultTruncated(false);



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

  /** Body for the CONFIRM call — the server records only the decision behind
   *  an atomic pending-gate; the exchange itself was already logged at
   *  delivery, so nothing beyond the decision context is sent. */
  const buildConfirmBody = (confirm: boolean) => ({
    confirm,
    action_id: currentActionId,
    project_id: projectId,
  });

  /** Fire the CONFIRM call and surface the logged messages in the chat. */
  const confirmDecision = async (confirm: boolean) => {
    if (!currentActionId) return; // no ledger row — nothing to record
    try {
      const { data, error } = await supabase.functions.invoke("context-prompt", {
        body: buildConfirmBody(confirm),
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
  };

  const handleAccept = async () => {
    if (acceptingRef.current) return;
    acceptingRef.current = true;
    setAccepting(true);
    try {
      await confirmDecision(true);
      onAccept(proposedText);
      onClose();
    } finally {
      acceptingRef.current = false;
      setAccepting(false);
    }
  };


  const handleReject = async () => {
    // The exchange was already logged at delivery (CLAUDE.md §4);
    // this only records the rejected outcome on the action row.
    await confirmDecision(false);
    onClose();
  };

  const isProminent = (id: ActionId) => id === "ask" || id === "propose";

  const row1 = actions.filter((a) => a.row === 1);
  const row2 = actions.filter((a) => a.row === 2);
  // Only the predefined editor actions rewrite the selection within a fixed
  // output budget; Ask/Propose (row 2, or row 1 in tutor mode) are exempt.
  const selectionSize = isCreativeModule ? "ok" : assessSelectionSize(selectedText.length);
  const editorActionsGated = selectionSize !== "ok" && !largeSelectionAcknowledged;
  const renderActionButton = (a: { id: ActionId; label: string }) => (
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
  );

  return (
    <div
      ref={panelRef}
      className="absolute z-50 w-[330px] cursor-auto rounded-xl shadow-xl border border-border bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-top-2 duration-150"
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

      <p className="text-xs text-muted-foreground text-center px-3 pt-2">
        You're chatting with an AI assistant. AI responses may be incorrect, verify what matters.
      </p>

      <div className="p-3">

        {/* Actions phase */}
        {phase === "actions" && (
          <div className="space-y-2">
            {editorActionsGated ? (
              <>
                <LargeSelectionNotice
                  size={selectionSize}
                  chars={selectedText.length}
                  onAcknowledge={() => setLargeSelectionAcknowledged(true)}
                />
                {row1.some((a) => !PREDEFINED.includes(a.id)) && (
                  <div className="flex flex-wrap gap-1.5">
                    {row1.filter((a) => !PREDEFINED.includes(a.id)).map(renderActionButton)}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-wrap gap-1.5">{row1.map(renderActionButton)}</div>
            )}
            {row2.length > 0 && (
              <div className="flex flex-wrap gap-1.5">{row2.map(renderActionButton)}</div>
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
              {resultTruncated && (
                <p role="status" className="p-2 rounded-md border border-border bg-muted text-foreground">
                  The AI stopped at its output limit, this result is incomplete. Accepting will
                  ask you to confirm.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => (resultTruncated ? setConfirmAcceptOpen(true) : void handleAccept())}
                disabled={accepting}
              >
                {accepting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Inserting…
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Accept
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                onClick={handleReject}
                disabled={accepting}
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
            <TruncatedAcceptDialog
              open={confirmAcceptOpen}
              onOpenChange={setConfirmAcceptOpen}
              onConfirm={() => {
                setConfirmAcceptOpen(false);
                void handleAccept();
              }}
            />
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
