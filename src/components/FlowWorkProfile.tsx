import { Card, CardContent } from "@/components/ui/card";
import { getBandForScore } from "@/lib/flowBands";
import type { FlowProfile } from "@/lib/flow-work-profiles";
import ProfilePaintingReveal from "@/components/flow-report/ProfilePaintingReveal";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PILLAR_TOOLTIPS } from "@/components/flow-report/shared-utils";

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
                    ? "text-flow-accent font-bold"
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

        {/* Painting Reveal */}
        <ProfilePaintingReveal code={profile.code} />

        {/* Pillar Breakdown */}
        <TooltipProvider>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PILLARS.map(({ key, letter, label }) => {
              const score = scores[key];
              const band = getBandForScore(score);
              const isLed = band ? score != null && score >= 3 : false;
              const isNull = score === null;

              const tileStyle = band
                ? { backgroundColor: band.bgColor, borderColor: band.color + "55" }
                : undefined;

              return (
                <div
                  key={key}
                  className="flex flex-col items-center gap-1.5 rounded-lg border p-3"
                  style={tileStyle}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold cursor-help ${
                          isLed
                            ? "text-primary-foreground"
                            : isNull
                              ? "border-2 border-dashed border-muted-foreground/30 text-muted-foreground/40"
                              : "border-2 text-muted-foreground/80"
                        }`}
                        style={
                          band && isLed
                            ? { backgroundColor: band.color }
                            : band
                              ? { borderColor: band.color }
                              : undefined
                        }
                      >
                        {letter}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      {PILLAR_TOOLTIPS[key]}
                    </TooltipContent>
                  </Tooltip>
                  <span className="text-xs font-medium text-muted-foreground">
                    {label}
                  </span>
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-center"
                    style={
                      band
                        ? { backgroundColor: band.color, color: "#fff" }
                        : { backgroundColor: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }
                    }
                  >
                    {band ? band.label : "Insufficient evidence"}
                  </span>
                </div>
              );
            })}
          </div>
        </TooltipProvider>

        {/* Contextual Note */}
        <p className="text-xs text-muted-foreground/60 text-center">
          This collaboration style reflects how you worked with the AI on this project.
        </p>
      </CardContent>
    </Card>
  );
}
