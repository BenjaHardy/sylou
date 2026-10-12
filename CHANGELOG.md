# Changelog

Notable changes to Sylou, newest first. Versions follow
[Semantic Versioning](https://semver.org/) and every release is tagged on
GitHub. Each version ends with an **Upgrading** note for self-hosters: what to
apply beyond pulling the code (the full procedure is in
[docs/setup.md](docs/setup.md), "Operating your instance").

## [0.7.0] - 2026-10-12

### Models and reasoning
- New models: Claude Sonnet 5.5, Claude Opus 5.5 and Claude Fable 5.1
  (Anthropic), and Z.ai GLM 5.3 served by the Mistral API in the EU. GLM 5.3
  is the default chat and FLOW model for new profiles.
- Settings offers a reasoning level per chat model, from off to "Max (slow)"
  as each model allows. It applies to chat and to Ask / Propose; a
  "Thinking…" indicator shows while a reasoning model thinks.
- The model pickers are grouped: by provider for chat, and by tier for FLOW
  (recommended, alternatives, not currently recommended), with the rationale
  per model in [docs/model-configuration.md](docs/model-configuration.md).
- Higher output ceilings for every AI function, with headroom for reasoning.
  A large selection warns before a cut-off reply can be accepted.
- Prompt caching on chat with Anthropic and Mistral models, always on, and
  provider-reported usage (including cached tokens) in the function logs.
- Provider errors, timeouts and safety refusals now show the function's own
  message, in the chat bubble and in the selection window, and survive a
  thread switch.

### FLOW analysis
- FLOW prompt calibration v1.2 to v1.5: firmer pillar separation and explicit
  framing against user-leaning scores, verified across models.
- "Collaboration profile" is now "FLOW Collaboration Style".
- Older editor actions are compacted in the FLOW input beyond the newest 20,
  so large projects stay within the model's context.
- Ask / Propose can run several web-search rounds when a question needs it.

### Writing and chat
- The editor runs on TipTap v3, behaviour-preserving: same shortcuts, same
  saved HTML, and a security advisory cleared.
- Streaming replies render smoothly, the chat follows the stream and holds
  still while you scroll up.
- The AI selection window stays on screen near the bottom of the page, and
  the creative tools' description editors scroll at a fixed height.
- A loading guard prevents a project's provenance map from being overwritten
  when you leave the project before its text has loaded.
- "Default to concise responses" takes effect immediately.
- Invitation acceptance and password reset flows, a refreshed sign-in notice
  and site footer.

### Transparency, security and privacy
- Report evidence is not writable through the API: FLOW reports are written
  only by the analysis function, writing versions cannot be deleted, and chat
  threads cannot be deleted directly (deleting a project still removes
  everything in it).
- Explicit Data API grants mirror row-level security on every table, checked
  by a CI lint that replays the migrations; the public report view carries no
  user-role privileges.
- Users' text stays out of the function logs unless an operator opts in with
  `SYLOU_DEBUG_LOG_CONTENT=true`.

### Self-hosting and tooling
- Tailwind CSS 4, ESLint 10, Vitest 4.1, jsdom 29; no open dependency
  advisories.
- Node 22.13 or later is required to build the frontend.

### Docs and legal
- Sylou is a registered EU trade mark (EUTM 019364202); the trademark policy,
  licensing, security, transparency, setup and model-configuration documents
  are refreshed, and the README describes how Sylou was built.

### Upgrading from 0.6.0
1. Node 22.13 or later, then `npm ci`.
2. `npx supabase db push` applies nine migrations: the evidence and grant
   lockdowns, the chat reasoning preference, and the new model defaults.
3. `npx supabase functions deploy` for all functions.
4. Set `SYLOU_VERSION=v0.7.0` and `SYLOU_COMMIT_HASH` in the function
   secrets.
5. New profiles default to GLM 5.3 on the Mistral API, so set a Mistral API
   key; an Anthropic key is no longer required for the default FLOW model.
   Existing users keep their saved model choices.

## [0.6.0] - 2026-08-19

### Highlights
- Conversation memory: each chat thread keeps a rolling summary beyond its
  verbatim window, with a watermark divider, a memory dialog and a refresh
  pill.
- Shared FLOW reports show the provenance-annotated writing, are served with
  `noindex` and `no-referrer` headers, and are read through a token-gated
  RPC that closes report enumeration.
- In-app account deletion, including the uploaded documents.
- Prompt-injection safeguards in the FLOW analysis; repaired or defaulted
  report sections are disclosed in the report's metadata.
- FLOW reports pair the provenance highlights with the frozen writing
  snapshot, and count Ask / Propose exchanges in the project statistics.
- Mistral Medium 3.5 is no longer recommended for FLOW after field testing.

### Reliability
- Saves are verified before a project switch, and a failed or hung save is
  surfaced instead of silently lost.
- Each project gets its own editor and undo history.
- Provenance mapping fixed for multi-step insertions and pasted slices.
- Tool calling fixed for Mistral and DeepSeek, Mistral reasoning output
  parsed, request timeouts and safer truncation across the edge functions.
- Failed analysis attempts are billed and failed persistence writes are
  reported rather than hidden.

### Security
- Token accounting goes through one atomic database function; the budget
  columns cannot be edited by users.
- The tables FLOW reads as evidence are read-only through the API; all writes
  go through the edge functions.
- Missing foreign keys added; cross-project thread access fails closed.

### Self-hosting and tooling
- Faster loads: route and panel code-splitting, FLOW profile paintings
  compressed to WebP.
- The edge functions are split into shared modules and per-function units
  with tests; `THIRD_PARTY_LICENSES.md` is generated from the lockfile and
  checked in CI.
- 22 unused dependencies and 28 dead files removed, exact versions pinned,
  React Router 7, all advisories cleared.
- Docs: operator data-access disclosure and a pre-registration checklist in
  the setup guide; the CC BY-SA methodology boundary marked in the files
  themselves.

### Upgrading from 0.5.0
1. `npm ci` (the dependency set changed).
2. `npx supabase db push` applies eight migrations, including the shared
   report RPC, the budget freeze, the read-only evidence tables and the chat
   thread summaries.
3. `npx supabase functions deploy` for all functions.

## [0.5.0] - 2026-07-03

First public release: the writing editor with character-level provenance
(typed versus AI-inserted), the AI assistant with Ask / Propose on a selection
and web search, the FLOW analysis scoring four pillars and assigning one of
16 collaboration styles, shareable FLOW reports, and the Supabase + Vercel
self-hosting path. Code under AGPL-3.0, the FLOW methodology under
CC BY-SA 4.0.

[0.7.0]: https://github.com/BenjaHardy/sylou/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/BenjaHardy/sylou/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/BenjaHardy/sylou/releases/tag/v0.5.0
