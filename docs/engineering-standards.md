# Sylou engineering standards — AI & human contributor guide

Rules for writing Sylou code that is secure, correct, and maintainable. Distilled
from the July 2026 full-repo audit: every rule below exists because its violation
was either found in this codebase or explicitly defended against. This is the
"don't repeat our audit findings" file.

**How to use it**
- **With an AI coding assistant** (Claude, GPT, Cursor, Copilot, Lovable, …):
  include this file in the assistant's context before asking for Sylou code, and
  ask it to run the **Definition of Done (§11)** against its own diff before
  presenting it.
- **As a human:** read once, then consult §11 per PR.

Companions: `CLAUDE.md` (project context & conventions — if the two disagree,
CLAUDE.md wins), `TRANSPARENCY.md` (product invariants), `CONTRIBUTING.md`
(process), `docs/setup.md` (deployment). Where any doc disagrees with the code,
the code is authoritative — flag the drift rather than guessing.

---

## 0. Prime directives

1. **Transparency beats efficiency.** Never weaken what the FLOW analysis can
   see, or how AI contributions are recorded, to save tokens or code. If a
   change touches transparency, say so explicitly in the PR (TRANSPARENCY.md §9).
2. **Fail closed, fail loudly.** Missing config, failed auth, failed
   ownership check, failed parse → reject with a clear error. Never fall back
   to permissive behavior, and never report success that didn't happen.
3. **Every database write can fail.** Handle the failure or surface it. A
   `console.error` alone is not error handling.
4. **The server is the only enforcement point.** Client-side checks (size caps,
   type filters, field gating, token filtering) are UX, not security — anything
   that matters must also be enforced in an edge function, RLS policy, or
   bucket/database constraint.
5. **Load-bearing invariants (§3, §4) are redesigned only with explicit
   maintainer discussion** — never as a side effect of another change.
6. **Small PRs, one concern each.** Don't refactor opportunistically in a bug
   fix; flag the refactor instead.

---

## 1. Security

### 1.1 Database & migrations

- Every new `public` table ships in the same migration with:
  `ENABLE ROW LEVEL SECURITY` + per-operation policies (`TO authenticated`,
  USING/WITH CHECK on ownership via `owns_project(project_id)` /
  `owns_thread(thread_id)` / `id = auth.uid()`). No `USING (true)` on user data.
- Every child table gets a **real foreign key** with an explicit `ON DELETE`
  action (CASCADE unless justified). RLS is not referential integrity — a table
  gated by `owns_project()` but without an FK orphans forever when the project
  is deleted.
- `SECURITY DEFINER` functions: pin `SET search_path = public`; then
  `REVOKE ALL ... FROM PUBLIC, anon, authenticated` (Supabase grants the API
  roles EXECUTE *directly*, so a PUBLIC-only revoke is insufficient) and
  re-`GRANT EXECUTE` only to the roles that call it. Guard the body:
  `auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM <target>`
  (NULL-safe — blocks anon). Reject negative/absurd amounts. Trigger functions
  get no grants at all.
- **Never** wrap `auth.uid()` as `(select auth.uid())` in a policy whose
  subquery reads its own table — it trips Postgres's recursion guard
  (`42P17 infinite recursion`). Wrap simple predicates only.
- `anon` grants only on deliberately public, sanitized surfaces — and a
  **capability token must be enforced server-side** (a view or RPC that filters
  by the token). A public view that the client filters by token is an
  enumerable directory, not a capability URL.
- Migrations are **idempotent** (`CREATE OR REPLACE`, `IF EXISTS`,
  `ALTER POLICY`, guarded `ADD CONSTRAINT`). Migrations are applied by a
  human, never by an AI assistant: the maintainer's production database
  through the SQL editor, fresh instances (including staging) with
  `supabase db push` (docs/setup.md). The file in `supabase/migrations/`
  remains the source of truth.

### 1.2 Edge functions

- All functions run `verify_jwt = false` and **self-authenticate fail-closed**:
  read the `Authorization` bearer, `supabase.auth.getUser()` (or `getClaims`),
  return 401 on any failure, before doing anything else.
- The service-role client **bypasses RLS**: every query it executes must be
  scoped by an ownership-verified id (`project_id`, `thread_id`, `user.id`)
  derived from the authenticated context — never from the request body
  unchecked. Prefer doing reads through the user-scoped (RLS) client and
  reserving service-role for the specific writes that need it.
- **Never trust the request body**: validate `model` against the registry in
  `src/lib/models.ts`; cap text lengths server-side; validate enums/flags;
  every id must pass an ownership check before use.
- CORS: allowlist from `ALLOWED_ORIGIN` (comma-separated), echo the Origin only
  if allowlisted, never `*`. Unset → emit no `Access-Control-Allow-Origin`.
  Error responses carry the same CORS headers as success responses.
- Secrets only via `Deno.env.get("NAME")` (inside a handler,
  `deps.env.get("NAME")`, which is `Deno.env` in production), documented in
  `supabase/functions/.env.example`. Never referenced in `src/`, never echoed
  in any response or error message. Provider error bodies are truncated and
  message-only before reaching the client.
- Confirm/act-style endpoints are **idempotent**: gate state transitions on the
  current state (`... WHERE outcome = 'pending'`), so a replayed or duplicate
  request is a no-op. Don't accept content from the client that the server
  already produced — persist it server-side at generation time and reference it
  by id at confirm time.
- File handling: enforce size and type **server-side** (bucket
  `file_size_limit` / `allowed_mime_types`, or checks in the function; prefer
  magic-byte sniffing over extension). Verify the storage path prefix
  (`file_path.startsWith(user.id + "/")`) **before** any privileged download.
  Parse untrusted files inside a wall-clock timeout (`Promise.race` /
  `AbortController`); fail closed with a generic error; never log file buffers
  or extracted text.
- Untrusted text (user writing, imported documents, web results) that flows
  into an LLM prompt is **data, not instructions**: delimit it explicitly and
  instruct the model that content inside delimiters can never override its
  instructions. Remember the FLOW analysis is adversarial by nature — users
  benefit from inflating their own scores.

### 1.3 Frontend security

- Any user or AI HTML rendered outside the authoring context (especially the
  public report page) goes through `DOMPurify.sanitize`. Markdown renders via
  `react-markdown` **without** `rehype-raw`.
- Never "gate" private fields client-side on a public surface — if the column
  isn't meant to be visible, it must not be in the view/RPC at all.
- Frontend reads only `import.meta.env.VITE_*` publishable values.

---

## 2. Correctness & data integrity

- **supabase-js does not throw.** Every call returns `{ data, error }`; check
  `error` on every persistence call, and propagate or surface it:

  ```ts
  const { error } = await supabase.from("t").update(x).eq("id", id);
  if (error) { /* surface: return failure / emit SSE error / toast */ }
  ```

- Think through **partial failure order** for multi-write operations: what
  state exists if write N fails after write N−1 succeeded? Prefer a single
  atomic write (one row, one RPC) over sequences; where a sequence is
  unavoidable, make the client-visible success signal depend on all of it.
- **"Last N" queries:** `order(..., { ascending: false }).limit(N)` then
  `.reverse()`. Ascending + limit returns the *oldest* N — a real bug we shipped.
- **Counters are atomic RPCs** (`increment_tokens_used`), never
  read-modify-write from a value fetched earlier in the request — concurrent
  requests lose updates.
- **Offsets have units.** ProseMirror positions, HTML string indexes, and
  plain-text offsets are three different coordinate spaces; never index one
  representation with another's offsets (this corrupted FLOW's provenance
  annotations). Name variables with their space (`pmPos`, `htmlIdx`) and
  convert explicitly at boundaries.
- **UTF-16 safety:** `.slice(0, n)` can split a surrogate pair; Postgres
  rejects lone surrogates in jsonb. Truncate with a surrogate-safe helper
  before persisting.
- **Debounced saves & flushes:** flush functions return success/failure;
  a navigation-blocking flush that failed must surface (toast + block or
  retry), not silently proceed. Any new code path that changes the active
  project/thread routes through the existing flush path — never set the
  selection state directly.
- **Per-project state resets on project switch** — including editor undo
  history: an editor instance that survives a switch lets Ctrl+Z restore the
  previous project's content into the new one. Remount (`key={projectId}`) or
  explicitly clear all history/trackers.
- **Async races:** guard every async callback that writes state with a
  current-id ref (`if (threadIdRef.current !== threadId) return;`); give
  user-cancellable requests an `AbortController`; never reuse a fixed id for
  list items (React keys collide).

---

## 3. Streaming (SSE) contract — load-bearing

`chat`, `context-prompt`, `editor-action` are SSE proxies with one client
consumer (`src/lib/sse-stream.ts`). The contract:

- **Stream-first `ReadableStream`**, kept open until `controller.close()` in a
  `finally`. All persistence (messages, action rows, `token_usage`, budget
  RPC) happens **before** `close()` so the Deno isolate survives long enough.
- **`TransformStream`/`pipeThrough` is forbidden** for these responses: client
  disconnect propagates cancellation and skips your flush — persistence and
  billing silently vanish. A client disconnect must **not** skip persistence
  or billing: keep consuming the provider stream and persist regardless.
- Event vocabulary is `{token}` / `{phase}` / `{done}` (+ `{error}`); the
  `done` payload (persisted ids, budget info) is load-bearing for the UI.
  Every failure path emits an event the client can render — a stream that just
  ends leaves the UI hanging on inference.
- No work is scheduled after the response completes (no fire-and-forget
  `.then()` chains post-`done`) — the isolate may be torn down.
- Don't unify or "simplify" the per-function stream handling into a shared
  abstraction without maintainer discussion; if extraction is agreed, the
  extracted helper must preserve exactly these semantics.

---

## 4. Transparency invariants — product-critical

These are the product. Breaking them silently is the worst class of bug Sylou
can have; changes require an explicit transparency-impact note in the PR.

- The evolving `writing_summary_log` is **withheld from FLOW** (the `analysis`
  function never reads it). The writing summary reaches FLOW only as a chat
  message flagged `flow_flag = 'not_assessed'`, and only as the **per-turn
  delta**, never the full summary.
- **Ask and Propose both persist the exchange at delivery time** (prompt,
  summary delta, reply; summary log advanced), server-side in the same
  request, so a dismissed or never-decided proposal is still logged. The
  CONFIRM endpoint records only the decision: the first decision per action
  wins, and only acceptance injects the text (with its `[ai]` provenance) into
  the writing. Keep the delivery-time log and the decision record separate.
- **Every AI interaction must end up visible to FLOW** — as a chat message, an
  `ai_editor_actions` row, or provenance. Cancelling, closing a window, or a
  mid-stream error must still record the interaction's outcome; an abandoned
  flow that leaves no trace is a hole in the ledger.
- Provenance tagging: new text is classified by the **pending-signal** pattern;
  position mapping uses the editor's native transform with bias −1; for
  multi-step transactions map step-local positions with
  `mapping.slice(i + 1).map(newStart)` — mapping a step's input coordinates
  through the whole transaction is wrong.
- AI-generated content carries `data-ai-generated` / `data-ai-model` markers;
  reports disclose the generating model and settings. Don't drop these in
  refactors.

---

## 5. LLM integration

- **All LLM calls go through `_shared/_llm.ts`.** No direct provider fetches
  in functions. Routing is by model-id prefix; exactly two body translators
  (Anthropic, OpenAI-shape — DeepSeek shares the OpenAI path); every response
  is read via `normaliseResponse`, never provider-specific parsing at call
  sites.
- Per-model knobs live **only** in `_shared/_temperatures.ts` /
  `_shared/_thinking.ts`. Model quirks are per-model allowlists — never
  generalized ("Opus rejects temperature" must not become "Claude rejects
  temperature"; "Mistral Large rejects reasoning_effort" must not become
  "Mistral rejects it").
- If a call passes an option (e.g. a forced tool choice), verify the translator
  for **every** provider actually emits it — a silently ignored option is a bug
  that hides as model flakiness.
- **Budget before, billing always:** check `isOverBudget` before the expensive
  call; record `token_usage` and increment the budget RPC on success **and**
  on failure paths (failed attempts still cost the operator money).
- Structured output: validate against the schema **including value types and
  ranges** before persisting; a defaulted/repaired section must be flagged in
  the stored metadata, never silently substituted.
- Prompt-size budgets are **model-aware**: derive context limits from the
  registry entry for the model actually in use, not from one provider's
  numbers.
- No Sylou-metered "token budget" wording in UI copy (operator-only concept).

---

## 6. Frontend architecture

- **Layout:** root is `h-screen overflow-hidden`; flex parents that must
  shrink get `min-h-0`; inactive panels *within a project* are hidden via
  `display: none`, never unmounted (state preservation). Inside nested
  containers use `h-full`, not `h-screen`.
- **Styling:** semantic tokens from `src/index.css` only — no `text-white`,
  `bg-[#...]`, inline hex in UI. Exception: the FLOW band/profile palettes are
  domain data. Theme shadcn via variants; don't fork or hand-edit `ui/*`.
- **Errors reach users:** a failed user-initiated action (save, share, create,
  toggle) shows feedback — sonner toast or inline state. Fire-and-forget
  persistence is not acceptable for user content.
- **Rendering discipline:** memoize context `value` objects; `memo` heavy
  children (chat bubbles, report views); don't lift per-keystroke editor state
  into ancestors unless something actually consumes it; virtualize or bound
  long lists. Assume novel-length documents and long chat threads.
- **Bundle:** lazy-load secondary routes and heavy deps (docx export, QR,
  charts) at interaction time; the public report page must not pull the
  authoring app.
- **Structure:** keep components small; extract hooks rather than growing
  components; follow the existing hook-per-table data pattern. New cross-
  component communication should use context/state, not new mutable callback
  refs.
- **a11y baseline:** interactive elements are real `<button>`/`<a>` with
  keyboard paths; icon buttons get `aria-label`; global shortcuts must not
  fire while focus is in an input.

---

## 7. Dependencies & code organization

- **Bias against new dependencies** (CONTRIBUTING policy). Every import must
  exist in `package.json` — no phantom deps that resolve transitively. Remove
  a dep when its last usage goes.
- **Frontend versions are pinned exact** — no `^`/`~` ranges: `package.json`
  carries the precise tested version of every dependency, `.npmrc` sets
  `save-exact`, and an `overrides` block freezes the `prosemirror-*` family
  (transitives whose drift changes *editor semantics* — a routine lockfile
  regeneration once changed paste fitting and broke provenance capture in
  the field). Upgrades are deliberate PRs: bump the pin, regenerate the
  lockfile, and let the full gates — including the real-editor provenance
  fixtures — judge the new versions.
- **Any dependency change regenerates the attribution file**: run
  `npm run licenses:generate` (rebuilds `THIRD_PARTY_LICENSES.md` from the
  lockfile) in the same PR — CI fails on drift. Edge-function URL imports
  are hand-listed in `scripts/generate-third-party-licenses.mjs`
  (`EDGE_DEPS`); update that list when one changes. New licenses must stay
  AGPL-3.0-compatible (MIT/ISC/BSD/Apache-2.0 class).
- Edge functions **can and must share code via `supabase/functions/_shared/`**.
  Do not copy-paste helpers between functions, and do not write comments
  claiming sharing is impossible (it isn't).
- Deno remote imports pinned to exact versions; prefer `npm:` specifiers over
  `esm.sh` URLs.
- TypeScript strict; no `as any`, no `type X = any` aliases; boundary data is
  `unknown` + narrowing. Files pushing past ~500 lines are a smell — split by
  responsibility.

---

## 8. Testing & verification

- New pure logic gets tests: vitest (`src/**/__tests__/`) or `deno test`
  (`*.test.ts` beside the module — in `_shared/` or the function's own
  directory). Two hard-won rules: the `deno.json` test task collects an
  explicit directory list, so a directory gaining its first tests must be
  added there or they silently never run; and a test imports a function's
  `index.ts` only through `importHandler` (`_shared/_test_support.ts`), which
  stubs `Deno.serve` first — a plain import would start a server. Handler
  tests drive `handler(req, deps)` with fakes; other testable logic lives in
  sibling or `_shared/` modules.
- Before any PR: `npm run typecheck && npm run lint && npm test`, and for edge
  changes `cd supabase/functions && deno task check` + `deno task test`.
  ⚠️ Bare `tsc --noEmit`
  is a **no-op** in this repo (solution-style root tsconfig) — always use
  `npm run typecheck`.
- Fixes for data-corruption or race bugs need a **manual repro** before and
  after, not just green gates.
- Edge functions deploy manually (`supabase functions deploy`) — flag in the
  PR when a merge needs a deploy to take effect.

---

## 9. Git & PR process

- Feature branch off `main` (never commit to `main`); conventional-commit
  subjects (`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`); **DCO
  sign-off on every commit** (`git commit -s`). Maintainer squash-merges.
- One concern per PR. PR description states what changed, how to test, and the
  **transparency-impact note** (required — "none" is a valid answer, silence
  isn't).

---

## 10. Known traps (each cost real debugging time)

- `42P17` RLS recursion: `(select auth.uid())` wrap + self-referencing policy
  subquery (§1.1). The two accepted `profiles` advisor WARNs are deliberate.
- `REVOKE ... FROM PUBLIC` alone leaves `anon`/`authenticated` EXECUTE on
  Supabase — revoke from all three.
- On the maintainer's production database, the remote migration history
  doesn't match local filenames → apply DDL via the SQL editor; don't
  `migration repair` or `db pull` there.
- The hosted DB has an out-of-band `rls_auto_enable` event trigger (Lovable
  era) — repo migrations must stay self-sufficient without it.
- Perf advisor oscillation: FK covering indexes report as `unused_index` until
  traffic grows — don't drop them to silence it.
- Opus models reject any non-default `temperature` (HTTP 400); Mistral Large 3
  rejects `reasoning_effort` (422). Allowlists in `_temperatures.ts` /
  `_thinking.ts` — don't generalize.
- Upgrading native-binary deps on Windows can silently drop wasm transitive
  deps from the lockfile → `npm ci` fails on Linux; clean-regen the lockfile.
- A Vercel-host 404 with an edge ID on deep links = SPA rewrite problem, not
  data/RLS.
- `getHTML()` is O(document) — never call it per keystroke above the editor.

---

## 11. Definition of Done — self-check before presenting a diff

1. Every new/changed supabase call checks `error`; user-initiated failures are
   surfaced in the UI or as an SSE/HTTP error.
2. No new `public` table without RLS + per-op policies + a real FK with
   explicit `ON DELETE` (§1.1); migration is idempotent.
3. No service-role query without ownership scoping; nothing from the request
   body is trusted unvalidated (§1.2).
4. Server-side enforcement exists for anything security-relevant the UI also
   checks (§0.4).
5. Streaming paths follow §3 exactly (stream-first, persist-before-close, no
   pipeThrough, all failure paths emit events).
6. Transparency invariants (§4) untouched — or the PR explicitly documents the
   change and why (this note is mandatory).
7. LLM calls go through `_llm.ts`; knobs in the knob files; options verified to
   reach every provider's wire format; billing on success and failure (§5).
8. Coordinate spaces and "last N" orderings double-checked (§2).
9. State keyed to a project/thread resets on switch; async callbacks guarded
   against stale context (§2).
10. Styling uses semantic tokens; layout conventions kept (§6).
11. No new dependency without justification; no copy-pasted helper that
    belongs in `_shared/` (§7).
12. Gates green: `npm run typecheck`, `npm run lint`, `npm test`
    (+ `deno task check` for edge changes); tests added for new pure logic.
13. Diff is one concern; commits signed off (`-s`); PR body has the
    transparency note and flags any needed edge-function deploy.

---

## 12. Notes for AI assistants specifically

- Read the files you're changing **in full** before editing; match the local
  idiom (naming, comment density, error style) rather than imposing your own.
- Comments state non-obvious constraints only — never narrate the change or
  address the reviewer.
- Don't reformat, "clean up", or rename beyond the task's scope; flag
  opportunities instead of taking them.
- If this document or CLAUDE.md contradicts what you observe in the code,
  say so and ask — don't silently pick one.
- When you present a diff, state which Definition-of-Done items you verified
  and how (e.g. "ran typecheck+lint+tests: green; §4 untouched: change is
  UI-only").
