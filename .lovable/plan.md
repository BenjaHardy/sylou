Remove the outdated "Sylou token budget" sentence from the Models tab footer in SettingsDialog.

**File:** `src/components/SettingsDialog.tsx`

**Change:** In the models tab footer paragraph (currently lines 151-156), delete the sentence:
> "Your actual usage is metered against your Sylou token budget, not billed per-token at these rates."

**Resulting text:**
> Indicative provider rates as of June 2026 — shown for transparency. Switching models takes effect on your next prompt; in-flight requests finish on the previous model.

No other UI or logic changes.