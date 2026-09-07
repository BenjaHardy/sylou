<!-- Logo / hero badge -->
<p align="center">
  <img src="docs/assets/sylou-logo.png" alt="Sylou" width="200" />
</p>

# Sylou

**Process-based AI-use transparency - an open-source writing environment that makes human-AI collaboration visible.**

Sylou is a text editor that helps you write with AI assistance and analyses your collaboration with AI using a standardized framework that looks into the processes of writing: where ideas came from, what got structured by whom, how the prose itself was shaped, etc.
As it's becoming ever more difficult to understand *how* AI was used to produce a writing, with standard detection tools being occasionally unreliable and missing the full picture, Sylou aims to flip the problem: helping users gather evidence and proactively demonstrate how they have used AI, using a standardized framework that looks into the processes of writing, producing visual and shareable reports along the way.

Sylou's whole point is to make human-AI collaboration visible for users willing to show this transparency. It's designed for writers, students, educators, researchers, and anyone who cares about AI-use transparency and is looking to proactively demonstrate how they have used AI, in a clear, visual and insightful way.

Additionally, it can further be used in an educational context as a means to promote one's own AI-use awareness, and help serve as a framework for AI-use.

---

## The FLOW methodology

Sylou analyses human-AI collaboration across four dimensions thanks to a structured analysis framework — FLOW — that maps how AI assistance and human work fit together across the full lifecycle of the writing process.

Each dimension is assessed independently, producing a dedicated and sharable FLOW report, as well as a FLOW profile that describes a collaboration style for your work: one of sixteen possible types, inspired by personality-type frameworks.

FLOW describes the writing process, with no pass or fail, only a structured analysis of who contributed to what and how. And it exists alongside your own self-evaluation, if provided.

The four FLOW pillars are:
F — Find: research and critical thinking (research it)
L — Lead: ideas and opinion (form ideas about it)
O — Organize: structure and argumentation (structure it)
W — Write: writing and authorship (write it)
   
The transparency architecture, covering all the means, whats, whys, hows to achieve this goal, is detailed in a separate and dedicated document - in case you're interested or plan to contribute: [TRANSPARENCY.md](TRANSPARENCY.md).

---

## What's in the box

- **Writing editor** with AI assistance that is context-aware of the work (Ask, Propose, Expand, Simplify, Rephrase, Translate, Fix grammar) and with per-paragraph provenance tracking.
- **AI chat assistant** that has awareness of the work being written, and with multiple threads per project, document upload capabilities, and integrated web search.
- **Creative writing tools** aimed for fiction writers: world-building tool, character diagram and timeline.
- **Other convenience functionalities** such as virtual post-its and chat messages bookmarks.
- **FLOW analysis** that produces a structured report analysing the four pillars of the FLOW methodology.
- **FLOW profile** based on the FLOW analysis describing the collaboration style for the work - akin to personality-type frameworks.
- **Self-assessment options** for users to record their own feedback (both before and after the FLOW analysis is provided) on the collaboration alongside the FLOW analysis.
- **Work replay functionality and quantitative data** for futher evidence of the involvement of the user to the work.
- **Shareable FLOW reports** comprising the above elements, with a public URL, a QR-coded badge, and machine-readable AI-origin markers. 
- **Tutor mode** that restricts the AI to guidance rather than direct generation (for educational contexts).
- **Selectable LLM** for both the chat and the FLOW analysis separately, between Mistral, Deepseek and Claude - with adaptive thinking and effort level customizable.

Sylou is built on React + TypeScript on the frontend, Supabase (PostgreSQL + Edge Functions) on the backend, and uses LLMs from Anthropic or Mistral via API.

---

## Try it

There's no public hosted instance. The `sylou.eu` instance is maintainer-only, sign-ups are disabled. To use Sylou, **deploy your own instance**.
It is open-source software designed for self-managed deployment on Supabase plus a static hosting provider for the frontend (Vercel, Cloudflare, or similar), using your own accounts. You bring the cloud accounts, the LLM API keys, and the domain; Sylou provides the application code.

Setup is documented in [**docs/setup.md**](docs/setup.md). At a high level, you'll need:

- A Supabase project (free tier works for personal use)
- API keys for at least one LLM provider (currently works with Anthropic or Mistral - with DeepSeek currently in beta). For the FLOW analysis, both Claude Sonnet 4.6 (Anthropic API) and Z.ai GLM 5.2 (hosted on the Mistral API) are recommended options, without ranking one against the other: pick according to the provider you prefer to work with, or try both
- A few environment variables
- About 15–30 minutes for first-time setup

The same self-hosted instance can be used by a single person, a small team, an academic department, or a Community; whatever fits.
Self-hosters can set per-user token budgets via SQL; see docs/setup.md for details.

---

## How it works (briefly)

When a project is analysed, the FLOW prompt examines the editor content, the creative writing tools, the chat history, the AI interactions, the provenance tags metadata and the imported documents to evaluate each of the four pillars and assign a profile.

The provenance tags are as follows:

- `[t]` — typed by the user
- `[cc]` — copied from chat
- `[ce]` — copied from elsewhere
- `[ai]` — inserted via AI tools (Propose, Expand, Simplify, etc.)
 
The whole architecture is designed with transparency in mind, so that relevant interactions are logged for the analysis, and to avoid any idea misallocation from the user to the AI. 

The result is rendered as a FLOW report, which can be kept private or shared via a public URL.

A more thorough explanation of the transparency mechanisms is in [**TRANSPARENCY.md**](TRANSPARENCY.md).
The recommended LLM and settings to use for the FLOW analysis can be found in [**docs/model-configuration.md**](docs/model-configuration.md).

---

## Open source

Sylou is open-source software released under [**AGPL-3.0**](LICENSE). The FLOW methodology is published separately under [**CC BY-SA 4.0**](LICENSE-METHODOLOGY). Anyone can inspect the code, modify it, self-host it, or adapt the methodology under the terms of those licenses.

Why two licenses: the code and the methodology are two distinct contributions. AGPL keeps the software open even when run as a network service; CC BY-SA lets the analytical framework spread freely as long as derivatives share back.
A precise mapping of which files fall under which license is in [**LICENSING.md**](LICENSING.md).

The Sylou name and logo, and the FLOW Pledge Badge format, are governed by a separate [**Trademark Policy**](TRADEMARK-POLICY.md). In short: forking and modifying are welcomed (that's open source); using the Sylou name on a substantively modified or competing version isn't.

Most contribution scenarios are entirely unaffected by the trademark Policy: PRs, branches, distribution packages, self-hosted deployments, and educational use are all fine without any trademark conversation, and the bias of the trademark Policy is toward permission. The policy only comes into play only for cases that could mislead users about what they're using.

---

## Contributing

Contributions are welcome — code, documentation, translations, FLOW methodology observations, bug reports, ideas, conversation. Please see [**CONTRIBUTING.md**](CONTRIBUTING.md) if you want to get involved.

Sylou uses the **Developer Certificate of Origin** for code contributions (`git commit -s`), and a handful of issue templates make it easy to file structured bug reports, feature requests, or FLOW methodology observations.

A note on pace: Sylou is currently maintained by one person on limited time. Reviews and responses may take longer than on a commercial or larger project. Your patience is appreciated.

---

## Transparency and the AI Act

Sylou is built around being transparent about AI use, and that posture extends to how the project itself engages with regulatory expectations. The project's documented analysis on the EU AI Act's transparency requirements (Articles 50(1) and 50(2)) is in [**docs/ai-act-position.md**](docs/ai-act-position.md). It's the project's documented position, not legal advice, and self-hosters operating Sylou for other users have their own obligations to consider.

Security issues should be reported privately — see [**SECURITY.md**](SECURITY.md).

---

## Status

Sylou is in active development. Features may change, bugs exist, and you should keep your own backups of important work.
It's been extensively tested with small to medium-sized works, and is being tested with large-scale works (e.g. novels).

It's provided as-is, without warranty of any kind. That said, it's used daily by the maintainer and is intended to be useful.

---

## Roadmap

Below are the key functionalities that the maintainer would like to implement post-launch:

- **FLOW analysis input token optimization** without impacting negatively the outputs and keeping the same transparency. 

- **Dedicated functionalities for very large pieces of work** (novels, doctoral dissertations, etc.): such as multiple FLOW methodology layers combining into a global analysis (being investigated). 

Sylou has been extensively tested by the maintainer with small to medium-sized works, and is being tested with large-scale works. We plan to transparently share quantitative data of the behavior of the different LLMs and underlying setup (thinking, effort level, etc.) when running FLOW analyses on such large works. 

Building the appropriate test cases naturally takes time; if you're interested to contribute, don't hesitate to reach out. Feedback derived from such tests will help guide the development of the functionalities. See also [**CONTRIBUTING.md**](CONTRIBUTING.md).

Besides the above, we're of course open to suggestions and feedback. 
If not done already, feel also free to take a look at our Tally questionnaire, which includes a dedicated question for feedback on possible future functionalities.

---

## Learn more

- **Project landing page**: [meetsylou.eu](https://www.meetsylou.eu)
- **About Sylou and FLOW**: linked from the landing page, plus the documentation in this repo
- **Feedback or questions**: [contact@sylou.eu](mailto:contact@sylou.eu), or open an issue

---

<p align="center">
  <em>Sylou™ — © Benjamin Hardy.
  Open-source software under AGPL-3.0.
  The FLOW methodology is published under CC BY-SA 4.0.</em>
</p>
