# Transparency in Sylou

This document aims to explain how AI-use transparency works in Sylou, and is intended for anyone willing to contribute to it or to understand how reports are generated.

---

## 1. Transparency over efficiency as a key principle

Sylou exists to let a writer proactively demonstrate how they have worked with AI by looking into the interactions with the AI and the processes of writing, and as such is built with both *transparency* and *efficiency* in mind. The two criteria can at times be conflicting and lead to tension, with real trade-off to make, though ultimately transparency should prevail.

Section 5 describes some of the implications of the above and how it's approached by Sylou. 

---

## 2. The FLOW methodology

The FLOW methodology, used to describe the user-AI interactions for a piece of writing, breaks the
work into four different pillars (aimed to reflect the intellectual processes that any substantial writing
passes through) and scores the human–AI contribution to each one separately.

The pillars are as follows:

- **F — Find** *(Research & Critical Thinking)*: you research it. Gathering the
  relevant material, testing claims, comparing sources and alternatives, and
  questioning what the AI offers rather than taking it at face value.
- **L — Lead** *(Ideas & Opinions)*: you form your own view of it: the ideas, positions, and perspectives the work will
  advance. This is authorship of *thought*, as distinct from authorship of *text*.
- **O — Organize** *(Structure & Argumentation)*: you structure it. Arranging
  those ideas into an order, building the argument or narrative, and shaping the
  logical progression that carries a reader from start to finish.
- **W — Write** *(Writing & Text Production)*: you write it. Rendering the
  structured ideas into finished prose: tone, style, clarity, sentence-level
  craft, transitions, and final drafting.

This order reflects a natural progression, which is where the name comes from:
you research before you can form a considered view, you need a view before you
have something to structure, and you structure before the prose can carry it.
Each pillar feeds the next. 

But the flow is obviously a *logic* and not a rigid sequence, and in practice the stages loop.
Drafting (Write) exposes a gap in the argument (Organize); building the argument
reveals a claim you can't support and sends you back to research (Find);
research changes your mind (Lead). The framework describes how intellectual work
*moves*, which is also why strong human work usually shows high human contribution spread across more than one pillar rather than concentrated in one.

Each pillar is scored independently from 0.0 to 5.0 in half-point increments, or
`null` where there isn't enough evidence to judge. The four scores together also
map to one of **16 collaboration-style codes** (a four-letter code, one letter per
pillar above a threshold; see Section 3). This collaboration style is a convenience on top of the scores, and it's not a
separate judgment.

The FLOW methodology is open-source, published under [**CC BY-SA 4.0**](https://github.com/BenjaHardy/sylou/blob/main/LICENSE-METHODOLOGY).

---

## 3. The scale and the calibration anchors

### 3.1 *NOT* a grade

The scale is **not a mark out of five**. 5.0 is not "good", 0.0 is not "bad". The number simply describes
where a contribution sits on a spectrum from AI-led to human-authored; all then depends on context. A piece can be excellent and score low on Write (you had the AI draft the
prose), and depending on context it can be a legitimate way to work. Or vice-versa. FLOW simply reports a description.

The reference points the model is calibrated against are as follows:

| Score | Label                  | Meaning                                                                 |
| ----- | ---------------------- | ----------------------------------------------------------------------- |
| 5.0   | Human-authored         | Produced entirely independently of the AI.                              |
| 4.0   | Human-led              | The user originated the core, the AI gave minor support.                     |
| 3.0   | Human-led, AI-assisted | The user drove it, with the AI making notable supporting contributions.             |
| 2.0   | Collaborative          | Genuine two-way work, neither side clearly dominating.                   |
| 1.0   | AI-led, human-refined  | The AI produced most of it, the user refined.                                |
| 0.0   | AI-led                 | No meaningful human contribution beyond basic instruction.              |
| null  | Insufficient evidence  | Not enough data to assess this pillar. Used instead of defaulting to 0. |

(For display, Sylou groups scores into descriptive *bands* and always shows the
band label rather than the bare number, in order to further evidence that it is not intended to be a grade.)

### 3.2 The asymmetricity of the relationship

Human-AI interactions in Sylou are assymetric by nature: the user prompts, the
AI responds, meaning that the user is always the initiator and the AI always the responder.
There is no mode in which the AI sets out on its own; no self-initiating, agentic AI.

This makes it difficult to build out the scale as a true mirror in which each human-led
anchor can be simply flipped into an AI-led equivalent, and the calibration anchors (fully defined in the FLOW prompt) reflect this.

### 3.3 The top of the scale

At first sight the calibration looks unbalanced, from 0.0 (AI-led) up to 4.0
(Human-led) and then 5.0 (Human-authored), with no equivalent "fully AI" pole at the bottom.

Indeed, a pillar never originates without human instruction, and there is no "AI-authored" pillar in the sense that 5.0 is
"Human-authored", also confirmed through our testing runs (the rating models avoided to assign a pure-AI origin to a pillar).

So it helps to read the scale as a collaborative gradient centred on 2.0, with one extra human-only pole appended:

```
   (no AI mirror)   0.0 ── 1.0 ── 2.0 ── 3.0 ── 4.0      5.0
                  AI-led         Collab.        Human-led   Human-authored
                     └─── equivalence around 2.0 ───┘     └─ human-only pole
```

---

## 4. AI involvement in the assessment; where it stops

A FLOW analysis reads a large amount of material: the full writing, its
provenance, every chat thread, the AI interactions, the creative-tool content,
eventually the imported documents. These are used to produce a structured output about contribution.
LLMs are well suited to absorb and summarise large bodies of text, and to reason about patterns across them. 

But it remains a qualitative analysis, and the assessment's place needs to be appropriately balanced:

- **It complements the user's self-assessment and other data.** The FLOW analysis sits
  alongside the user's own self-assessment (which can be recorded both before
  and after the analysis), the quantitative activity data of the project, and the provenance
  record; thus reflecting one input into a transparent picture, out of several.

- **Evidence-led.** Every pillar comes with the model's written reasoning and several cited pieces of
  evidence. In our experience the analytical narrative is more valuable than the label itself. A reader can check the reasoning against the work.

- **Importance of the model chosen for the analysis.** Some models are markedly better at this
  task than others, and Sylou discloses in each FLOW report which model was used for the analysis. We assess candidate models
  on two criteria (tested against different edge cases scenarios):
  
  - **Accuracy**: does the assessment match what actually happened in the work?
  - **Repeatability**: does the same project score consistently across runs?
  
  For labels we expect *small* variations between runs (at most a shift to an
  immediately adjacent band on a pillar, not a swing across the scale). Large
  swings are a signal that a model isn't suitable for the FLOW analysis. Current
  recommendations and the rationale behind them live in
  [`docs/model-configuration.md`](docs/model-configuration.md).

If you've tested models on FLOW and want to share findings, see
[`CONTRIBUTING.md`](CONTRIBUTING.md): this is an area where real-world data genuinely helps.

---

## 5. How transparency is built into the architecture

### 5.1 Idea misallocation and the work-summary mechanism (the "context prompts")

Sylou intends to be a modern text environment, and thus it allows the AI to get context of the contents of the work (and creative tools if available) in order to reply effectively to user prompts. This only happens at the user's discretion; in practice this occurs when the user uses the "Ask" and "Propose" functionalities from the dedicated window that appears upon text selection.

When the user selects text in the editor and asks the AI about it ("Ask") or asks it to act upon it ("Propose"), the AI needs to get information about the whole contents of the writing to give a useful
answer. But given that the FLOW analysis later reads the chat log, if the latter contains only the user's prompt and the AI's response (and **not** the state of the writing at
that moment) then any idea from the user found in the writing that the AI repeats back, builds on, or quotes can look, to the analysis, like it originated with the AI. This **idea misallocation** would systematically under-credit the writer.

Logging the full writing into the chat on every such prompt would be transparent but would blow up the context and token cost of
every later analysis. Logging nothing keeps things cheap but causes the misallocation above. To solve this, Sylou operates a sequential, two-call
design:

1. **First call: produce a work summary.** Before answering, the AI generates a
   *relevant summary* of the current writing (and, for creative projects, the
   creative tools), scoped to what's needed to answer the user's specific request.
2. **Second call: answer the request** using that summary plus the usual chat
   context.

The summary is then **timestamped and logged into the chat, flagged as
"writing summary (not assessed)"**. That flag essentially tells the FLOW
analysis that this content reflects the state of the writing at this moment:
to be treated as context and not as either party's contribution. The analysis is
explicitly instructed that ideas and contributions appearing for the first time in a summary is normally the user's, unless it came from an external source (indeed, AI contributions would already be logged in the chat and would not appear there for the first time). So the writing's state at the time of the query is on the record, the AI's later comments can't be mistaken for original AI ideas, and the full writing isn't duplicated into every analysis.

The summary is written to two places:

- **In a separate `writing_summary_log`** (deliberately withheld from FLOW):
  the full, evolving summary is stored so the *next* request's first call can
  diff against it and append only what's changed, rather than rewriting the
  whole summary each time. This running log is an efficiency device for the
  summariser; it never enters the analysis, because feeding the full accumulated
  summary into FLOW with each interaction would introduce unnecessary duplications.
- **In the chat** (fed to FLOW): only the *delta* (the new lines the summary
  added this turn) is logged, flagged `not assessed`. Logging only the delta
  avoids re-stating, on every prompt, summary content already visible earlier in
  the conversation.

### 5.2 Provenance tagging as supporting data

Sylou tracks the origin of every span of text in the editor and stores it as a provenance map. Four tags are used:

- `[t]` — **typed** by the user (this also covers text the user copied from
  their *own* chat messages).
- `[cc]` — **copied from the AI chat** (text that originated in an assistant
  message).
- `[ce]` — **copied from an external source** (neither user nor AI; pasted in
  from elsewhere).
- `[ai]` — **inserted via an AI editor action** (when the user selected text and accepted
  an AI rewrite, expansion, simplification, or proposal).

Copy/cut and other clipboard operations inside the editor capture the full per-segment provenance of the selection, so that pasting a passage that was
itself a mix of sources preserves that mix.
This provenance map is ultimately used as an extra signal alongside the rest that feeds into the FLOW analysis (mostly for the Write pillar) and is shown in the report. It is preserved in Sylou's own data; it does not survive copy-pasting out of Sylou into an unrelated app (see Section 8).

### 5.3 FLOW analysis inputs

The FLOW analysis gathers the whole project and builds one structured prompt. Its inputs:

- **The provenance-annotated writing**: the user's text with the `[t]/[cc]/[ce]/[ai]`
  tags inline, plus an aggregate character-count breakdown by origin.
- **The full chat history** across all threads, in time order, with each
  message's source flagged (including the `not assessed` writing summaries from
  5.1, and notes of which documents/web searches each message used).
- **AI editor activity**: a tally and recent log of the inline editor actions
  (see 5.4).
- **Creative-tool content** (creative projects): world-building notes, the
  character diagram, and the timeline, formatted into the prompt; these matter
  most for the Lead and Organize pillars.
- **Imported documents**: handled by a three-tier budget so a large reference
  library can't crowd out the analysis: full text if it fits, otherwise
  summaries, otherwise an explicit note that documents were set aside (with their
  titles).
- **A similarity check**: a direct text-overlap measure between your writing and
  the AI's chat messages. If a large fraction of the writing closely matches AI
  responses, the analysis is told, and the Write score is capped accordingly.
  This is a deterministic backstop that doesn't rely on the model noticing.

The chat history, the writing-summary log, and the editor-action record are
writable only by Sylou's server-side functions: a modified client cannot
fabricate these FLOW inputs by writing to the database directly.

NB: By design, the conversation memory (5.5) is **not** an input: the analysis
always reads the full, raw chat history itself, never the summarized form.

The analysis returns, for each pillar, its reasoning, cited evidence, a score (or
`null`) used to assignate a label, and a plain-language narrative, plus an overall summary and 3–5 specific
user contributions. The report also records, for disclosure, the model used, the
reasoning/thinking settings, the temperature, the similarity result, and any
sections that had to be machine-repaired or replaced with a "could not be
assessed" default during validation.

### 5.4 Editor actions

These simple inline editor actions (Fix grammar, Translate, Rewrite, Simplify, Expand) serve less meaningful interactions than what "Ask" and "Propose" allow, as they are bounded by the selected text. They don't produce a chat exchange and are logged to a separate record of AI editor actions, with the original text and its provenance data, the AI result, and whether the user accepted, modified, or rejected it. They reach FLOW through activity statistics and an action log, and accepted insertions also carry the `[ai]` provenance tag in the writing.

### 5.5 Conversation memory (coherence of long chat discussions)

On every message, the assistant re-reads only the most recent stretch of the
conversation (between 20 and 70 messages, see below). To avoid long
collaborations losing their earlier decisions, each thread past 50 messages
gets a rolling **conversation memory**: an AI-written summary (decisions and
direction, structure and plans, established facts and names, open threads, and
a short narrative of the work so far) regenerated (not appended) roughly every
50 messages, capped in size, and stored with the thread. Chat replies and
Ask/Propose actions then work from this memory plus the newest messages
verbatim: the last 20 messages the memory already covers, and everything
written since. The summarization runs on the selected chat model and is billed
like any other call.

Chat requests also use the model providers' prompt caching: the provider keeps
the processed beginning of a prompt for a few minutes, so that the next request
in a lively exchange re-reads it at a fraction of the price. This changes
nothing in what the model sees or answers, and nothing is stored beyond the
provider's short-lived cache (details in `docs/model-configuration.md`).

It is stored per thread, and FLOW never reads it: instead the analysis reads the full raw chat history itself (5.3).

---

## 6. Disclosure and machine-readable markers

Alongside the FLOW record, Sylou discloses AI use directly to the people who
encounter it, and marks AI-generated content so it can be detected programmatically. In brief: a first-use disclaimer, a permanent "you're talking to an AI" notice by the chat and AI-action windows, clear labelling of AI messages, and `data-ai-generated` / `data-ai-model` markers on AI content in shared reports (with non-AI elements inside AI sections marked `data-ai-generated="false"`). The full treatment, mapped to EU AI Act Articles 50(1) and 50(2), is in [`docs/ai-act-position.md`](docs/ai-act-position.md).

---

## 7. Shared FLOW reports

A FLOW report can be kept private or shared at a public URL. Each shared report carries the generating instance's label, version, and commit hash, so a viewer can identify what produced it. These variables are declared by the operator, and ultimately only the domain serving a shared report can be verified by a viewer: a report is as trustworthy as that domain's operator.

---

## 8. Limitations

Below are Sylou's known limitations:

- **The FLOW assessment relies on LLMs.** It's evidence-backed and disclosed, but it is not infallible (see Section 4). It's one input into a transparent picture, and it's to be considered *alongside* the user's own self-assessment and the other information provided elsewhere in the report. 

- **The FLOW assessment analyzes the activity that happens inside Sylou**: the more of the writing process took place within the platform, the more comprehensive and accurate the assessment.

- **The assessment can be a target.** Because a FLOW analysis reads the user's own writing, chat, and
  imported documents, that material can in principle contain text crafted to
  steer the result. The analysis prompt instructs the model to treat all such content as material to be analyzed rather than as
  instructions, to weight the objective provenance and similarity signals above
  any claim in the text, and to note manipulation attempts rather than reward
  them. 

- **Provenance doesn't survive leaving Sylou.** Copy your text into Word, Google
  Docs, or an email and the origin tags are gone. 

- **The work-summary mechanism (5.1) is not a transcript.**
  It records the *state and substance* of the user's writing at each query so
  contributions can be attributed correctly, and is not a moment-by-
  moment recording of the document (see 5.1 for details and rationale).

We'll update this list as and where appropriate; material changes will be noted in release notes.

---

## 9. For contributors: the transparency review

Transparency is a first-class concern in review. For **any** contribution, the submission should state whether it affects transparency, and if so how that was handled: a change that touches transparency without addressing it will not be considered. When you open a PR, please note, where relevant:

- **What** the change touches (provenance, the summary mechanism, FLOW inputs,
  disclosure markers, shared-report exposure, …).
- **Why** the change preserves, or deliberately and visibly alters, the
  transparency behaviour.
- **Expected behaviour** after the change.
- **Incorrect behaviour to watch for** (e.g. an interaction that could now be
  mis-attributed, a marker that might be dropped, etc.).

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the general contribution process, and [`SECURITY.md`](SECURITY.md) where applicable.

---

## Appendix: the FLOW analysis prompt

For full transparency about the assessment itself, you can find where the FLOW prompt and the methodology live in the code with [LICENSING.md](LICENSING.md).

*Sylou is open-source software released under AGPL-3.0. The FLOW methodology is
published under CC BY-SA 4.0. This document is the project's description of how
transparency is implemented; it will be kept in step with the code, and where
they disagree the code is authoritative.*
