import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { Activity, Info } from "lucide-react";
import { getScoreLabel } from "./shared-utils";
import type { FlowReport, FlowFeedback } from "@/hooks/useFlowAnalysis";

function CustomRadarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-md text-xs space-y-1">
      <p className="font-semibold text-foreground">{item.pillar}</p>
      {item.aiScore != null ? (
        <p className="text-blue-500">AI: {item.aiScore.toFixed(1)} — {getScoreLabel(item.aiScore)}</p>
      ) : (
        <p className="text-muted-foreground">AI: Insufficient evidence</p>
      )}
      {item.userScore != null && (
        <p style={{ color: item.userColor }}>
          User: {item.userScore.toFixed(1)} — {getScoreLabel(item.userScore)}
        </p>
      )}
    </div>
  );
}

interface FlowRadarChartProps {
  report: FlowReport;
  userFeedback: FlowFeedback | null;
  userLabel: string;
  userColor: string;
}

export function FlowRadarChart({ report, userFeedback, userLabel, userColor }: FlowRadarChartProps) {
  const pillars = [
    { key: "find", pillar: "Find" },
    { key: "lead", pillar: "Lead" },
    { key: "organize", pillar: "Organize" },
    { key: "write", pillar: "Write" },
  ];

  const aiScores: Record<string, number | null> = {
    find: report.ai_find.score,
    lead: report.ai_lead.score,
    organize: report.ai_organize.score,
    write: report.ai_write.score,
  };

  const data = pillars.map(({ key, pillar }) => {
    const aiRaw = aiScores[key];
    const userRaw = userFeedback?.[key as keyof FlowFeedback] ?? null;
    return {
      pillar,
      aiScore: aiRaw,
      aiDisplay: aiRaw ?? 0,
      userScore: userRaw,
      userDisplay: userRaw ?? 0,
      userColor,
      isNull: aiRaw == null,
    };
  });

  const hasNullScores = data.some((d) => d.isNull);
  const hasUser = userFeedback != null;

  const aiStroke = "hsl(217, 91%, 60%)";
  const aiFill = "hsl(217, 91%, 60%)";
  const userStroke = userColor;
  const userFill = userColor;

  return (
    <div className="flex flex-col items-center">
      <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <Activity className="h-4 w-4 text-primary" />
        FLOW Signature
      </h3>
      <ResponsiveContainer width={320} height={260}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="75%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="pillar"
            tick={{ fill: "hsl(var(--foreground))", fontSize: 12, fontWeight: 600 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 5]}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            tickCount={6}
          />
          <Radar
            name="AI Assessment"
            dataKey="aiDisplay"
            stroke={aiStroke}
            fill={aiFill}
            fillOpacity={0.25}
            strokeWidth={2}
            strokeDasharray={hasNullScores ? "6 3" : undefined}
            dot={({ cx, cy, index }: any) => {
              const d = data[index];
              if (d?.isNull) {
                return (
                  <circle key={index} cx={cx} cy={cy} r={4} fill="none" stroke={aiStroke} strokeWidth={2} strokeDasharray="3 2" />
                );
              }
              return <circle key={index} cx={cx} cy={cy} r={4} fill={aiStroke} />;
            }}
          />
          {hasUser && (
            <Radar
              name={userLabel}
              dataKey="userDisplay"
              stroke={userStroke}
              fill={userFill}
              fillOpacity={0.2}
              strokeWidth={2}
              dot={{ r: 3, fill: userStroke }}
            />
          )}
          <RechartsTooltip content={<CustomRadarTooltip />} />
        </RadarChart>
      </ResponsiveContainer>

      <div className="flex items-center gap-4 mt-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: aiFill, opacity: 0.6 }} />
          <span className="text-muted-foreground">Blue = AI Assessment</span>
        </span>
        {hasUser && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: userFill, opacity: 0.6 }} />
            <span className="text-muted-foreground">{userLabel === "Pre-analysis" ? "Green = User Assessment (Pre-analysis)" : "Orange = User Assessment (Post-analysis)"}</span>
          </span>
        )}
      </div>

      {hasNullScores && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
          <Info className="h-3 w-3" />
          Dashed lines/markers indicate insufficient evidence
        </p>
      )}
    </div>
  );
}
