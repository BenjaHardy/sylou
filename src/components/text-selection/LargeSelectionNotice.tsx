import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EDITOR_ACTION_OUTPUT_CHARS,
  SELECTED_TEXT_MAX_CHARS,
  type SelectionSize,
} from "@/lib/editor-limits";

interface Props {
  size: Exclude<SelectionSize, "ok">;
  chars: number;
  onAcknowledge: () => void;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Shown in place of the editor actions (Fix grammar, Translate, Rewrite,
 * Simplify, Expand) when the selection is longer than their output budget
 * can rewrite. "large": the user acknowledges the risk to reveal them;
 * "too-long": the server would reject the request, so nothing to reveal.
 * Ask and Propose are unaffected — their reply length follows the request,
 * not the selection.
 */
export function LargeSelectionNotice({ size, chars, onAcknowledge }: Props) {
  return (
    <div
      role="status"
      className="rounded-lg border border-border bg-muted p-2.5 text-xs text-foreground space-y-2"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        {size === "too-long" ? (
          <p>
            Your selection is {fmt(chars)} characters — above the {fmt(SELECTED_TEXT_MAX_CHARS)}-character
            maximum the editor actions accept. Select a shorter passage (Ask and Propose below remain
            available).
          </p>
        ) : (
          <p>
            Your selection is {fmt(chars)} characters. Editor actions reply within a fixed budget of
            about {fmt(EDITOR_ACTION_OUTPUT_CHARS)} characters, so the result may be cut off — you will
            be warned before accepting it. Working passage by passage keeps results complete, and keeps
            AI-inserted text easy to trace.
          </p>
        )}
      </div>
      {size === "large" && (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAcknowledge}>
          I understand — show the editor actions
        </Button>
      )}
    </div>
  );
}
