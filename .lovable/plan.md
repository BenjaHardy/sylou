## Goal

Embed the share-link QR code directly inside each FLOW Pledge Badge PNG, and remove the standalone QR Code block from the Share Report section.

## Changes

### 1. `src/components/flow-report/FlowPledgeBadge.tsx`
- Increase badge width to make room for a small QR on the right side of the header area (new layout: `BADGE_W = 300`, `BADGE_H = 180`; tweak constants as needed for both variants).
- Render a hidden `QRCodeCanvas` (from `qrcode.react`) at ~64px with the `shareUrl`, then `drawImage` it into the badge canvas in a dedicated corner (e.g. top-right for both variants, with a small "Scan to view" label underneath in 8px gray).
- Keep all existing elements: header ("Created with Sylou" / "FLOW Analysed"), radar OR profile content, "Visit www.meetsylou.eu" footer, certificate ID.
- Re-flow the radar's `RADAR_CX/CY/R` and the profile's text block so they don't overlap the QR.
- Wait for the hidden QR canvas to be ready before drawing (use a ref + effect ordering, or `requestAnimationFrame`).

### 2. `src/components/FlowReportView.tsx`
- Delete the standalone "QR Code" block (lines ~611–617).
- Keep the two-badge grid below it unchanged (the badges themselves now contain the QR).
- Drop the now-unused `QRCodeSVG` import if no other usage remains.

### 3. `src/pages/SharedReport.tsx`
- If the shared-report page mirrors the same Share Report section, apply the same removal there. (Verify during build.)

## Out of scope

- No change to share-link generation, certificate ID, profile data, or backend.
- No change to badge download filename pattern.
