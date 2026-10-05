# Sylou — project context & conventions

Context and conventions for Sylou, for human contributors and AI coding
agents (Claude Code auto-loads this file by name). Committed to the repo.

Convention for this file: rules describing **current** behavior are stated
as present-tense fact; forward-looking rules that are **not yet built** are
marked `(not yet implemented)` so they're not mistaken for current state.

## 1. What this is
Sylou is a writing + reflection app built around the FLOW methodology
(Find / Lead / Organize / Write). Users draft in a TipTap editor, chat
with an AI assistant, and run FLOW analyses that score their process
across four pillars (0.0–5.0) and assign one of 16 work-style codes.
See `README.md` and `docs/` for product depth.

## 1b. Open source
Sylou is open-source and dual-licensed: code under AGPL-3.0, FLOW methodology under
CC BY-SA 4.0. See LICENSE files for details.
The repo is intended to be public; contributions go through PRs.
Don't introduce proprietary dependencies or closed-source patterns.
Apply strict coding standards to avoid future code liabilities for the open-source project.

## 2. Stack
- React 18, Vite 8 (Rolldown), TypeScript 5, Tailwind v3, shadcn/ui
- React Router, TipTap v3 (custom font-size + pagination extensions).
  The v2→v3 migration (2026-09) was behavior-preserving: every editor takes
  its StarterKit from `src/lib/editor-extensions/sylou-starter.ts`, which
  opts out of v3's new editing behaviors (bundled Link/Underline/ListKeymap/
  TrailingNode, Blockquote Backspace, ListItem branching-Delete, OrderedList
  plain-text paste-to-list, CodeBlock exitOnArrowUp; WritingEditor also keeps
  TextStyle's `mergeNestedSpanStyles: false`). Adopting any of them is a UX
  decision to take deliberately — pinned by `v2-keymap-parity.test.ts`,
  serialization by `editor-html-roundtrip.test.ts`.
- Supabase (Postgres, Auth, Storage); Edge Functions in `supabase/functions/`
- Vitest 4 (frontend units) + `deno test` (edge-function units beside their
  modules: `_shared/` plus the split function directories — the `deno.json`
  test task holds the collected list)
- LLM providers: Anthropic (Sonnet 4.6, Sonnet 5.5, Opus 4.8, Opus 5.5,
  Fable 5.1), Mistral API (Large 3,
  Medium 3.5, Small 4, and Z.ai GLM 5.3 — the default chat model for new
  profiles; FLOW defaults to Claude Sonnet 4.6), DeepSeek (deepseek-v4-flash).

Entry points: `src/main.tsx` → `src/App.tsx` → `src/pages/Index.tsx`
→ `src/components/ProjectContentArea.tsx`.

## 3. Where things live
(Lists below are representative, not exhaustive.)
- `src/components/` — feature UI; notable subtrees `flow-report/`, `creative-tools/`, `ui/` (shadcn).
- `src/hooks/` — data + persistence (`useWritingContent`, `useChatMessages`,
  `useFlowAnalysis`, `useProvenanceTracker`, `usePostIts`, `useBookmarks`,
  `useCreativeData`, `useProjects`, `useUserSettings`, `useInstanceConfig`).
- `src/contexts/` — `AuthContext`, `UserSettingsContext`, `CreativeAIContext`.
- `src/lib/` — pure utilities: `provenance-tracker.ts`, `flowBands.ts`,
  `flow-work-profiles.ts`, `flow-profile-paintings.ts`, `export-docx.ts`,
  `export-json.ts`, `markdown-to-pm.ts`, `tiptap-font-size.ts`,
  `editor-extensions/pagination.ts`, `sse-stream.ts`, `estimateTokens.ts`.
- `supabase/functions/_shared/` — `_llm.ts` (provider router), `_repair.ts`,
  `_temperatures.ts`, `_thinking.ts`, `_models.ts` (model allowlist,
  input caps, per-model context limits), `_provenance.ts`, `_similarity.ts`,
  `_conversation_memory.ts` (rolling per-thread chat summary),
  `_prompts.ts` (mode/template system prompts shared by chat +
  context-prompt).
- Edge functions (8): `chat`, `analysis`, `editor-action`, `context-prompt`,
  `extract-text`, `share-report`, `config`, `delete-account`.

## 4. Conventions (mirror these; don't drift)
- **Layout**: root is `h-screen overflow-hidden`; flex parents get
  `min-h-0`; inactive panels are hidden via `display: none`, never
  unmounted (state would be lost).
- **Styling**: only semantic tokens from `src/index.css`. No hardcoded
  colors in UI (`text-white`, `bg-black`, `bg-[#...]`, inline hex). Light
  theme, parchment secondary background, primary blue, Silver Lake Blue
  for FLOW. Theme shadcn via variants, don't fork components.
  *Intentional exception:* the FLOW band/profile palettes in `flowBands.ts`
  / `flow-work-profiles.ts` are domain data (an AI→Human gradient), not
  styling — raw hex there is expected. (A handful of stray inline hex
  colors in components, e.g. the FLOW button, predate this rule and are
  audit-cleanup targets, not precedent.)
- **Persistence**: debounced auto-save; awaited flushes block project
  navigation; flush functions held in stable refs.
- **Provenance**: native ProseMirror mapping, bias left (-1) for
  insertions; pending-signal pattern in `provenance-tracker.ts`.
- **Transparency logging** (load-bearing — see §7): the evolving
  `writing_summary_log` is deliberately **withheld from FLOW** (the
  `analysis` function never reads it). The writing summary reaches FLOW
  only as a chat message flagged `flow_flag='not_assessed'` (the per-turn
  delta, never the full summary). `Ask` and `Propose` both persist the
  exchange (prompt + summary delta + reply, summary log advanced) **at
  delivery time**, server-side in the stream-first flush — a dismissed or
  never-decided proposal is still logged (deliberate contract, 2026-07).
  The `context-prompt` CONFIRM endpoint records only the decision:
  pending-gated outcome transition (first decision per action row wins;
  replays/flips no-op idempotently); only acceptance injects the text —
  and its `[ai]` provenance — into the writing. The three FLOW-input
  tables (`chat_messages`, `writing_summary_log`, `ai_editor_actions`)
  are **user-read-only** (write policies dropped, `20260709120000`): all
  writes go through the edge functions' service-role clients behind
  upfront ownership checks, so FLOW signals can't be self-forged via
  direct PostgREST writes. `chat_threads` is likewise **user-undeletable**
  (DELETE policy dropped, `20260904120000`): a direct thread delete would
  cascade away that thread's `chat_messages`, side-stepping the lockdown.
  The UI never offered thread deletion; project deletion still cascades
  normally (FK referential actions bypass RLS). The same rule covers the
  **report evidence** (`20260924120000`): `flow_reports` rows are inserted
  only by the `analysis` function through its service-role client (user
  INSERT/DELETE policies dropped; users keep SELECT and UPDATE for share
  toggles and feedback), and `writing_versions` is user-undeletable (the
  client inserts versions; the replay timeline must not be thinned).
  `token_usage` is the deliberate exception: its user INSERT policy stays,
  because the RLS-scoped user client writes the usage row precisely so its
  `user_id` is bound to the caller — it is an audit log that neither FLOW
  nor the budget counter reads. The per-thread **conversation memory**
  (`chat_thread_summaries`, maintained by `_shared/_conversation_memory.ts`
  in the chat/context-prompt stream tails) follows the same pattern —
  user-read-only, service-role writes, injected into chat and
  context-prompt prompts — and is **never** read by FLOW (same principle
  as the withheld `writing_summary_log`: continuity aid, not assessment
  evidence). Don't collapse these paths.
- **RLS**: security-definer functions (`owns_project`, `owns_thread`)
  verify ownership through the profile → project hierarchy; project-child
  tables gate on `owns_project(project_id)`. There is **no role system
  today** `(not yet implemented)` — if roles are ever added, put them in a
  dedicated `user_roles` table, never on profiles or client storage.
- **Migrations**: every `public` `CREATE TABLE` is followed, in the same
  migration, by `ENABLE ROW LEVEL SECURITY`, per-op policies
  (`TO authenticated`, USING/WITH CHECK on ownership) **and explicit
  grants**: to `authenticated` exactly the operations that have a policy,
  `ALL` to `service_role`, nothing to `anon` on base tables (its reads go
  through the `get_shared_report` RPC), and `TRUNCATE, REFERENCES, TRIGGER` revoked
  from both user roles. Supabase no longer grants Data API access to new
  tables automatically (`20260925120000` explains and applies this to the
  17 existing tables), and `src/lib/__tests__/migrations-privileges.test.ts`
  replays the migrations in CI and fails when grants and policies disagree.
  RLS remains the layer that restricts rows; grants only mirror it.
  **Views** are the exception that bites: an owner-executed view bypasses
  RLS on its base table and, when auto-updatable, accepts writes through
  PostgREST — so `REVOKE ALL … FROM PUBLIC, anon, authenticated` right
  after `CREATE VIEW`, and `GRANT SELECT` only if the roles are meant to
  read it (`flow_reports_public` grants nothing: shared reports are read
  through the `get_shared_report` RPC; `20260925130000` closed the
  leftover write privileges found on production). The lint fails when a
  user role holds more than SELECT on a view.
- **RLS perf (`auth_rls_initplan`)**: the advisor wants `auth.uid()` wrapped as
  `(select auth.uid())` so it's evaluated once per statement, not per row.
  Applied everywhere, including the two `profiles` policies since
  `20260707000000` replaced the self-referencing budget-freeze `WITH CHECK`
  with column privileges. General trap (how the old form bit us — see
  `20260703000000`): a policy whose USING/WITH CHECK subqueries read its **own
  table** must keep bare `auth.uid()` — the `(select …)` form tips Postgres's
  RLS recursion guard → `42P17 infinite recursion detected in policy`. Wrap
  simple predicates only.
- **Budget-column freeze (column privileges, not RLS)**: since `20260707000000`
  `authenticated` holds column-level UPDATE on `profiles` for the preference
  columns only; the budget columns (`monthly_token_budget`,
  `tokens_used_this_period`, `token_period_start`) are not user-writable at
  all. Token accounting goes through the SECURITY DEFINER
  `increment_tokens_used` RPC (atomic `+ amount`, bypasses column privileges) —
  **never** write `tokens_used_this_period` via a `.update()`. If Settings
  ever needs a new user-editable profile column, extend the column-level
  `GRANT UPDATE`, or the write fails with `42501 permission denied`.
- **SECURITY DEFINER functions**: default to `GRANT EXECUTE TO PUBLIC`, so
  `REVOKE ALL … FROM PUBLIC, anon, authenticated` (Supabase grants the
  `anon`/`authenticated` API roles EXECUTE **directly** via default privileges,
  so a `PUBLIC`-only revoke leaves them) and re-`GRANT EXECUTE` only to the roles
  that call them (`authenticated` and/or `service_role`); guard the body with
  `auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM <target-user>`
  (the NULL-safe form blocks `anon`). Trigger/event-trigger functions get no
  grant (the trigger machinery runs them as owner). *Accepted advisor finding:*
  `flow_reports_public` is an intentional SECURITY DEFINER **view** — the
  sanitized public-share surface that replaced a base-table anon policy; dismiss
  the `security_definer_view` lint rather than switching to `security_invoker`.
- **Secrets**: Edge functions read secrets via `Deno.env.get("NAME")`;
  values are injected by the host (`supabase secrets set`), never
  committed. Frontend only reads publishable values via
  `import.meta.env.VITE_*`; private keys stay server-side.

## 5. AI routing
- Model registry: `src/lib/models.ts` (id, label, provider, pricing, context
  limit, `flowRecommended`). The Settings pickers fold the registry into
  collapsible groups (`src/components/settings/ModelPicker.tsx`): by serving
  API for chat (`groupModelsByProvider`), by FLOW recommendation for FLOW
  (`groupModelsForFlow`, the second group topped by a "not currently
  recommended" notice). A new model lands in the right group by itself; the
  recommendation is the flag, never note wording.
- Users pick two models in Settings: `preferred_chat_model` and
  `preferred_flow_model` on `profiles`. Editor-action and context-prompt
  reuse `preferred_chat_model` — there is no separate per-function picker.
- **Provider wire format** (`_shared/_llm.ts`): routing is by model-id
  prefix (`claude-*` → Anthropic, `deepseek-*` → DeepSeek, else Mistral).
  Two body translators only — `toAnthropicBody` and `toOpenAIBody`;
  **DeepSeek shares the OpenAI path with Mistral** (no third translator).
  `normaliseResponse` maps every provider back to OpenAI shape so callers
  don't branch.
- **FLOW structured output**: for Anthropic, `analysis` uses **Structured
  Outputs** (json_schema) plus a repair-then-retry loop (`_repair.ts` fixes
  Claude's occasional stringified-pillar output; one retry on validation
  failure). Mistral uses forced tool-calling for the same schema (named
  `tool_choice`); **DeepSeek falls back to `tool_choice: "auto"`** —
  deepseek-v4-flash runs in thinking mode, which 400-rejects a named
  `tool_choice` ("Thinking mode does not support this tool_choice"), so it
  relies on prompt compliance (`callLLM` gates this per-provider). All
  converge through `normaliseResponse`.
- Per-model knobs live in `supabase/functions/_shared/`:
  - `_temperatures.ts` — `{FLOW,CHAT,EDITOR,CONTEXT}_TEMPERATURE` tables
    + `NO_TEMPERATURE_MODELS` (Opus 4.7 and later, Sonnet 5.5 and Fable 5.1
    reject any non-default temperature with HTTP 400 — do NOT generalize to
    all Claude models: Sonnet 4.6 accepts it).
  - `_thinking.ts` — `*_THINKING` / `*_EFFORT` (Claude),
    `*_MISTRAL_EFFORT` + `MISTRAL_REASONING_MODELS` allowlist
    (Mistral Large 3 returns 422 if `reasoning_effort` is sent),
    and `resolveMaxTokens()` for thinking-aware budget headroom.
  - `_models.ts` — the model facts that gate the wire format and the
    effort unions (`CLAUDE_ALWAYS_THINKING`, `CLAUDE_THINKING_OFF_BETWEEN_TOOLS`,
    `ClaudeEffort`, `MistralEffort`): the one module `_llm.ts` and
    `_thinking.ts` both import without a cycle.
- **No router bypasses**: every LLM call goes through `_llm.ts`.
  (`extract-text`'s former hardcoded Mistral call was removed in #10 — it
  now summarizes with the user's `preferred_chat_model` and silently falls
  back to a 500-char truncation if that provider's key is unset. It is also
  the one LLM function without an `isOverBudget` precheck — tracked.)
- See `docs/model-configuration.md` for current values, rationale, and
  the full "adding a new model" checklist.
- Provider keys (`ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`)
  are edge-function env vars.
- Do not introduce or reintroduce any Sylou-metered "token budget" wording
  in UI copy. (The `profiles.monthly_token_budget` /
  `tokens_used_this_period` columns *do* still exist server-side: an
  operator-only cap, set via SQL, enforced by the column-privilege freeze
  (§4) + the `increment_tokens_used` security-definer RPC — the single write
  path all edge functions use for token accounting. The SaaS/Stripe columns
  were dropped; budget defaults to NULL = no cap.)
- No ad-hoc rate-limiting/throttling primitives in app code: per-user request
  throttling is deferred to a future platform primitive, so security-audit
  findings recommending one are acknowledged-and-deferred, not built. Cost is
  bounded by the operator token budget above (resets per calendar month via the
  `reset_tokens_if_stale` RPC); operators layer on platform protection
  (Supabase auth rate limits, WAF) — see `docs/setup.md`.
- Web search only for current-events queries; always inline source links.
- Token estimation runs before analysis; a warning modal fires near
  the context-limit thresholds.

## 6. Commands
- Tests: `npx vitest run` (or a specific file path); edge-function units:
  `cd supabase/functions && deno task test`. ⚠️ The test task collects an
  explicit directory list — a function directory gaining its first tests
  must be added there, or they silently never run.
- Typecheck (frontend): `npm run typecheck` (`tsc --noEmit -p tsconfig.app.json`;
  `strict` is on). NOTE: bare `tsc --noEmit` is a no-op here — the root
  `tsconfig.json` is solution-style (`files: []`) so it checks **zero** `src/`
  files; always target the app project.
- Typecheck (edge functions): `cd supabase/functions && deno task check`
  (needs a local `deno`; config in `supabase/functions/deno.json`). Deploy
  (`supabase functions deploy`) remains the authoritative gate, but this
  catches type errors locally first.
- Git: Claude Code may run git commands when explicitly requested.
  Default discipline:
  - Always work on a feature branch named `claude/<short-description>`,
    never directly on `main`
  - Create commits with clear messages following conventional commits
    (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
  - Push branches and let PR auto-creation handle the rest
  - Never commit without showing the diff first
  - Never push to `main` directly under any circumstances

## 7. Refactor guardrails (discuss before changing)
- Streaming lifecycle across `chat/`, `context-prompt/`, `editor-action/`
  + `_shared/_llm.ts`: all three are SSE proxies that re-emit a
  `{token}/{phase}/{done}` vocabulary. `callLLM` returns the raw fetch
  Response and each function owns a **stream-first `ReadableStream`** (kept
  open until `controller.close()` so the Deno isolate survives long enough
  to persist). `context-prompt` has the richest phase set
  (`reviewing`/`reading_documents`/`searching_web`/`thinking`). Chat and
  context-prompt relay the provider stream through `relayProviderStream`
  (`_sse.ts`: `{token}` per text delta, one `thinking` phase at the first
  reasoning chunk, nothing else forwarded) and keep the response alive with
  an SSE comment every 15 s (`keepAlive`) — a quiet response was observed
  being closed in front of the function during a long think. Editor-action
  keeps its own `readProviderStream` call and disconnect latch. One client
  consumer, `src/lib/sse-stream.ts`, which skips comment lines. Phase
  events + the budget/`done` payloads are load-bearing for the UI. The editor-action and context-prompt `done`
  payloads carry `truncated: true` when the provider stopped at max_tokens
  (`onStop` on `readProviderStream`, `isTruncatedStop` in `_llm.ts`); the
  selection window warns before Accept. They carry `refused: true` on a
  provider safety refusal (`isRefusalStop`); the window then shows the
  message as a notice and offers only Reject. Chat answers a provider
  timeout (Call #1, a loop check call, or a streamed call before its first
  byte) with `PROVIDER_TIMEOUT_MESSAGE` persisted as the reply, like
  refusals and empty replies, so the notice survives a thread switch;
  context-prompt keeps its transient error event. Output budgets live in
  `_models.ts` (`OUTPUT_BUDGETS`), mirrored by `src/lib/editor-limits.ts`.
- Transparency logging invariants (see §4): withheld `writing_summary_log`,
  `not_assessed` summary flagging, delivery-time logging of Ask and Propose
  (CONFIRM records only the decision).
- Provenance tracker pending-signal pattern (`src/lib/provenance-tracker.ts`).
  Persistence hydration guard (`useProvenanceTracker`): nothing is written to
  `provenance_events` until the map fetched for the project was applied to
  the loaded document; a failed fetch keeps provenance in memory only. Its
  companion in `useWritingContent`: saves are refused after a failed content
  load. Both exist because the switch/unmount flushes once wrote `[]` over a
  real map when a project was left before its text finished loading, and
  the next edit persisted the "no map → all typed" fallback (2026-09).
  Pinned by `src/hooks/__tests__/`. `WritingEditor` keeps the spinner up
  until BOTH fetches are done (a keystroke into the empty editor before the
  text was placed used to be saved over the real document) and shows a
  reload panel instead of an editor when the text fetch failed.
- Editor stable-ref flush pattern in `useWritingContent` / `WritingEditor`.
  The client **must flush editor + provenance before `runAnalysis`** — the
  `analysis` function reads writing/provenance from the DB, not the request,
  so an un-flushed edit would be scored stale. TipTap v3 `destroy()` nulls
  the editor's schema/commands: any code touching `editor.*` after an
  `await` (or from a closure that can outlive the editor) checks
  `editor.isDestroyed` first — v2 silently no-op'd there, v3 throws.
  WritingEditor's `onTransaction` re-emits `update` for identical-document
  transactions (v3 suppresses them; the provenance pending signal must still
  be consumed) — see `editor-update-guard.test.ts`.
- FLOW methodology, FLOW prompt, FLOW scoring (4 pillars, 0.0–5.0) and the
  16 four-character work-style codes — product decisions, not
  implementation details. Style code = each pillar's score thresholded at
  ≥3.0 (`flow-work-profiles.ts`); the 6 display bands live in `flowBands.ts`
  (UI shows the band label, never the raw number).

## 8. Review checklist for PRs
- No hardcoded colors or one-off CSS overrides in UI (semantic tokens only).
  Exception: FLOW band/profile palettes are domain data (see §4).
- No new `public` table without `ENABLE RLS` + per-op policies (add a
  `GRANT` only if a non-default role like `anon` needs access).
- No role checks anywhere — there is no role system; don't add ad-hoc ones
  against profile rows or client storage `(not yet implemented)`.
- No new backend server code — Edge Functions only.
- Keep components small; extract hooks rather than growing components.
  (Known oversized offender flagged for the refactor audit:
  `ProjectContentArea.tsx`. `context-prompt/`, `analysis/` and `chat/`
  were split into sibling modules in the P4-1 campaign.)
- Confirm debounced-save + flush-on-navigation paths still hold for any
  new persisted state.
- Builds are auto-triggered by Vercel on push to main. Don't run
  `npm run build` / `vite build` manually unless verifying locally.
- Edge function deployment: manual via `supabase functions deploy`.

## 9. Deeper docs
- `docs/engineering-standards.md` — distilled coding rules + per-PR
  Definition-of-Done (give it to AI coding assistants as context; where it
  disagrees with this file, this file wins)
- `docs/setup.md`, `docs/model-configuration.md`, `docs/ai-act-position.md`
- `TRANSPARENCY.md`, `SECURITY.md`, `CONTRIBUTING.md`, `TRADEMARK-POLICY.md`,
  `LICENSING.md`
