

## Plan: FLOW Pledge Badge

### Summary

Add a FLOW Pledge Badge in the Share Report section. The badge renders automatically when sharing is enabled (no generate button). It's a canvas-drawn image with "Created with Ethos — FLOW Analysed", a mini radar chart (AI scores only), and the certificate ID. Users can download it as PNG.

### Layout Change

Restructure the sharing section into a two-column grid:
- **Left**: QR code (existing, moved here)
- **Right**: Badge (auto-rendered) + Download PNG button

### New Component: `src/components/flow-report/FlowPledgeBadge.tsx`

Canvas-rendered badge (~200x120px):
- White background with subtle border
- "Created with Ethos" header, "FLOW Analysed" subtext
- Mini 4-axis radar polygon (AI scores only, blue fill) for F/L/O/W
- Certificate ID at bottom
- Badge links to shared report URL

Props:
```typescript
interface FlowPledgeBadgeProps {
  aiScores: { find: number | null; lead: number | null; organize: number | null; write: number | null };
  certificateId: string;
  shareUrl: string;
}
```

Features:
- Auto-draws on mount/prop change via `useEffect` + canvas ref
- `downloadBadge()`: `canvas.toBlob()` → download as `flow-badge-{certificateId}.png`
- Download PNG button below the canvas preview

### Changes to `FlowReportView.tsx`

In the share-enabled block, replace the single QR code div with:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
  <div className="flex flex-col items-center gap-2">
    <span className="text-xs text-muted-foreground">QR Code</span>
    <div className="bg-white p-3 rounded-lg"><QRCodeSVG ... /></div>
  </div>
  <div className="flex flex-col items-center gap-2">
    <span className="text-xs text-muted-foreground">FLOW Pledge Badge</span>
    <FlowPledgeBadge aiScores={...} certificateId={...} shareUrl={...} />
  </div>
</div>
```

### Files Changed

| File | Change |
|------|--------|
| `src/components/flow-report/FlowPledgeBadge.tsx` | New — canvas badge with mini radar, download PNG |
| `src/components/FlowReportView.tsx` | Two-column grid for QR + badge, import FlowPledgeBadge |

### No new dependencies needed

