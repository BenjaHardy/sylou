import type { KeyUserContribution } from "@/hooks/useFlowAnalysis";

interface KeyUserContributionsProps {
  contributions: KeyUserContribution[] | null | undefined;
}

export function KeyUserContributions({ contributions }: KeyUserContributionsProps) {
  if (!contributions || contributions.length === 0) return null;

  // Special case: a single "Not applicable" contribution.
  const notApplicable =
    contributions.length === 1 &&
    /not\s*applicable/i.test(contributions[0]?.contribution ?? "");

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Key User Contributions
      </h4>
      <div className="bg-muted/50 rounded-lg p-5 space-y-4">
        {notApplicable ? (
          <p className="text-sm text-muted-foreground italic">
            {contributions[0].contribution}
            {contributions[0].why_it_matters ? ` — ${contributions[0].why_it_matters}` : ""}
          </p>
        ) : (
          <ol className="space-y-4 list-decimal list-inside marker:text-muted-foreground/60">
            {contributions.map((c, i) => (
              <li key={i} className="text-sm text-foreground leading-relaxed">
                <span className="font-semibold">{c.contribution}</span>
                {c.evidence && (
                  <p className="mt-1 ml-5 text-xs text-muted-foreground italic">
                    Evidence: {c.evidence}
                  </p>
                )}
                {c.why_it_matters && (
                  <p className="mt-0.5 ml-5 text-xs text-foreground/80">
                    <span className="font-medium">Why it matters:</span> {c.why_it_matters}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
