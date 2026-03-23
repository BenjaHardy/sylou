import { useState, useEffect, useRef, useCallback } from "react";
import { X, Loader2, Check, Pencil, XCircle, Send } from "lucide-react";
import type { ChatMessage } from "@/hooks/useChatMessages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ProvenanceTracker } from "@/lib/provenance-tracker";

type ActionId =
  | "fix-grammar"
  | "translate"
  | "rewrite"
  | "simplify"
  | "expand"
  | "ask"
  | "propose"
  | "sanity-check";

type Phase = "actions" | "loading" | "result" | "input" | "modify";

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
}: Props) {
  const [phase, setPhase] = useState<Phase>("actions");
  const [activeAction, setActiveAction] = useState<ActionId | null>(null);
  const [proposedText, setProposedText] = useState("");
  const [inputText, setInputText] = useState("");
  const [editableText, setEditableText] = useState("");
  const [currentActionId, setCurrentActionId] = useState<string | null>(null);
  const [loadingStage, setLoadingStage] = useState<"reviewing" | "preparing">("reviewing");
  // For propose confirm flow
  const [pendingSummaryUpdate, setPendingSummaryUpdate] = useState<string | null>(null);
  const [pendingInstruction, setPendingInstruction] = useState<string>("");
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

  const callEditorAction = useCallback(
    async (actionType: string, targetLanguage?: string) => {
      setPhase("loading");
      setLoadingStage("preparing");
      try {
        const { data, error } = await supabase.functions.invoke("editor-action", {
          body: {
            project_id: projectId,
            action_type: actionType,
            selected_text: selectedText,
            ...(targetLanguage ? { target_language: targetLanguage } : {}),
          },
        });

        if (error) {
          console.error("Editor action error:", error);
          toast.error("AI action failed. Please try again.");
          setPhase("actions");
          return;
        }

        if (data?.error) {
          toast.error(data.error);
          setPhase("actions");
          return;
        }

        setProposedText(data.proposed_text);
        setCurrentActionId(data.action_id);
        // Register for manual copy/paste detection
        provenanceTracker?.registerAiResultText(data.proposed_text);
        setPhase("result");
      } catch (err) {
        console.error("Editor action failed:", err);
        toast.error("Failed to process AI action.");
        setPhase("actions");
      }
    },
    [projectId, selectedText]
  );

  const callContextPrompt = useCallback(
    async (actionType: "ask" | "propose", userInstruction: string) => {
      if (!threadId) {
        toast.error("Chat thread not available.");
        setPhase("actions");
        return;
      }

      setPhase("loading");
      setLoadingStage("reviewing");

      // Simulate two-stage: switch to "preparing" after a delay
      const stageTimer = setTimeout(() => setLoadingStage("preparing"), 3000);

      try {
        const { data, error } = await supabase.functions.invoke("context-prompt", {
          body: {
            project_id: projectId,
            thread_id: threadId,
            action_type: actionType,
            selected_text: selectedText,
            instruction: userInstruction,
            source_module: "editor",
          },
        });

        clearTimeout(stageTimer);

        if (error) {
          console.error("Context prompt error:", error);
          toast.error("AI action failed. Please try again.");
          setPhase("actions");
          return;
        }

        if (data?.error) {
          toast.error(data.error);
          setPhase("actions");
          return;
        }

        if (actionType === "ask") {
          // Messages returned by edge function — inject directly into chat
          onAskComplete(data.inserted_messages ?? []);
          onClose();
        } else {
          // Propose: show result panel with accept/modify/reject
          setProposedText(data.ai_response);
          setCurrentActionId(data.action_id);
          setPendingSummaryUpdate(data.summary_update);
          setPendingInstruction(userInstruction);
          // Register for manual copy/paste detection
          provenanceTracker?.registerAiResultText(data.ai_response);
          setPhase("result");
        }
      } catch (err) {
        clearTimeout(stageTimer);
        console.error("Context prompt failed:", err);
        toast.error("Failed to process AI action.");
        setPhase("actions");
      }
    },
    [projectId, threadId, selectedText, onAskComplete, onClose]
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
        callEditorAction(actionType);
      }
    },
    [callEditorAction]
  );

  const handleInputSubmit = () => {
    if (!inputText.trim()) return;
    if (activeAction === "ask") {
      callContextPrompt("ask", inputText.trim());
      setInputText("");
      return;
    }
    if (activeAction === "propose") {
      callContextPrompt("propose", inputText.trim());
      setInputText("");
      return;
    }
    if (activeAction === "translate") {
      callEditorAction("translate", inputText.trim());
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
              : "Preparing response…"}
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
                {phase === "result" && editableText ? null : (
                  <p className="mt-0.5 p-2 rounded-md bg-primary/10 text-foreground leading-relaxed max-h-24 overflow-y-auto">
                    {proposedText}
                  </p>
                )}
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
