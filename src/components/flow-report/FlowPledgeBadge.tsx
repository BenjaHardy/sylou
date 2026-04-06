import { useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface FlowPledgeBadgeProps {
  aiScores: {
    find: number | null;
    lead: number | null;
    organize: number | null;
    write: number | null;
  };
  certificateId: string;
  shareUrl: string;
}

const BADGE_W = 240;
const BADGE_H = 140;
const PILLAR_KEYS = ["find", "lead", "organize", "write"] as const;
const PILLAR_LABELS = ["F", "L", "O", "W"];
const RADAR_CX = 170;
const RADAR_CY = 68;
const RADAR_R = 36;

function drawBadge(
  ctx: CanvasRenderingContext2D,
  scores: FlowPledgeBadgeProps["aiScores"],
  certificateId: string,
  dpr: number,
) {
  ctx.save();
  ctx.scale(dpr, dpr);

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
  ctx.fillText("Created with Ethos", 12, 24);

  ctx.fillStyle = "#3b82f6";
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.fillText("FLOW Analysed", 12, 42);

  // Certificate ID
  ctx.fillStyle = "#6b7280";
  ctx.font = "9px system-ui, sans-serif";
  ctx.fillText(`Certificate #${certificateId}`, 12, BADGE_H - 12);

  // Mini radar chart
  // Grid circles
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 0.5;
  for (let r = 1; r <= 3; r++) {
    const radius = (r / 3) * RADAR_R;
    ctx.beginPath();
    ctx.arc(RADAR_CX, RADAR_CY, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Axes and labels
  const angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI]; // top, right, bottom, left
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 4; i++) {
    const ax = RADAR_CX + Math.cos(angles[i]) * RADAR_R;
    const ay = RADAR_CY + Math.sin(angles[i]) * RADAR_R;
    ctx.beginPath();
    ctx.moveTo(RADAR_CX, RADAR_CY);
    ctx.lineTo(ax, ay);
    ctx.stroke();

    // Labels
    const lx = RADAR_CX + Math.cos(angles[i]) * (RADAR_R + 10);
    const ly = RADAR_CY + Math.sin(angles[i]) * (RADAR_R + 10);
    ctx.fillStyle = "#6b7280";
    ctx.font = "bold 8px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(PILLAR_LABELS[i], lx, ly);
  }

  // Score polygon
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

  // Score dots
  ctx.fillStyle = "#3b82f6";
  for (const [px, py] of points) {
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function FlowPledgeBadge({ aiScores, certificateId, shareUrl }: FlowPledgeBadgeProps) {
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
    drawBadge(ctx, aiScores, certificateId, dpr);
  }, [aiScores, certificateId]);

  const downloadBadge = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flow-badge-${certificateId}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [certificateId]);

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
