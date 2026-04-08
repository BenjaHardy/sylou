import { Card, CardContent } from "@/components/ui/card";
import type { FlowProfile } from "@/lib/flow-work-profiles";

interface FlowWorkProfileProps {
  profile: FlowProfile;
  scores: {
    find: number | null;
    lead: number | null;
    organize: number | null;
    write: number | null;
  };
  language?: string;
}

const PILLARS = [
  { key: "find" as const, letter: "F", label: "Find" },
  { key: "lead" as const, letter: "L", label: "Lead" },
  { key: "organize" as const, letter: "O", label: "Organize" },
  { key: "write" as const, letter: "W", label: "Write" },
];

export default function FlowWorkProfile({ profile, scores }: FlowWorkProfileProps) {
  return (
    <Card className="border shadow-sm">
      <CardContent className="p-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="font-mono text-3xl tracking-widest">
            {profile.code.split("").map((char, i) => (
              <span
                key={i}
                className={
                  char !== "-"
                    ? "text-[#5D89A8] font-bold"
                    : "text-muted-foreground/40"
                }
              >
                {char}
              </span>
            ))}
          </div>
          <h3 className="text-2xl font-bold text-foreground">{profile.name}</h3>
          <p className="text-muted-foreground italic">{profile.tagline}</p>
        </div>

        {/* Description */}
        <p className="text-sm leading-relaxed text-foreground/80 text-center max-w-lg mx-auto">
          {profile.description}
        </p>

        {/* Pillar Breakdown */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PILLARS.map(({ key, letter, label }) => {
            const score = scores[key];
            const isNull = score === null;
            const isLed = !isNull && score >= 3;

            return (
              <div
                key={key}
                className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 ${
                  isLed
                    ? "border-[#5D89A8]/30 bg-[#5D89A8]/5"
                    : "border-border bg-muted/30"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    isLed
                      ? "bg-[#5D89A8] text-white"
                      : isNull
                        ? "border-2 border-dashed border-muted-foreground/30 text-muted-foreground/40"
                        : "border-2 border-muted-foreground/40 text-muted-foreground/60"
                  }`}
                >
                  {letter}
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {label}
                </span>
                <span className="text-lg font-semibold text-foreground">
                  {isNull ? "N/A" : score.toFixed(1)}
                </span>
                <span
                  className={`text-[10px] font-medium ${
                    isLed
                      ? "text-[#5D89A8]"
                      : isNull
                        ? "text-muted-foreground/40"
                        : "text-muted-foreground"
                  }`}
                >
                  {isLed ? "You led" : isNull ? "N/A" : "AI assisted"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Contextual Note */}
        <p className="text-xs text-muted-foreground/60 text-center">
          This profile reflects your collaboration style on this project.
        </p>
      </CardContent>
    </Card>
  );
}
