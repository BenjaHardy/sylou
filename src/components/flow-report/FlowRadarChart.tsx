import { useState } from "react";
import { Activity, Info } from "lucide-react";
import { FLOW_BANDS, FLOW_ZONE_BOUNDARIES, getBandLabel } from "@/lib/flowBands";
import type { FlowReport, FlowFeedback } from "@/hooks/useFlowAnalysis";

interface FlowRadarChartProps {
  report: FlowReport;
  userFeedback: FlowFeedback | null;
  userLabel: string;
  userColor: string;
}

const PILLARS = [
  { key: "find" as const, label: "Find", letter: "F" },
  { key: "lead" as const, label: "Lead", letter: "L" },
  { key: "organize" as const, label: "Organize", letter: "O" },
  { key: "write" as const, label: "Write", letter: "W" },
];

// SVG geometry
const SIZE = 320;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 110; // radius for full score (5.0)
const MAX_SCORE = 5;

/** Angle for each axis (top, right, bottom, left). */
const ANGLES = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

function pointFor(scoreOrRadius: number, axisIdx: number, isRadius = false) {
  const r = isRadius ? scoreOrRadius : (scoreOrRadius / MAX_SCORE) * R;
  return [CX + Math.cos(ANGLES[axisIdx]) * r, CY + Math.sin(ANGLES[axisIdx]) * r] as const;
}

function polygonPoints(scores: (number | null)[]): string {
  return scores
    .map((s, i) => {
      const [x, y] = pointFor(s ?? 0, i);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function ringPoints(boundaryScore: number): string {
  return ANGLES.map((_, i) => {
    const [x, y] = pointFor(boundaryScore, i);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export function FlowRadarChart({ report, userFeedback, userLabel, userColor }: FlowRadarChartProps) {
  const [hovered, setHovered] = useState<{ key: string; isUser: boolean } | null>(null);

  const aiScores: Record<string, number | null> = {
    find: report.ai_find?.score ?? null,
    lead: report.ai_lead?.score ?? null,
    organize: report.ai_organize?.score ?? null,
    write: report.ai_write?.score ?? null,
  };

  const aiSeries = PILLARS.map((p) => aiScores[p.key]);
  const userSeries = userFeedback
    ? PILLARS.map((p) => userFeedback[p.key as keyof FlowFeedback] ?? null)
    : null;

  const hasNullScores = aiSeries.some((s) => s == null);
  const aiStroke = "hsl(217, 91%, 60%)";

  return (
    <div className="flex flex-col items-center">
      <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <Activity className="h-4 w-4 text-primary" />
        FLOW Signature
      </h3>

      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="overflow-visible"
        role="img"
        aria-label="FLOW radar chart"
      >
        {/* Concentric band zones, drawn outermost-first so smaller rings cover larger ones. */}
        {[...FLOW_BANDS].reverse().map((band, idxFromOuter) => {
          const bandIdx = FLOW_BANDS.length - 1 - idxFromOuter;
          const outerBoundary = FLOW_ZONE_BOUNDARIES[bandIdx + 1];
          return (
            <polygon
              key={band.label}
              points={ringPoints(outerBoundary)}
              fill={band.bgColor}
              fillOpacity={0.55}
              stroke={band.color}
              strokeOpacity={0.18}
              strokeWidth={1}
            />
          );
        })}

        {/* Axes */}
        {PILLARS.map((_, i) => {
          const [x, y] = pointFor(MAX_SCORE, i);
          return (
            <line
              key={i}
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
              stroke="hsl(var(--border))"
              strokeWidth={1}
              strokeOpacity={0.6}
            />
          );
        })}

        {/* AI signature polygon */}
        <polygon
          points={polygonPoints(aiSeries)}
          fill={aiStroke}
          fillOpacity={0.18}
          stroke={aiStroke}
          strokeWidth={2}
          strokeDasharray={hasNullScores ? "6 3" : undefined}
        />
        {aiSeries.map((s, i) => {
          const isNull = s == null;
          const [x, y] = pointFor(s ?? 0, i);
          const pillar = PILLARS[i];
          return (
            <circle
              key={`ai-${i}`}
              cx={x}
              cy={y}
              r={5}
              fill={isNull ? "transparent" : aiStroke}
              stroke={aiStroke}
              strokeWidth={2}
              strokeDasharray={isNull ? "3 2" : undefined}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered({ key: pillar.key, isUser: false })}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}

        {/* User overlay polygon */}
        {userSeries && (
          <>
            <polygon
              points={polygonPoints(userSeries)}
              fill={userColor}
              fillOpacity={0.12}
              stroke={userColor}
              strokeWidth={2}
              strokeDasharray="5 3"
            />
            {userSeries.map((s, i) => {
              const [x, y] = pointFor(s ?? 0, i);
              const pillar = PILLARS[i];
              return (
                <circle
                  key={`user-${i}`}
                  cx={x}
                  cy={y}
                  r={4}
                  fill={userColor}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHovered({ key: pillar.key, isUser: true })}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })}
          </>
        )}

        {/* Axis labels (F/L/O/W) outside the polygon */}
        {PILLARS.map((p, i) => {
          const [x, y] = pointFor(MAX_SCORE + 0.7, i);
          return (
            <text
              key={p.key}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={13}
              fontWeight={700}
              fill="hsl(var(--foreground))"
            >
              {p.letter}
            </text>
          );
        })}
      </svg>

      {/* Tooltip readout */}
      <div className="mt-2 min-h-[1.25rem] text-xs text-center">
        {hovered ? (
          (() => {
            const pillar = PILLARS.find((p) => p.key === hovered.key)!;
            const score = hovered.isUser
              ? userFeedback?.[hovered.key as keyof FlowFeedback] ?? null
              : aiScores[hovered.key];
            const source = hovered.isUser ? userLabel : "AI Assessment";
            return (
              <span className="text-foreground">
                <span className="font-semibold">{pillar.label}</span> — {source}: {getBandLabel(score)}
              </span>
            );
          })()
        ) : (
          <span className="text-muted-foreground">Hover a point to see its band</span>
        )}
      </div>

      {/* Series legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: aiStroke, opacity: 0.6 }} />
          <span className="text-muted-foreground">AI Assessment</span>
        </span>
        {userSeries && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-0.5"
              style={{ backgroundColor: userColor, borderTop: `2px dashed ${userColor}` }}
            />
            <span className="text-muted-foreground">{userLabel}</span>
          </span>
        )}
      </div>

      {/* Band zone legend */}
      <div className="mt-3 w-full max-w-md">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center mb-1.5">
          Band zones (centre → edge)
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px]">
          {FLOW_BANDS.map((band) => (
            <span key={band.label} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm border"
                style={{ backgroundColor: band.bgColor, borderColor: band.color + "66" }}
              />
              <span className="text-muted-foreground">{band.label}</span>
            </span>
          ))}
        </div>
      </div>

      {hasNullScores && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-2">
          <Info className="h-3 w-3" />
          Dashed lines/markers indicate insufficient evidence
        </p>
      )}
    </div>
  );
}
