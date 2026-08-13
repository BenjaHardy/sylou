# Transparency in Sylou

This document explains how Sylou makes human–AI collaboration visible: what the
FLOW methodology measures, how the scoring scale works and why it's shaped the
way it is, why an AI model is involved in the assessment (and where that assessment
stops), and — in detail — the architecture decisions that keep the record
honest. It's the companion to [`docs/ai-act-position.md`](docs/ai-act-position.md)
(which covers the EU AI Act specifically) and goes deeper into the *why*.

It's written for anyone deciding whether to trust a Sylou report, anyone
self-hosting Sylou, and anyone contributing to it.

---

## 1. The principle: transparency over efficiency

Sylou exists to let a writer proactively demonstrate how they worked with AI using a standardized process-based framework. That goal sets a hard rule that runs through every design decision in this document:

> When transparency and efficiency conflict, transparency wins.

The tension is real and recurring. The most honest possible record would log
the full text of the writing at every moment the AI touched it — given that the AI will then be able to discuss it and re-use ideas and contents in the chat interactions — but that would be unusable in practice (cost, context limits, noise). The most efficient record would log almost nothing — but then a later analysis couldn't tell whether an idea in the final piece came from you or from the AI. Most of the mechanisms described in Section 5 are a *specific* resolution of that tension, chosen so that the transparency guarantee survives and the efficiency cost is paid in a way that doesn't weaken it.

The project needs to be smart in how to handle this tension, and when a choice has to be made: we'd rather the project be slower or more expensive than quietly lose the thread of who contributed what.

---

## 2. The FLOW methodology: why FLOW, and why four pillars

FLOW is the framework Sylou uses to assess a piece of writing. It breaks the
work into the four distinct intellectual processes that any substantial writing
passes through, and scores the human–AI contribution to each one **separately**.

Separating them matters because contribution is rarely uniform. A writer might
originate every idea but lean on the AI for prose; or write every word
themselves around an argument the AI helped structure. A single blended score
would hide exactly the distinction that matters. Four pillars let the
assessment credit the user precisely where they contributed, and be honest
where they did not.

The pillars name the four things you do when you turn a blank page into finished
work:

- **F — Find** *(Research & Critical Thinking)* — you research it. Gathering the
  relevant material, testing claims, comparing sources and alternatives, and
  questioning what the AI offers rather than taking it at face value.
- **L — Lead** *(Ideas & Opinions)* — you form your own view of it. Deciding
  what you actually think — the ideas, positions, and perspective the work will
  advance. This is authorship of *thought*, as distinct from authorship of
  *text*.
- **O — Organize** *(Structure & Argumentation)* — you structure it. Arranging
  those ideas into an order, building the argument or narrative, and shaping the
  logical progression that carries a reader from start to finish.
- **W — Write** *(Writing & Text Production)* — you write it. Rendering the
  structured ideas into finished prose: tone, style, clarity, sentence-level
  craft, transitions, and final drafting.

The order is also the natural progression, which is where the name comes from:
you research before you can form a considered view, you need a view before you
have something to structure, and you structure before the prose can carry it.
Each pillar feeds the next.

But the flow is a *logic*, not a rigid sequence — in practice the stages loop.
Drafting (Write) exposes a gap in the argument (Organize); building the argument
reveals a claim you can't support and sends you back to research (Find);
research changes your mind (Lead). The framework describes how intellectual work
*moves*, not a one-way assembly line — which is also why strong work usually
shows human contribution spread across several pillars rather than concentrated
in one.

Each pillar is scored independently from 0.0 to 5.0 in half-point increments, or
`null` where there isn't enough evidence to judge. The four scores together also
map to one of **16 work-profile codes** (a four-letter code, one letter per
pillar above a threshold — see Section 3), a personality-type-style summary of
the collaboration. The profile is a convenience on top of the scores, not a
separate judgment.

The FLOW methodology is open-source, published under [**CC BY-SA 4.0**](https://github.com/BenjaHardy/sylou/blob/main/LICENSE-METHODOLOGY).

---

## 3. The scale, and why it is asymmetric

### 3.1 This is not a grade

The first thing to understand about the scale is what it is *not*: it is **not a
mark out of five**. 5.0 is not "good" and 0.0 is not "bad". The number describes
*where a contribution sits on a spectrum from AI-led to human-led* — nothing
more. A piece can be excellent and score low on Write (you had the AI draft the
prose), and depending on context it can be a perfectly legitimate way to work. FLOW reports a description, not a verdict. There is no pass or fail.

The six reference points the model is calibrated against:

| Score | Label                  | Meaning                                                                 |
| ----- | ---------------------- | ----------------------------------------------------------------------- |
| 5.0   | Human-authored         | Produced entirely independently of the AI.                              |
| 4.0   | Human-led              | You originated the core; the AI gave minor support.                     |
| 3.0   | Human-led, AI-assisted | You drove it; the AI made notable supporting contributions.             |
| 2.0   | Collaborative          | Genuine two-way work; neither side clearly dominates.                   |
| 1.0   | AI-led, human-refined  | The AI produced most of it; you refined.                                |
| 0.0   | AI-led                 | No meaningful human contribution beyond basic instruction.              |
| null  | Insufficient evidence  | Not enough data to assess this pillar. Used instead of defaulting to 0. |

(For display, Sylou groups scores into descriptive *bands* and always shows the
band label rather than the bare number, so a report reads in words, not digits.)

### 3.2 Why the relationship is asymmetric

The relationship being scored is **asymmetric by nature**: the user prompts, the
AI responds. The user is always the initiator and the AI always the responder.
In this environment there is no mode in which the AI sets out on its own and the
user steps in to support it — there is no self-initiating, agentic AI here.

That rules out building the scale as a clean mirror in which each human-led
anchor is simply flipped into an AI-led equivalent. The roles on either side of
2.0 are not interchangeable, and the rubric's wording reflects this rather than
papering over it.

### 3.3 Why the top of the scale has no AI-side mirror

At first glance the calibration looks lopsided: it runs 0.0 (AI-led) up to 4.0
(Human-led) and then 5.0 (Human-authored). There is a 5.0 "fully human"
pole with no symmetric "fully AI" pole at the bottom.

Indeed, that bottom pole cannot occur in Sylou. A pillar never originates
without human instruction — everything the AI does starts from a human prompt —
so there is no such thing as an "AI-authored" pillar in the sense that 5.0 is
"Human-authored". Our testing bears this out: across runs, the rating model
never assigned a pure-AI origin to a pillar.

So it helps to read the scale as a symmetric collaborative gradient **centred on
2.0**, with one extra human-only pole appended:

```
   (no AI mirror)   0.0 ── 1.0 ── 2.0 ── 3.0 ── 4.0      5.0
                  AI-led         Collab.        Human-led   Human-authored
                     └─────── mirror around 2.0 ───────┘   └─ human-only pole
```

`0.0 ↔ 4.0` and `1.0 ↔ 3.0` mirror each other around the Collaborative midpoint.

> A note on these claims: the testing observations above reflect our own
> evaluation runs with the recommended models.
> Model behaviour varies between providers and may change as models are updated — see Section 4.

---

## 4. Why an AI model is involved in the assessment — and where it stops

A FLOW analysis reads a large amount of material — the full writing, its
provenance, every chat thread, the AI interactions, the creative-tool content,
eventually the imported documents — and produces a structured output about contribution.
LLMs are well suited to exactly this: absorbing and summarising large bodies of
text and reasoning about patterns across them. That capability is why the
assessment is automated.

But the assessment's *place* is deliberately limited:

- **It complements the user, and does not overrule them.** The FLOW analysis sits
  alongside the user's own self-assessment (which can be recorded both before
  and after the analysis), the quantitative activity data, and the provenance
  record. It's one input into a transparent picture, not a final word handed
  down about the writer.

- **It is evidence-led, and the reasoning matters as much as the score.** Every
  pillar comes with the model's written reasoning and several cited pieces of
  evidence. In our experience the analytical narrative is often more valuable than the label it lands on. A reader can check the reasoning against the work.

- **Models differ, and they change.** Some models are markedly better at this
  task than others, and any given model can shift when the provider updates it.
  Sylou discloses which model produced each report. We assess candidate models
  on two criteria:
  
  - **Accuracy** — does the assessment match what actually happened in the work?
  - **Repeatability** — does the same project score consistently across runs?
  
  For labels we expect *small* variation between runs — at most a shift to an
  immediately adjacent band on a pillar, not a swing across the scale. Large
  swings are a signal that a model isn't suitable for FLOW. Current
  recommendations and the rationale behind them live in
  [`docs/model-configuration.md`](docs/model-configuration.md).

If you've tested models on FLOW and want to share findings, see
[`CONTRIBUTING.md`](CONTRIBUTING.md) — this is an area where real-world data
genuinely helps.

---

## 5. How transparency is built into the architecture

This is the engineering core of the document. Each mechanism below is paired
with *why* it exists and *what would go wrong without it*, so that anyone
modifying Sylou understands what they must not break.

### 5.1 The central problem: idea misallocation, and the work-summary mechanism

This is the most important — and least obvious — transparency mechanism in
Sylou, so it's worth stating the problem precisely.

Sylou intends to be a modern text environment, and thus it allows the AI to get context of the contents of the work (and creative tools if available) in order to reply effectively. This only happens at the user's discretion; in practice this occurs when the user uses the "Ask" and "Propose" functionalities from the dedicated window that appears upon text selection.

When you select text in your editor and ask the AI about it ("Ask") or ask it to
rewrite or act upon it ("Propose"), the AI needs to *see your writing* to give a useful
answer. But the FLOW analysis later reads the chat log. If the chat log contains
only your prompt and the AI's response — and **not** the state of your writing at
that moment — then any idea of yours that the AI repeats back, builds on, or
quotes can look, to the analysis, like it originated with the AI. That is **idea
misallocation**, and it would systematically under-credit the writer. It is a failure that  FLOW intends to prevent.

The naive fixes both fail. Logging your full writing into the chat on every such
prompt would be transparent but would blow up the context and token cost of
every later analysis. Logging nothing keeps things cheap but causes the
misallocation above. Sylou resolves the tension with a **sequential, two-call
design**:

1. **First call — produce a work summary.** Before answering, the AI generates a
   *relevant summary* of your current writing (and, for creative projects, the
   creative tools), scoped to what's needed to answer your specific request.
2. **Second call — answer the request** using that summary plus the usual chat
   context.

The summary is then **timestamped and logged into the chat, flagged as
"writing summary (not assessed)"**. That flag is essential: it tells the FLOW
analysis that this content reflects the state of the user's work at this moment —
to be treated as context, not as either party's contribution. The analysis is
explicitly instructed that ideas and contributions appearing for the first time in a summary is normally the user's, unless it came from an external source (indeed, AI contributions would already be logged in the chat and would not appear there for the first time). So the writing's state at the time of the query is on the record, the AI's later comments can't be mistaken for original AI ideas, and the full writing isn't duplicated into every analysis.

**Two logs, on purpose.** The summary is written to two places that are treated
very differently:

- **In a separate `writing_summary_log`** (deliberately **withheld from FLOW**):
  the full, evolving summary is stored so the *next* request's first call can
  diff against it and append only what's changed, rather than rewriting the
  whole summary each time. This running log is an efficiency device for the
  summariser; it never enters the analysis, because feeding the full accumulated
  summary into FLOW would re-introduce the very duplication the chat-delta design mentioned in the point below avoids.
- **In the chat** (fed to FLOW): only the *delta* — the new lines the summary
  added this turn — is logged, flagged `not assessed`. Logging only the delta
  avoids re-stating, on every prompt, summary content already visible earlier in
  the conversation.

**Ask vs Propose.** The prompt, the summary delta, and the AI's reply are
logged to the chat at delivery for Ask and Propose alike, irrespective of any
decision that follows. The only difference: an accepted proposal is injected
into the writing, where it carries an `[ai]` provenance span (the action
record also stores the outcome — accepted, rejected, or left pending). The
chat and the summary log advance in the same server-side step, so the two
never drift out of sync.

### 5.2 The full context-prompt sequence

Putting 5.2 together with the other inputs, a single Ask/Propose runs roughly:

1. Load the current writing (and creative-tool content, for creative projects),
   the existing summary log, and recent chat across the project's threads.
2. **First LLM call** — generate or extend the work/writing summary (per 5.2).
3. Assemble the answer prompt: the appropriate system prompt (classic or Tutor
   mode), project-template context, the work/writing summary, the selected text, the
   instruction, and recent chat (together with conversation memory where applicable).
4. **Imported documents**, if any: the AI is given an *index* of titles and
   summaries and a tool to pull a document's full text on demand; documents you
   mark as favourites are injected in full up front, no tool call needed.
5. **Web search**, if enabled and configured: the AI may call a search tool, and
   is required to cite source URLs inline so you can verify them.
6. **Second LLM call** — produce the answer (Ask) or proposal (Propose),
   streamed back to you, with progress phases surfaced as it works
   ("reviewing", "reading documents", "searching the web").
7. Persist and log the exchange (prompt, summary delta, reply) as it
   completes — for Ask and Propose alike; a Propose additionally records
   your subsequent decision on the action record.

Every document read and every web search performed in this sequence is recorded
against the resulting message, so the analysis can see not just what the AI said
but what it consulted.

### 5.3 Provenance tagging as supporting data

As you write, Sylou tracks the origin of every span of text in the editor and
stores it as a provenance map. This is used as an extra signal alongside the rest that feeds into the FLOW analysis (mostly for the Write pillar). Four tags are used:

- `[t]` — **typed** by the user (this also covers text the user copied from
  their *own* chat messages — their words either way).
- `[cc]` — **copied from the AI chat** (text that originated in an assistant
  message).
- `[ce]` — **copied from an external source** (neither user nor AI — pasted in
  from elsewhere).
- `[ai]` — **inserted via an AI editor action** (you selected text and accepted
  an AI rewrite, expansion, simplification, or proposal).

**How it's tracked.** Provenance rides on the editor's native position mapping:
when the document changes, existing spans are moved through the same coordinate
transform the editor uses, and only genuinely *new* text is classified. New text
is classified by a **pending signal** set the instant before the change lands —
a paste, a drop, or an accepted AI action announces what it is, and absent any
signal the default is `[t]` (typed).

**Clipboard handling.** Copy/cut inside the editor captures the full
per-segment provenance of the selection, so that pasting a passage that was
itself a mix of sources **preserves that mix** rather than collapsing it to a
single tag. Pastes are classified through a priority chain — internal editor
clipboard → known AI-result text → text copied from the chat (assistant vs user)
→ external. Drag-and-drop captures provenance at the *start* of the drag (while
the selection still reflects the source) and clears the signal afterwards so a
drag that lands outside the editor can't mis-tag the next edit.

The provenance map feeds the FLOW analysis (it informs the Write pillar in
particular) and is shown in the report. It is preserved in Sylou's own data; it does **not** survive copy-pasting out of Sylou into an unrelated app, which is a limitation no writing tool we know of currently solves (see Section 8).

### 5.4 What the FLOW analysis reads

When you run an analysis, it gathers the whole project and builds one structured
prompt. Its inputs:

- **The writing, provenance-annotated** — your text with the `[t]/[cc]/[ce]/[ai]`
  tags inline, plus an aggregate character-count breakdown by origin.
- **The full chat history** across all threads, in time order, with each
  message's source flagged — including the `not assessed` writing summaries from
  5.2, and notes of which documents/web searches each message used.
- **AI editor activity** — a tally and recent log of the inline editor actions
  (see 5.5).
- **Creative-tool content** (creative projects) — world-building notes, the
  character diagram, and the timeline, formatted into the prompt; these matter
  most for the Lead and Organize pillars.
- **Imported documents** — handled by a three-tier budget so a large reference
  library can't crowd out the analysis: full text if it fits, otherwise
  summaries, otherwise an explicit note that documents were set aside (with their
  titles), so their exclusion is itself disclosed rather than silent.
- **A similarity check** — a direct text-overlap measure between your writing and
  the AI's chat messages. If a large fraction of the writing closely matches AI
  responses, the analysis is told, and the Write score is capped accordingly.
  This is a deterministic backstop that doesn't rely on the model noticing.

The chat history, the writing-summary log, and the editor-action record are
writable only by Sylou's server-side functions: a modified client cannot
fabricate these FLOW inputs by writing to the database directly.

NB: By design, the conversation memory (5.6) is **not** an input: the analysis
always reads the full, raw chat history itself, never the summarized form.

The analysis returns, for each pillar, its reasoning, cited evidence, a score (or
`null`), and a plain-language narrative, plus an overall summary and 3–5 specific
user contributions. The report also records, for disclosure, the model used, the
reasoning/thinking settings, the temperature, the similarity result, and any
sections that had to be machine-repaired or replaced with a "could not be
assessed" default during validation — a report never silently substitutes
content without flagging it in its stored metadata.

### 5.5 Editor actions, and what is *not* put in the chat

These inline editor actions — Fix grammar, Translate, Rewrite, Simplify, Expand — serve less meaningful interactions than what "Ask" and "Propose" allow, as they are bounded by the selected text. They don't produce a chat exchange and are logged to a separate record of AI editor actions, with the original text, the AI result, and whether you accepted, modified, or rejected it. They reach FLOW as activity statistics and a detailed action log rather than as chat messages, and accepted insertions also carry the `[ai]` provenance tag in your writing.

Each kind of interaction is recorded once, where it belongs: inline actions
live only in this ledger; **Propose** content lives in the chat (per 5.1),
while the ledger records just its decision — accepted, modified, rejected, or
still pending — linked to the chat exchange by timestamp; **Ask** lives only
in the chat, which is its complete record. Everything is on the record for
the analysis, and nothing is logged twice.

### 5.6 Conversation memory (coherence of long chat discussions)

On every message, the assistant re-reads only the most recent stretch of the
conversation (about 50 messages). So that long collaborations don't lose their
earlier decisions, each thread past that size gets a rolling **conversation
memory**: an AI-written summary — decisions and direction, structure and
plans, established facts and names, open threads, and a short narrative of the
work so far — regenerated (not appended) roughly every 50 messages, capped in
size, and stored with the thread. Chat replies and Ask/Propose actions then
work from this memory plus the newest messages verbatim; where the two differ,
the assistant is instructed that the verbatim messages win. The summarization
runs on the selected chat model and is billed like any other call.

Three properties: it is stored per thread in the project's
database, readable only by the account owner. Like the other AI-maintained
records, only Sylou's server-side functions can write it (a modified client
cannot plant fabricated "memory" the assistant would then trust). And FLOW
never reads it: instead the analysis reads the full raw chat history itself (5.4).

---

## 6. Disclosure and machine-readable markers

Alongside the FLOW record, Sylou discloses AI use directly to the people who
encounter it, and marks AI-generated content so it can be detected programmatically. In brief: a first-use disclaimer, a permanent "you're talking to an AI" notice by the chat and AI-action windows, clear labelling of AI messages, and `data-ai-generated` / `data-ai-model` markers on AI content in the app and in shared reports (with non-AI elements inside AI sections marked `data-ai-generated="false"`). The full treatment, mapped to EU AI Act Articles 50(1) and 50(2), is in [`docs/ai-act-position.md`](docs/ai-act-position.md)- which serves as the project's documented position, not as legal advice.

---

## 7. What a shared report exposes — and withholds

A FLOW report can be kept private or shared at a public URL. Sharing is built so
that going public never *over*-shares:

- Public reads go through a **sanitised view**, never the underlying table. The
  view only exposes reports you've explicitly shared, and some internal fields are never exposed through it at all.
- You control inclusion of the optional sections — such as your self-assessment
  feedback, and the activity replay — with per-report toggles.
- Each shared report carries the generating instance's label, version, and commit
  hash, so a viewer can identify exactly what produced it. The "official" label
  is reserved for the upstream project; self-hosted instances disclose themselves as such.

The point of a shared report is to let you *bring evidence* of your process to someone else.

---

## 8. Honest limitations

Transparency includes being clear about what these mechanisms *don't* do:

- **The FLOW assessment is a model's judgment.** It's evidence-backed and
  disclosed, but it is not infallible (see Section 4). It's one input into a transparent picture, not a final word handed down about the writer, and it is to be considered *alongside* their own self-assessment and the other information provided elsewhere in the report. 

- **The FLOW assessment analyzes the activity that happens inside Sylou**: the more of the writing process took place within the platform, the more comprehensive the assessment.

- **The assessment can be a target, and we treat its resistance as an open
  area.** Because a FLOW analysis reads the user's own writing, chat, and
  imported documents, that material can in principle contain text crafted to
  steer the result — for example, an instruction hidden in the writing telling
  the model to award a maximum "human" score, including when disguised as a
  poem, a hypothetical, or a note to the reviewer. The analysis prompt instructs
  the model to treat all such content as material to be analyzed rather than as
  instructions, to weight the objective provenance and similarity signals above
  any claim in the text, and to note manipulation attempts rather than reward
  them. We are actively testing this resistance and expect to strengthen it over
  time. It is also bounded by the point above: Sylou measures collaboration that
  takes place inside the platform, so it cannot detect work produced entirely
  outside Sylou and pasted in — a limit no in-app safeguard can remove.

- **Provenance doesn't survive leaving Sylou.** Copy your text into Word, Google
  Docs, or an email and the origin tags are gone. Per our knowledge, no widely adopted standard reliably preserves AI provenance across copy-paste between unrelated apps today.

- **The work-summary mechanism is a faithful approximation, not a transcript.**
  It records the *state and substance* of your writing at each query so
  contribution can be attributed correctly; it is not a verbatim, moment-by-
  moment recording of the document.

We'll keep this list honest and add to it as we learn more. These transparency
measures won't be silently weakened in future versions; material changes will be
noted in release notes.

---

## 9. For contributors: the transparency review

Transparency is a first-class concern in review. For **any** contribution, the submission should state whether it affects transparency, and if so how that was handled — a change that touches transparency without addressing it will not be considered until it does. When you open a PR, please note, where relevant:

- **What** the change touches (provenance, the summary mechanism, FLOW inputs,
  disclosure markers, shared-report exposure, …).
- **Why** the change preserves — or deliberately and visibly alters — the
  transparency behaviour.
- **Expected behaviour** after the change.
- **Incorrect behaviour to watch for** (e.g. an interaction that could now be
  mis-attributed, a marker that might be dropped, a field that could leak into
  the public view).

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the general contribution process,
and [`SECURITY.md`](SECURITY.md) for reporting anything that looks like a
transparency or privacy hole rather than a feature gap.

---

## Appendix — the FLOW analysis prompt

For full transparency about the assessment itself, you can find the system prompt that drives a FLOW analysis in`supabase/functions/analysis/prompts.ts`.

*Sylou is open-source software released under AGPL-3.0. The FLOW methodology is
published under CC BY-SA 4.0. This document is the project's description of how
transparency is implemented; it will be kept in step with the code, and where
they disagree the code is authoritative.*
