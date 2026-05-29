import { ExternalLink } from "lucide-react";

export function FlowReportFooter() {
  return (
    <div className="border-t border-border pt-6 pb-8 mt-8 text-center space-y-2">
      <a
        href="https://www.meetsylou.eu"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
      >
        Powered by Sylou — AI-Use Transparency
        <ExternalLink className="h-3 w-3" />
      </a>
      <p className="text-[10px] text-muted-foreground">
        Learn more at{" "}
        <a
          href="https://www.meetsylou.eu"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          www.meetsylou.eu
        </a>
      </p>
    </div>
  );
}
