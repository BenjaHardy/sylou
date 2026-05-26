import { useRef, useEffect, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import sylouLogo from "@/assets/sylou-logo.png";

const LOGO_H = 39;
const LOGO_W = Math.round((644 / 554) * LOGO_H);

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

const BADGE_W = 320;
const BADGE_H = 180;
const BADGE_FOOTER_URL = "Visit www.meetsylou.eu";

const QR_SIZE = 72;
const QR_X = BADGE_W - QR_SIZE - 14;
// Vertically centered between top and bottom of the badge.
const QR_Y = Math.round((BADGE_H - QR_SIZE) / 2);

const PILLAR_KEYS = ["find", "lead", "organize", "write"] as const;
const PILLAR_LABELS = ["F", "L", "O", "W"];
// Radar placed in the left area, avoiding QR on the right.
const RADAR_CX = 122;
const RADAR_CY = 88;
const RADAR_R = 38;

function drawCommonChrome(
  ctx: CanvasRenderingContext2D,
  certificateId: string,
  logoImg: HTMLImageElement | null,
) {
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0, 0, BADGE_W, BADGE_H, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#1a1a2e";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const prefix = "Created with ";
  const prefixW = ctx.measureText(prefix).width;
  ctx.fillText(prefix, 12, 24);
  if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
    // Vertically align logo around the text baseline.
    ctx.drawImage(logoImg, 12 + prefixW, 24 - LOGO_H + 4, LOGO_W, LOGO_H);
  } else {
    ctx.fillText("Sylou", 12 + prefixW, 24);
  }

  ctx.fillStyle = "#3b82f6";
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.fillText("FLOW Analysed", 12, 42);

  // Footer URL (left-aligned under "Created with Sylou")
  ctx.fillStyle = "#3b82f6";
  ctx.font = "600 9px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(BADGE_FOOTER_URL, 12, BADGE_H - 24);

  // Certificate ID
  ctx.fillStyle = "#6b7280";
  ctx.font = "9px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`Certificate #${certificateId}`, 12, BADGE_H - 10);
}

function drawQrLabel(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#6b7280";
  ctx.font = "8px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Scan to view", QR_X + QR_SIZE / 2, QR_Y + QR_SIZE + 10);
}

function drawRadar(
  ctx: CanvasRenderingContext2D,
  scores: FlowPledgeBadgeProps["aiScores"],
) {
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
  // Left content area excludes the QR on the right.
  const leftAreaW = QR_X - 12;
  const cx = 12 + leftAreaW / 2;
  let y = 78;

  ctx.fillStyle = "#5b7a99";
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("F L O W", cx, y);
  y += 18;

  ctx.fillStyle = "#1a1a2e";
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.fillText(profile.name, cx, y);
  y += 14;

  ctx.fillStyle = "#6b7280";
  ctx.font = "italic 9px system-ui, sans-serif";
  const lines = wrapLines(ctx, profile.tagline, leftAreaW - 8, 2);
  for (const line of lines) {
    ctx.fillText(line, cx, y);
    y += 11;
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  props: FlowPledgeBadgeProps,
  dpr: number,
  qrCanvas: HTMLCanvasElement | null,
  logoImg: HTMLImageElement | null,
) {
  ctx.save();
  ctx.scale(dpr, dpr);
  drawCommonChrome(ctx, props.certificateId, logoImg);
  if (props.variant === "profile" && props.profile) {
    drawProfile(ctx, props.profile);
  } else {
    drawRadar(ctx, props.aiScores);
  }
  if (qrCanvas) {
    ctx.drawImage(qrCanvas, QR_X, QR_Y, QR_SIZE, QR_SIZE);
    drawQrLabel(ctx);
  }
  ctx.restore();
}

export function FlowPledgeBadge(props: FlowPledgeBadgeProps) {
  const { certificateId, shareUrl, variant = "radar" } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const [qrReady, setQrReady] = useState(0);
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogoImg(img);
    img.src = sylouLogo;
  }, []);

  // Bump qrReady once mounted and on shareUrl change so the effect redraws after QR renders.
  useEffect(() => {
    const id = requestAnimationFrame(() => setQrReady((n) => n + 1));
    return () => cancelAnimationFrame(id);
  }, [shareUrl]);

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
    const qrCanvas =
      qrContainerRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    draw(ctx, props, dpr, qrCanvas, logoImg);
  }, [props, qrReady, logoImg]);

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
      {/* Hidden QR canvas used as image source for the badge */}
      <div ref={qrContainerRef} style={{ position: "absolute", left: -9999, top: -9999 }} aria-hidden>
        <QRCodeCanvas value={shareUrl} size={QR_SIZE * 3} includeMargin={false} level="M" />
      </div>
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
