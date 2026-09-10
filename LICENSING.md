# Licensing map

Sylou is dual-licensed, as follows:

| Component | License | Full text |
|---|---|---|
| Application code (frontend, edge functions, migrations, tooling, docs not listed below) | AGPL-3.0-only | [LICENSE](LICENSE) |
| The FLOW methodology (the analytical framework, as further detailed below) | CC BY-SA 4.0 | [LICENSE-METHODOLOGY](LICENSE-METHODOLOGY) |
| The Sylou name and logo, and the FLOW Pledge Badge format | Trademark policy (not an open license) | [TRADEMARK-POLICY.md](TRADEMARK-POLICY.md) |

## Where the methodology lives in the repository

Methodology content is embedded in the following code files:

| Location | What's there | License situation |
|---|---|---|
| `supabase/functions/analysis/prompts.ts` | The FLOW analysis prompt text (embedded string constants) | The file is AGPL code; the embedded prompt text is CC BY-SA methodology |
| `supabase/functions/analysis/index.ts` | The attribution-doctrine passages embedded with the request (marked inline) | The file is AGPL code; the listed passages are CC BY-SA methodology |
| `supabase/functions/_shared/_prompts.ts` | `TUTOR_MODE_SYSTEM_PROMPT` (pillar-by-pillar teaching behavior) | The file is AGPL code; the tutor prompt text is CC BY-SA methodology |
| `src/lib/flow-work-profiles.ts` | The proposed 16 work-style taxonomy | The data is CC BY-SA methodology; the surrounding TypeScript is AGPL |
| `src/lib/flowBands.ts` | The six display bands (thresholds, labels, domain palette) | Same as above |

## Practical consequences

- **Reusing the methodology without the code** (running FLOW-style
  assessments in another tool, translating the rubric, teaching it, etc.):
  follow CC BY-SA 4.0. You do not inherit any AGPL obligation.
- **Reusing the code**: AGPL-3.0 applies, including its network-service
  terms.
- **Contributing**: your DCO sign-off (`git commit -s`) applies to both:
  code contributions land under AGPL-3.0, methodology contributions under
  CC BY-SA 4.0. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Naming**: neither license grants trademark rights: see the
  [trademark policy](TRADEMARK-POLICY.md).

## Third-party software

Sylou builds on open-source packages, all under AGPL-compatible licenses
(MIT, ISC, BSD, Apache-2.0 and similar). The complete inventory lives in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), generated from the
lockfile and kept in sync by CI.

Questions: [contact@sylou.eu](mailto:contact@sylou.eu).
