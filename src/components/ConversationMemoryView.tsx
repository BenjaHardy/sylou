import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen } from "lucide-react";
import { MarkdownImageLink } from "@/components/MarkdownImageLink";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ConversationMemory } from "@/hooks/useConversationMemory";

/**
 * The watermark divider rendered in the chat scrollback: everything above it
 * is carried in the conversation memory. Under the overlap design the
 * watermark advances to the refresh point, so the divider usually sits near
 * the bottom of the thread and glides down after each refresh.
 */
export function ConversationMemoryDivider({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex items-center gap-2 py-1 select-none">
      <div className="flex-1 border-t border-border" />
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        title="Messages above this line are carried in the conversation memory"
      >
        <BookOpen className="h-3 w-3" />
        In conversation memory · view
      </button>
      <div className="flex-1 border-t border-border" />
    </div>
  );
}

const markdownComponents = { img: MarkdownImageLink };

export function ConversationMemoryDialog({
  open,
  onOpenChange,
  memory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memory: ConversationMemory | null;
}) {
  if (!memory) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Conversation memory</DialogTitle>
          <DialogDescription>
            Covers the first {memory.covered_message_count} messages of this
            thread · updated {new Date(memory.updated_at).toLocaleString()}
            {memory.model_used ? ` · ${memory.model_used}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto rounded-md bg-muted/50 p-4">
          <div className="max-w-none text-sm text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {memory.summary_text}
            </ReactMarkdown>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Written by the AI so long conversations keep their earlier context —
          it travels with your newest messages on every reply, and recent
          messages always take precedence over it. It is never read by FLOW
          analyses.
        </p>
      </DialogContent>
    </Dialog>
  );
}
