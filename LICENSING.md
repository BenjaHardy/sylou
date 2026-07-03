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
- The six display bands and the sixteen work-profile taxonomy
- The FLOW analysis prompt text (the instructions given to the scoring model)
- The methodology descriptions in [TRANSPARENCY.md](TRANSPARENCY.md)
  (Sections 2–3)

## Where the methodology lives in this repository

There is no separate `methodology/` directory today; methodology content is
embedded in code files:

| Location | What's there | License situation |
|---|---|---|
| `supabase/functions/analysis/index.ts` | The FLOW analysis prompt text (embedded string constants) | The file is AGPL code; the embedded prompt text is CC BY-SA methodology |
| `src/lib/flow-work-profiles.ts` | The 16 work-profile taxonomy (codes, names, descriptions, domain palette) | The data is CC BY-SA methodology; the surrounding TypeScript is AGPL |
| `src/lib/flowBands.ts` | The six display bands (thresholds, labels, domain palette) | Same as above |
| `TRANSPARENCY.md` §2–§3 | Prose definition of the pillars and the scale | CC BY-SA methodology |

If the analysis prompt is later extracted into standalone files (planned as
part of an edge-function refactor), this map will be updated to point there.

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

Questions: [contact@sylou.eu](mailto:contact@sylou.eu).
