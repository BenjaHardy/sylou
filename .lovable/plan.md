# Remove badge-source picker dialog

## Change
In `src/components/FlowReportView.tsx`, drop the dialog that currently intercepts the "Generate Share Link" button. Clicking the button calls `handleShare` directly, as it did before.

`badgeSource` state stays, initialized to `"ai"`. The existing toggle above the badges remains the sole control to switch to "Self-assessment" (still disabled when no feedback exists).

## Details
- Remove `showBadgeSourceDialog` state and the `Dialog` JSX block for the picker.
- Restore the share button's `onClick` to call `handleShare` directly (no dialog open).
- Keep the auto-force of `share_include_feedback = true` (and disabling the checkbox) when `badgeSource === "user"` — that logic lives outside the dialog and still applies via the toggle.
- Keep `FlowPledgeBadge`'s `assessmentSource` prop and subtitle rendering unchanged.
- No backend or schema changes.

## Verification
Typecheck. Manually: clicking "Generate Share Link" goes straight to the Share Report section; toggle still switches badge source; toggle's "Self-assessment" option still greys out when no pre/post feedback exists.
