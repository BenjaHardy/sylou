

## Plan: Integrate FlowWorkProfile as a Tab in FLOW Report

### Approach

Add two tabs ("FLOW Report" and "FLOW Profile") to both `FlowReportView.tsx` and `SharedReport.tsx`. The existing report content goes into the first tab (default). The second tab shows the `FlowWorkProfile` component with a card-flip CSS animation on switch.

### Card Flip Effect

Add a CSS perspective container with `rotateY` transition. When switching tabs, the current content flips out (0 to 90deg) and the new content flips in (90deg to 0). This is done with a simple state toggle and CSS transition classes — no animation library needed. The keyframes will be added inline via Tailwind arbitrary values or a small CSS addition in `index.css`.

### Changes

**1. `src/components/FlowReportView.tsx`**

- Import `FlowWorkProfile` and `getFlowProfile`
- Add state: `const [activeTab, setActiveTab] = useState<"report" | "profile">("report")`
- Compute profile from report scores (only when report exists)
- Add tab switcher buttons below the header bar (inside the scroll area, above content)
- Wrap existing report content in a conditional `{activeTab === "report" && ...}`
- Add profile tab content: section heading "Your Collaboration Profile" + `<FlowWorkProfile>` wrapped in flip animation classes
- The flip animation: a wrapper div with `perspective-1000` and inner div with `transition-transform duration-500` that toggles `rotateY(180deg)` — or simpler: a fade+scale transition using existing `animate-scale-in`

**2. `src/pages/SharedReport.tsx`**

- Same pattern: import, compute profile, add tab buttons, conditional rendering
- Profile tab includes the same `FlowWorkProfile` component
- Tab buttons styled consistently with the shared report's existing design

**3. `src/index.css`** (minimal addition)

Add a `@keyframes card-flip-in` animation:
```css
@keyframes card-flip-in {
  from { transform: rotateY(90deg); opacity: 0; }
  to { transform: rotateY(0deg); opacity: 1; }
}
.animate-card-flip { animation: card-flip-in 0.5s ease-out; }
```

The flip effect triggers by using a React `key` prop tied to `activeTab`, so each tab mount plays the animation.

### Tab UI

Two small buttons below the header, styled like the existing pre/post toggle:
```tsx
<div className="flex items-center justify-center gap-1">
  <Button variant={activeTab === "report" ? "default" : "outline"} size="sm" onClick={() => setActiveTab("report")}>
    FLOW Report
  </Button>
  <Button variant={activeTab === "profile" ? "default" : "outline"} size="sm" onClick={() => setActiveTab("profile")}>
    FLOW Profile
  </Button>
</div>
```

### Profile Computation

```tsx
const profile = report ? getFlowProfile({
  find: report.ai_find?.score ?? null,
  lead: report.ai_lead?.score ?? null,
  organize: report.ai_organize?.score ?? null,
  write: report.ai_write?.score ?? null,
}) : null;
```

### Files Changed

| File | Change |
|------|--------|
| `src/index.css` | Add `card-flip-in` keyframe animation |
| `src/components/FlowReportView.tsx` | Add tab state, tab switcher, conditional rendering, FlowWorkProfile in profile tab |
| `src/pages/SharedReport.tsx` | Same tab integration for shared/public reports |

