import { useEffect, useRef, type MouseEvent } from "react";
import {
  ADDED_CLASS,
  REMOVED_CLASS,
  REMOVED_TEXT_CLASS,
  type WritingStep,
} from "@/lib/replay-diff";

type FormatTime = (timestamp: string) => string;

function caption(step: Exclude<WritingStep, { kind: "none" }>, formatTime: FormatTime): string {
  if (step.kind === "carried") {
    return `No new version at this step. Showing the version saved ${formatTime(step.savedAt)}.`;
  }
  const since = step.previousSavedAt ? formatTime(step.previousSavedAt) : "";
  switch (step.change.status) {
    case "first":
      return "First saved version.";
    case "changed":
      return `Changes since the version saved ${since}.`;
    case "formatting":
      return `Only the formatting changed since the version saved ${since}.`;
    case "identical":
      return `No change since the version saved ${since}.`;
    case "too-many":
      return `Too many changes to mark since the version saved ${since}.`;
  }
}

/** The Replay's writing panel: the version shown at this step, with the
 *  changes it brought marked when the step is that version. */
export function ReplayWritingPanel({ step, formatTime }: { step: WritingStep; formatTime: FormatTime }) {
  const textRef = useRef<HTMLDivElement>(null);
  const html = step.kind === "none" ? null : step.kind === "carried" ? step.html : step.change.html;

  // Brings the step's first change into view when it is outside the panel.
  useEffect(() => {
    const first = textRef.current?.querySelector("[data-replay-change]");
    const viewport = textRef.current?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    if (!first || !viewport) return;
    const top = first.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    if (top < 0 || top > viewport.clientHeight - 48) viewport.scrollTop += top - viewport.clientHeight / 3;
  }, [html]);

  // Opens a folded removal (its button is part of the marked HTML).
  const expand = (event: MouseEvent<HTMLDivElement>) => {
    const button = (event.target as Element).closest("[data-replay-expand]");
    if (!button) return;
    button.closest("[data-replay-change]")?.querySelector("[data-replay-rest]")?.removeAttribute("hidden");
    button.remove();
  };

  if (step.kind === "none" || html === null) {
    return <p className="text-muted-foreground text-sm italic">No writing content yet at this point.</p>;
  }
  const marked = step.kind === "version" && step.change.status === "changed";
  return (
    <>
      <div className="text-xs text-muted-foreground mb-3 space-y-1">
        <p>{caption(step, formatTime)}</p>
        {marked && (
          <p>
            <ins className={`${ADDED_CLASS} text-foreground`}>added</ins>
            {" · "}
            <span className={REMOVED_CLASS}>
              [<del className={REMOVED_TEXT_CLASS}>removed</del>]
            </span>
          </p>
        )}
      </div>
      <div
        ref={textRef}
        className="max-w-none text-sm"
        onClick={expand}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}

const words = (n: number) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;

/** One line for the event panel: how much the version changed the text. */
export function ReplayChangeSummary({ step }: { step: WritingStep }) {
  if (step.kind !== "version") {
    return (
      <p className="text-xs text-muted-foreground italic">
        Writing version saved at this timestamp. The left panel shows the document content.
      </p>
    );
  }
  const { change } = step;
  const summary = {
    first: `First saved version: ${words(change.wordsAfter)}.`,
    changed: `+${words(change.wordsAdded)} / −${words(change.wordsRemoved)} since the previous version.`,
    formatting: "No words changed since the previous version, only the formatting.",
    identical: "No change since the previous version.",
    "too-many": `Too many changes to mark: ${words(change.wordsBefore)} before, ${words(change.wordsAfter)} now.`,
  }[change.status];
  return (
    <div className="space-y-1">
      <p className="text-sm text-foreground">{summary}</p>
      {change.status === "changed" && (
        <p className="text-xs text-muted-foreground italic">The changes are marked in the writing on the left.</p>
      )}
    </div>
  );
}
