import { FileText } from "lucide-react";
import DOMPurify from "dompurify";

interface Props {
  snapshot: string;
  capturedAt?: string;
}

export function WritingSnapshotTab({ snapshot, capturedAt }: Props) {
  const hasContent = !!snapshot && snapshot.trim().length > 0;
  const formattedDate = capturedAt
    ? new Date(capturedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 border-b border-border pb-4">
        <FileText className="h-5 w-5 text-primary mt-0.5" />
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Writing snapshot</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {formattedDate
              ? `Captured when this FLOW analysis ran on ${formattedDate}. Later edits to the project are not reflected here.`
              : "Captured at the time this FLOW analysis was run. Later edits to the project are not reflected here."}
          </p>
        </div>
      </div>

      {hasContent ? (
        <div
          className="prose prose-sm max-w-none rounded-md border border-border bg-[hsl(var(--ethos-surface))] px-6 py-5 text-foreground"
          // Snapshot is TipTap-generated HTML; sanitized for safety on the public shared report route.
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(snapshot) }}
        />
      ) : (
        <div className="rounded-md border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          No writing snapshot is available for this report (it was generated before snapshots were introduced).
        </div>
      )}
    </div>
  );
}
