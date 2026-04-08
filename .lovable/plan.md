

## Revised Plan: Template-Specific System Prompts + Tier Gating

### Confirmed Design Decisions

- **Prompt order**: base (classic/tutor) → template addition → concise modifier → document index → web search. Template establishes context first; modifiers refine on top.
- **Downgraded tiers**: Tier gate is creation-only. Edge functions read `project.template` from DB and always apply the prompt. Existing projects are unaffected by tier changes.
- **Profile access**: `NewProjectDialog` already imports `useProfile` and reads `subscription_tier`. No new wiring needed.

### Changes

**1. `supabase/functions/chat/index.ts`**

- Update project select from `"tutor_mode"` to `"tutor_mode, template"` (line 251)
- After base prompt selection (line 321) and before concise modifier (line 323), insert template prompt:

```ts
const TEMPLATE_PROMPTS: Record<string, string> = {
  academic: "This is an academic writing project. The user may be working on essays, papers, or research work. Importance of using reputable or reliable information and sources.",
  creative: "This is a creative writing project. The user may be working on fiction, poetry, or narrative work.",
  professional: "This is a professional writing project. The user may be working on business documents, reports, or communications. Focus on clarity, precision, and professional tone.",
};
const templateAddition = TEMPLATE_PROMPTS[project?.template ?? ""];
if (templateAddition) {
  systemPrompt += `\n\n# PROJECT TEMPLATE\n\n${templateAddition}`;
}
```

**2. `supabase/functions/context-prompt/index.ts`**

- Same `TEMPLATE_PROMPTS` map, inserted after base prompt selection (line 766) and before concise modifier (line 768), using `project.template` which is already fetched.

**3. `src/components/NewProjectDialog.tsx`**

- Add `proOnly` flag to non-general templates
- Compute `isProOrAbove` from existing `profile?.subscription_tier` (already available)
- Disable selection + show "Pro" badge for gated templates when user is free/starter
- Reduced opacity + tooltip explaining upgrade needed

```ts
const TEMPLATES = [
  { value: "general", label: "General", desc: "...", proOnly: false },
  { value: "academic", label: "Academic", desc: "...", proOnly: true },
  { value: "creative", label: "Creative", desc: "...", proOnly: true },
  { value: "professional", label: "Professional", desc: "...", proOnly: true },
];

const isProOrAbove = !["free", "starter"].includes(profile?.subscription_tier ?? "free");
```

Disabled template cards: `opacity-50 cursor-not-allowed`, radio input disabled, small "Pro" badge next to label.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | Fetch `template`; insert template prompt between base prompt and concise modifier |
| `supabase/functions/context-prompt/index.ts` | Insert same template prompt between base prompt and concise modifier |
| `src/components/NewProjectDialog.tsx` | Add `proOnly` flag; gate non-General templates to Pro+ with badge and disabled state |

