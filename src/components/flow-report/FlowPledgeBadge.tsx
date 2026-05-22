import { useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export type FlowPledgeBadgeVariant = "radar" | "profile";

interface FlowPledgeBadgeProps {
  aiScores: {
    find: number | null;
    lead: number | null;
    organize: number | null;
    write: number | null;
  };
  certificateId: string;
  shareUrl: string;
  variant?: FlowPledgeBadgeVariant;
  profile?: {
    code: string;
    name: string;
    tagline: string;
  };
}

const BADGE_W = 260;
const BADGE_H = 160;
const BADGE_FOOTER_URL = "Visit www.meetsylou.eu";

const PILLAR_KEYS = ["find", "lead", "organize", "write"] as const;
const PILLAR_LABELS = ["F", "L", "O", "W"];
const RADAR_CX = 185;
const RADAR_CY = 72;
const RADAR_R = 34;

function drawCommonChrome(
  ctx: CanvasRenderingContext2D,
  certificateId: string,
) {
  // Background
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0, 0, BADGE_W, BADGE_H, 8);
  ctx.fill();
  ctx.stroke();

  // Header text
  ctx.fillStyle = "#1a1a2e";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Created with Sylou", 12, 24);

  ctx.fillStyle = "#3b82f6";
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.fillText("FLOW Analysed", 12, 42);

  // Footer URL (centered)
  ctx.fillStyle = "#3b82f6";
  ctx.font = "600 9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(BADGE_FOOTER_URL, BADGE_W / 2, BADGE_H - 24);

  // Certificate ID
  ctx.fillStyle = "#6b7280";
  ctx.font = "9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`Certificate #${certificateId}`, BADGE_W / 2, BADGE_H - 10);
}

function drawRadar(
  ctx: CanvasRenderingContext2D,
  scores: FlowPledgeBadgeProps["aiScores"],
) {
  // Grid circles
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 0.5;
  for (let r = 1; r <= 3; r++) {
    const radius = (r / 3) * RADAR_R;
    ctx.beginPath();
    ctx.arc(RADAR_CX, RADAR_CY, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  const angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 4; i++) {
    const ax = RADAR_CX + Math.cos(angles[i]) * RADAR_R;
    const ay = RADAR_CY + Math.sin(angles[i]) * RADAR_R;
    ctx.beginPath();
    ctx.moveTo(RADAR_CX, RADAR_CY);
    ctx.lineTo(ax, ay);
    ctx.stroke();

    const lx = RADAR_CX + Math.cos(angles[i]) * (RADAR_R + 10);
    const ly = RADAR_CY + Math.sin(angles[i]) * (RADAR_R + 10);
    ctx.fillStyle = "#6b7280";
    ctx.font = "bold 8px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(PILLAR_LABELS[i], lx, ly);
  }

  ctx.beginPath();
  const points: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const score = scores[PILLAR_KEYS[i]] ?? 0;
    const r = (score / 5) * RADAR_R;
    const px = RADAR_CX + Math.cos(angles[i]) * r;
    const py = RADAR_CY + Math.sin(angles[i]) * r;
    points.push([px, py]);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
  ctx.fill();
  ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#3b82f6";
  for (const [px, py] of points) {
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(trial).width <= maxWidth) {
      cur = trial;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // Ellipsis if there's leftover
  const joined = lines.join(" ");
  if (joined.length < text.length && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (ctx.measureText(last + "…").width > maxWidth && last.length > 0) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = last + "…";
  }
  return lines;
}

function drawProfile(
  ctx: CanvasRenderingContext2D,
  profile: NonNullable<FlowPledgeBadgeProps["profile"]>,
) {
  const cx = BADGE_W / 2;
  let y = 70;

  // "FLOW" label
  ctx.fillStyle = "#5b7a99"; // Silver Lake Blue-ish
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  // letter-spacing via manual draw
  const flow = "F L O W";
  ctx.fillText(flow, cx, y);
  y += 18;

  // Profile name
  ctx.fillStyle = "#1a1a2e";
  ctx.font = "bold 15px system-ui, sans-serif";
  ctx.fillText(profile.name, cx, y);
  y += 16;

  // Tagline (italic, wrapped)
  ctx.fillStyle = "#6b7280";
  ctx.font = "italic 10px system-ui, sans-serif";
  const lines = wrapLines(ctx, profile.tagline, BADGE_W - 28, 2);
  for (const line of lines) {
    ctx.fillText(line, cx, y);
    y += 12;
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  props: FlowPledgeBadgeProps,
  dpr: number,
) {
  ctx.save();
  ctx.scale(dpr, dpr);
  drawCommonChrome(ctx, props.certificateId);
  if (props.variant === "profile" && props.profile) {
    drawProfile(ctx, props.profile);
  } else {
    drawRadar(ctx, props.aiScores);
  }
  ctx.restore();
}

export function FlowPledgeBadge(props: FlowPledgeBadgeProps) {
  const { certificateId, shareUrl, variant = "radar" } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = BADGE_W * dpr;
    canvas.height = BADGE_H * dpr;
    canvas.style.width = `${BADGE_W}px`;
    canvas.style.height = `${BADGE_H}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw(ctx, props, dpr);
  }, [props]);

  const downloadBadge = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flow-badge-${variant}-${certificateId}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [certificateId, variant]);

  return (
    <div className="flex flex-col items-center gap-2">
      <a href={shareUrl} target="_blank" rel="noopener noreferrer">
        <canvas
          ref={canvasRef}
          className="rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
        />
      </a>
      <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={downloadBadge}>
        <Download className="h-3 w-3" />
        Download PNG
      </Button>
    </div>
  );
}
