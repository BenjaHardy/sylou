# Contributing to Sylou

Thank you for your interest in contributing to Sylou.

Sylou is open-source software ([AGPL-3.0](LICENSE)) built around the open FLOW methodology ([CC BY-SA 4.0](LICENSE-METHODOLOGY)). The project welcomes contributions of all kinds — bug fixes, features, documentation, translations, accessibility improvements, design feedback, methodology discussion, ideas, and conversation.

This document explains how to contribute and what to expect.

## A note on pace and continuity

Sylou is currently maintained by one person on limited time. Reviews and responses may take longer than they would on a commercial or larger project: sometimes a week, occasionally more. Your patience is appreciated, and your contributions are read carefully. If a PR or issue seems to have gone quiet for more than two weeks, a friendly ping is welcome.

A related note on long-term continuity: if at some point the current maintainer is unable to continue, the goal would be to find a way for the project to continue, whether through a trusted co-maintainer, a transfer to an interested organization, or another community-friendly arrangement. The trademark and other project assets would be handled accordingly. This isn't an immediate concern, and continuity is a value associated with this project, but it seemed appropriate to be transparent about it for contributors deciding to invest time in Sylou.

## Ways to contribute

There's no hierarchy here — all of these are useful:

- **Report bugs** by opening an issue. When you click "New Issue" on GitHub, pick the **Bug report** Template. It walks you through steps to reproduce, expected vs. actual behavior, and the environment details that make a bug easier to diagnose.
- **Suggest features** by opening an issue and choosing the **Feature request** template. The use case matters more than the implementation idea, and so the template is structured to help you describe the problem first.
- **Submit code** via pull request. Small PRs are easier to review and land than large ones; if you're planning something substantial, opening an issue first to discuss the approach saves everyone time. When you open a PR, a template will pre-fill with a short checklist (including the DCO sign-off and the transparency-impact note described below).
- **Improve documentation**: README clarifications, setup guide fixes, typo corrections, better examples. These are among the most valuable contributions and the easiest to review.
- **Discuss the FLOW methodology**: the prompts, scoring rubric, pillar definitions, and Work Style taxonomy are open to debate and refinement. Methodology observations have their own structured template (see the "Methodology contributions" section below).
- **Share your experience**: write about how you use Sylou, what works, what doesn't, what you wish were different. Blog posts, academic write-ups, social media, all are welcome.

## Developer Certificate of Origin (DCO)

Sylou uses the **Developer Certificate of Origin** (DCO) for code contributions. This is a lightweight contributor agreement used by the Linux kernel, GitLab, Docker, and many other major open-source projects.

The DCO is *not* a copyright assignment and *not* a Contributor License Agreement. You retain copyright over your contributions, and your code is licensed under the same license as the rest of the project (AGPL-3.0 for code; CC BY-SA 4.0 for methodology files).

What you're attesting to when you sign off on a commit is that you have the right to submit the work; that you wrote it yourself, or you have permission from the rightsholder, or you took it from somewhere with a compatible license. The full DCO text is below.

### How to sign off

Add a `Signed-off-by` line to each commit message:

```
Signed-off-by: Jane Doe <jane@example.com>
```

The easiest way is to use the `-s` flag when committing:

```bash
git commit -s -m "Fix typo in README"
```

Git will automatically append the sign-off line using the name and email from your `git config`. If you haven't set these yet:

```bash
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

If you forget to sign off on a commit, you can amend the most recent one:

```bash
git commit --amend -s --no-edit
```

For older commits in a branch:

```bash
git rebase --signoff main
```

### The DCO text

By signing off on a commit, you certify the following (Developer Certificate of Origin v1.1):

> By making a contribution to this project, I certify that:
>
> (a) The contribution was created in whole or in part by me and I have the right to submit it under the open source license indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best of my knowledge, is covered under an appropriate open source license and I have the right under that license to submit that work with modifications, whether created in whole or in part by me, under the same open source license (unless I am permitted to submit under a different license), as indicated in the file; or
>
> (c) The contribution was provided directly to me by some other person who certified (a), (b) or (c) and I have not modified it.
>
> (d) I understand and agree that this project and the contribution are public and that a record of the contribution (including all personal information I submit with it, including my sign-off) is maintained indefinitely and may be redistributed consistent with this project or the open source license(s) involved.

The full canonical text is at [developercertificate.org](https://developercertificate.org).

## Code contributions in practice

### Before you start

For small changes (typo fixes, obvious bug fixes, minor documentation improvements): just open a PR, no need to ask first.

For anything larger (new features, significant refactoring, changes to the FLOW methodology), open an issue first to discuss the approach. The idea is to be pragmatic, and to make sure your time is well spent before you write code, noting the specific requirements embedded with Sylou (see the paragraph below). A 30-minute discussion can save a significant amount of time going in the wrong direction.

**A specific principle worth keeping in mind: transparency matters more than token-usage optimization.** Improvements that reduce token usage in FLOW prompts, context prompts, or system prompts are welcome, but only if they do *not* impact the transparency Sylou is designed to deliver. The whole point of Sylou is to make human-AI collaboration visible for users willing to show transparency; an optimization that saves tokens at the cost of weakening that visibility is not an improvement, even if it's technically more efficient.
The transparency architecture, covering all the means, whats, whys, hows to achieve this goal, is detailed in a separate and dedicated document: TRANSPARENCY.md.

For any submission, please confirm in your PR description whether the change affects the AI-use transparency and provenance-capture architecture underpinning Sylou, and if yes, how it was handled. This saves time for everyone in review.

Lastly, if your contribution touches anything related to AI disclosure (the chat reminder, the AI message labelling, the disclaimer), or to AI-generated content marking (the data-ai-generated attributes, the FLOW report meta tags), please also check ai-act-position.md, which describes what Sylou commits to on those surfaces and why. Modifications that impact those measures need a corresponding update to the document and an explanation in the PR.

### Development setup

Sylou has no mock backend: to run it locally you need your own (free-tier)
Supabase project. The full walkthrough is [docs/setup.md](docs/setup.md) —
it's written for production self-hosting, and local development is the same
setup minus the frontend host. In brief:

1. Create a Supabase project, apply the migrations, set the secrets, and
   deploy the edge functions per [docs/setup.md](docs/setup.md).
2. Copy `.env.example` to `.env` and fill in your project's
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Run `npm ci && npm run dev`, and add the local origin Vite prints on
   startup to your `ALLOWED_ORIGIN` secret so edge-function calls pass CORS.

Before opening a PR, run the same gates CI runs:

- `npm run typecheck` — frontend TypeScript. (Note: bare `tsc --noEmit`
  checks zero files in this repo — always use the npm script.)
- `npm run lint`
- `npm test` — vitest unit tests
- `cd supabase/functions && deno task check` — edge-function typecheck.
  Backend unit tests live next to the code (e.g. `_shared/_llm.test.ts`)
  and run with `deno test`.

If the setup instructions don't work for you, that's itself a bug worth reporting.

### Code style and structure

- The distilled engineering rules — security, correctness, streaming
  lifecycle, transparency invariants, and a per-PR checklist — live in
  [docs/engineering-standards.md](docs/engineering-standards.md). Worth a
  read before substantial changes, and if you code with an AI assistant,
  give it that file as context.
- TypeScript throughout. New code should be properly typed; existing untyped patches are fair game for improvement.
- File-level conventions: see existing files in the same directory for the pattern. The codebase prefers small, focused files over large ones.
- Edge functions share common code via `supabase/functions/_shared/` (the provider router, temperature/thinking tables, etc.). Don't copy helpers between function folders — some legacy duplication remains, and consolidating it into `_shared/` is a tracked refactor.
- UI strings are English-only today (there is no i18n framework). If you'd like to work on internationalization, open an issue first — it's a significant architectural choice.
- Commits should be focused — one logical change per commit where reasonable. Don't worry about getting this perfect; reviewers can ask for a rebase if needed.

### Pull request process

When you open a pull request, a template pre-fills the description with a short structure and checklist: what the change does, how to test it, whether it affects transparency/provenance behavior, and a reminder to sign off your commits. Filling it in makes review faster; you can delete sections that don't apply.

1. Fork the repository and create a branch from `main`.
2. Make your changes. Sign off on each commit with `git commit -s`.
3. Open a PR with a clear description: what changed, why, and how to test it. Note whether the change affects transparency/provenance behavior (see the principle above).
4. Address review feedback. 
5. Once approved, the PR is merged. The default merge method is **squash and merge** (see below); that's done by the maintainer at merge time, not by you.

### How merges work

When your PR is approved, the maintainer clicks "Squash and merge" in GitHub. This combines all the commits from your PR into a single commit on the main branch, with your PR's title as the commit message and your name preserved as the author. You don't need to do anything special; push your commits normally on your branch and the squashing happens automatically at merge.

Why squash-merge? It keeps the main-branch history clean: one commit per PR, easy to read, easy to revert if needed, easy to bisect when hunting regressions. The downside is that the individual commits on your PR branch don't appear on main; however the PR itself remains as the historical record of the change.

If your PR has a misleading or unclear title, expect the maintainer to edit it before merging, since the title becomes the permanent commit message. Or save the effort by giving the PR a clear title before requesting review.

### What gets accepted

Most well-scoped contributions that fit the project's direction get accepted. Things that improve the project's chances of being accepted:

- Clear description of the problem being solved
- Tests for new functionality (or at least a manual test plan)
- Documentation updates if user-facing behavior changes
- Following existing patterns rather than introducing new ones unnecessarily
- Reasonable scope - easier to review three focused PRs than one sprawling one
- Explicit note on whether transparency/provenance behavior is affected

Things that might lead to a "not this way" response:

- Changes to the FLOW methodology without discussion first (the prompts, scoring, and pillar definitions are central to the project and need careful review)
- Adding telemetry, tracking, or anything that undermines the privacy commitments
- Optimizations that reduce token usage at the cost of weakening transparency
- Adding dependencies for trivial functionality (the project prefers a smaller dependency footprint)
- Significant changes to architecture without prior discussion

A "not this way" isn't a rejection of the contributor, but instead a conversation about how to get to a place where the change can land.

## Methodology contributions

The FLOW methodology - the prompts, scoring rubric, pillar definitions, Work Style taxonomy - is licensed under CC BY-SA 4.0, separately from the code. Contributions here are especially welcome but go through a slightly different process.

### Methodology observations and feedback

To make methodology feedback structured, useful, and easy to triage, please use the methodology observation template. The simplest path is to open a GitHub issue using the **"FLOW Methodology Observation"** issue template (you'll see it in the issue type selector when opening a new issue), which pre-fills the structure below.

If you're submitting feedback through another channel, here's the structure to follow:

| Field | What goes here |
|---|---|
| **Date** | Date of observation |
| **Framework** | "FLOW" (default; reserved for future framework expansions) |
| **LLM** | Which model generated the assessment (e.g., "Claude Sonnet 4.6", "Mistral Large 2") |
| **Temperature** | The LLM temperature used when the assessment was made ("Unmodified", or a number)
| **Project type** | Essay, blog post, research paper, technical writing, fiction, etc. |
| **FLOW estimated prompt tokens** | As disclosed at the bottom of the FLOW Report |
| **FLOW pillar(s) affected** | Find / Lead / Organize / Write (one or more) |
| **Severity** | One-off oddity / systematic pattern / structural issue |
| **Expected outcome** | What FLOW *should* have produced, in your view |
| **Actual outcome** | What FLOW *did* produce |
| **Possible cause** | Your hypothesis, if any (optional) |
| **Suggested solution** | Your proposed fix, if any (optional) |
| **Initials** | Your initials, for attribution |
| **Contact** | Email or GitHub handle for follow-up |
| **Status** | *Leave blank: filled in by the maintainer (Open / Under review / Implemented / Won't fix / Needs more info)* |

A worked example:

| Field | Example |
|---|---|
| Date | 2026-05-15 |
| Framework | FLOW |
| LLM | Claude Sonnet 4.6 |
| Temperature | Unmodified |
| Project type | Academic essay (humanities) |
| FLOW estimated prompt tokens | 57218 |
| FLOW pillar(s) affected | Lead, Organize |
| Severity | Systematic pattern (observed across ~5 essays) |
| Expected outcome | Lead assessment of "Human-led, AI-assisted" (3.0-3.5) when the user has clearly developed their own argument with AI used only for stress-testing |
| Actual outcome | Lead assessment consistently at "Collaborative" (2.0-2.5), treating AI-prompted refinement as if it were AI-originated argument |
| Possible cause | The Lead pillar's evidence weighting may overcount instances of "user asked AI for input on their argument," even when the input was substantively rejected or modified |
| Suggested solution | Differentiate between "AI generated argument adopted by user" and "AI input considered then rejected/modified by user" in the evidence assessment |
| Initials | JD |
| Contact | jane@example.com |
| Status | *(leave blank)* |

### Methodology changes in code

If you're submitting methodology changes via PR (not just observations), additional notes:

- Open an issue tagged `methodology` to start the discussion before writing the PR
- Methodology changes often benefit from concrete examples (test cases where the current methodology produces the wrong answer, and your proposed change produces a better one)
- Changes to the public-facing aspects of the methodology (the four pillars, the scoring scale, the Work Style logic) are conservative; these are part of how users understand the framework, so stability matters
- Changes to the internal aspects (prompt wording, evidence requirements, calibration anchors) are more flexible and benefit from iteration

The CC BY-SA license means any methodology changes you contribute will be released under the same license. Your DCO sign-off on the commits applies the same way as for code.

### Note on the size of the works being tested

Sylou has been extensively tested by the maintainer with small to medium-sized works, and is being tested with large-scale works. 
Whatever the size of the your work, structured feedback is always welcome. That is particularly true for very large pieces of work (e.g. novels, doctoral dissertations, etc.) where test cases naturally take a long time to produce. 
Feedback derived from such tests will help guide the development of future dedicated functionalities.

### Note on LLM calibration

Based on our tests (Claude/Mistral/DeepSeek, and Z.ai GLM 5.2 via the Mistral API since August 2026), two models deliver accurate FLOW analysis outputs: Claude Sonnet 4.6 and Z.ai GLM 5.2. Both showed strong repeatability (i.e. consistent outcomes from one run to another), less bias toward the user, did not mix up different pillars, and were consistently in line with the tester's own critical self-evaluation. The other LLMs tend to overscore the user's involvement, or show less repeatability.
The two recommended models are not ranked against each other: the choice depends on the provider you prefer to work with (Anthropic API, Mistral API, or both). Claude Sonnet (4.6 as of the date of this memo) occasionally encounters issues with JSON parsing; if that is the case, it is recommended to first switch to Claude Opus (4.8 as of the date of this memo).
Where this is possible, temperature for the FLOW analysis is set at 0.0, which does appear to make the grounding slightly better for some models; temperature is set in a dedicated file: supabase/functions/_shared/_temperatures.ts
Whatever the feedback, it is important to be careful not to propose calibration changes to the FLOW prompt that may improve the outputs of one LLM at the detriment of the others.

### Surveys and structured studies

The observation template captures specific moments of LLM behavior. 
The following ways to contribute could also be of interest - subject to sufficient community interest.

- **Surveys**: occasional short questionnaires asking about your experience with specific models. These would be published in GitHub Discussions in case of sufficient interest.
- **Structured studies** (hypothetical, also contingent on interest): more rigorous empirical work could be valuable; for example, multiple contributors analyzing projects under controlled conditions to compare qualitative accuracy across models. No such study has been conducted to date, and we have no immediate plans to organize one. 
However, if community interest emerges and contributors want to participate, propose or run a study, we're open to it. Methodology contributions from completed studies would be incorporated under the CC BY-SA license with attribution.

Both are voluntary. If you're interested in either, open a GitHub Discussion.

## A note on AI-assisted contributions

Sylou is a tool for transparent human-AI collaboration, and it itself relied on AI coding tools during development, so we're ok with AI assistance in contributions to it, subject to some conditions. Use whatever tools help you do good work: AI-assisted code, AI-assisted writing, AI-assisted methodology drafts are all fine. The DCO sign-off attests that you have the right to submit the contribution, which is what matters legally.

In the spirit of the project, we'd love if you share how you worked. Though what matters practically is that you understand what you're submitting and the implications to the Sylou project, can answer questions about it, and will respond to review feedback. AI-generated PRs where the author can't engage substantively with the review tend not to land. AI-assisted PRs from contributors who genuinely understand their work are welcome.

## Trademarks

The Sylou name and logo are trademarks and are governed by a separate TRADEMARK-POLICY.md, not by the AGPL or this contributing guide. In short: forking and modifying are welcomed (that's open source); using the Sylou name on a substantively modified or competing version isn't.

Most contribution scenarios are entirely unaffected by the trademark Policy: PRs, branches, distribution packages, self-hosted deployments, and educational use are all fine without any trademark conversation, and the bias of the trademark Policy is toward permission. The policy only comes into play only for cases that could mislead users about what they're using.

## Code of conduct

The project doesn't have a separate code of conduct document, because the expectations are simple:

- Treat others with respect. Critique ideas, not people.
- Assume good faith. Most misunderstandings are misunderstandings, not bad intent.
- Disagreements are fine and often productive. Personal attacks aren't.
- The maintainer reserves the right to remove comments, lock issues, or block contributors whose conduct undermines the project's collaborative atmosphere. This is rarely necessary and never the goal.

If you experience or witness behavior that concerns you, reach out at contact@sylou.eu (or whatever channel ends up being appropriate).

## Questions

If anything in this document is unclear, or if you're considering a contribution and want to talk it through first, open an issue or email contact@sylou.eu. Genuine questions are always welcome.

When you open a new issue on GitHub, you'll also see links for things that don't belong in the issue tracker (security reports, trademark inquiries, and general questions), each routed to the right place. Use those rather than opening a public issue for those topics (security vulnerabilities in particular should always be reported privately; see SECURITY.md).

Thank you for considering contributing to Sylou.
