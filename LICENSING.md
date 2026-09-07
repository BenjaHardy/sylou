# Licensing map

Sylou is dual-licensed. This file states precisely what is covered by which
license, so contributors and downstream users don't have to guess.

| Component | License | Full text |
|---|---|---|
| Application code (frontend, edge functions, migrations, tooling, docs not listed below) | AGPL-3.0-only | [LICENSE](LICENSE) |
| The FLOW methodology (defined below) | CC BY-SA 4.0 | [LICENSE-METHODOLOGY](LICENSE-METHODOLOGY) |
| The Sylou name and logo, and the FLOW Pledge Badge format | Trademark policy (not an open license) | [TRADEMARK-POLICY.md](TRADEMARK-POLICY.md) |

## What "the FLOW methodology" covers

The methodology is the analytical framework itself, independent of any
particular implementation:

- The four pillar definitions (Find / Lead / Organize / Write), the 0.0–5.0
  scoring scale, its calibration anchors, and the null-evidence rule
- The six display bands and the sixteen work-style taxonomy
- The FLOW analysis prompt text (the instructions given to the scoring model),
  including the attribution-doctrine passages embedded in the request
  assembly (enumerated below)
- The tutor-mode teaching behavior (the pillar-by-pillar guidance in
  `TUTOR_MODE_SYSTEM_PROMPT`)
- The methodology descriptions in [TRANSPARENCY.md](TRANSPARENCY.md)
  (Sections 2–3)

## Where the methodology lives in this repository

There is no separate `methodology/` directory today; methodology content is
embedded in code files:

| Location | What's there | License situation |
|---|---|---|
| `supabase/functions/analysis/prompts.ts` | The FLOW analysis prompt text (embedded string constants) | The file is AGPL code; the embedded prompt text is CC BY-SA methodology |
| `supabase/functions/analysis/index.ts` | The attribution-doctrine passages embedded in the request assembly (enumerated below, marked inline) | The file is AGPL code; the listed passages are CC BY-SA methodology |
| `supabase/functions/_shared/_prompts.ts` | `TUTOR_MODE_SYSTEM_PROMPT` (pillar-by-pillar teaching behavior) — the single copy shared by the chat and context-prompt functions | The file is AGPL code; the tutor prompt text is CC BY-SA methodology |
| `src/lib/flow-work-profiles.ts` | The 16 work-style taxonomy (codes, names, descriptions, domain palette) | The data is CC BY-SA methodology; the surrounding TypeScript is AGPL |
| `src/lib/flowBands.ts` | The six display bands (thresholds, labels, domain palette) | Same as above |
| `TRANSPARENCY.md` §2–§3 | Prose definition of the pillars and the scale | CC BY-SA methodology |

The analysis prompt was extracted into `analysis/prompts.ts` as part of the
2026 edge-function refactor; the map above points at its current home.

### Attribution-doctrine passages in `analysis/index.ts`

Beyond the prompt templates, the FLOW analysis request embeds a small number
of instruction passages that tell the scoring model how to *attribute*
contributions. These are CC BY-SA methodology even though they live inline
in AGPL handler code; each is marked with a `CC BY-SA` comment at the
literal:

- the provenance-tag definitions ([t]/[cc]/[ce]/[ai]) in the
  "WRITING CONTENT" section introduction
- the writing-summary "[NOT ASSESSED]" attribution rule in the
  "CHAT HISTORY" section introduction (standard and creative variants)
- the imported-documents neutrality rule in the "IMPORTED DOCUMENTS"
  section introduction
- the creative-tools pillar-relevance rule in the "CREATIVE TOOLS CONTENT"
  section introduction
- the similarity notice ("WRITE PILLAR NOTICE") and the Write-score-cap
  disclosure note

Everything else the request assembles around user data — the language
instruction, section scaffolding, document-budget notices, the retry nudge,
and the formatter-rendered evidence blocks — is operational plumbing,
licensed AGPL like the rest of the code.

Deliberately **not** methodology (considered and excluded): the collaboration-style
painting selections and rationale texts in
`src/lib/flow-profile-paintings.ts` (editorial presentation about the
taxonomy, not the framework); `CLASSIC_MODE_SYSTEM_PROMPT` and the
concise-mode modifier (generic assistant instructions); and the
"AI EDITOR ACTIVITY" section explanation (a description of what the
platform logged, not attribution doctrine).

## Practical consequences

- **Reusing the methodology without the code** (running FLOW-style
  assessments in another tool, translating the rubric, teaching it):
  follow CC BY-SA 4.0 — attribution and share-alike. You do not inherit
  any AGPL obligation.
- **Reusing the code**: AGPL-3.0 applies, including its network-service
  terms.
- **Contributing**: your DCO sign-off (`git commit -s`) applies to both —
  code contributions land under AGPL-3.0, methodology contributions under
  CC BY-SA 4.0. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Naming**: neither license grants trademark rights — see the
  [trademark policy](TRADEMARK-POLICY.md).

## Third-party software

Sylou builds on open-source packages, all under AGPL-compatible licenses
(MIT, ISC, BSD, Apache-2.0 and similar). The complete inventory — every
package, exact pinned version, and license, for both the application and
the edge functions — lives in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), generated from the
lockfile and kept in sync by CI.

Questions: [contact@sylou.eu](mailto:contact@sylou.eu).
