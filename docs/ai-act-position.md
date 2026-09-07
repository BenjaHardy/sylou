# Sylou and the EU AI Act

**Version 1.0 — 01 June 2026**

## Why this document exists

Sylou is built around being transparent about human-AI collaboration in writing. The EU AI Act asks for some specific things on AI transparency: disclosing when users interact with AI (Article 50(1)) and marking AI-generated content as such (Article 50(2)). This document describes what Sylou does about those two requirements, so anyone reading the code, deploying the project, or asking questions can see how it's handled.

It's the project's documented position. It's not legal advice, and it doesn't relieve self-hosters or operators of their own responsibilities.

## What's covered

- Article 50(1) — informing users that they're interacting with AI
- Article 50(2) — marking AI-generated content as artificially generated

Other parts of the AI Act (deepfake disclosure, public-interest text, risk classification of high-risk systems) aren't in scope, Sylou doesn't do any of those things.

## Article 50(1) — disclosing AI interaction

Users need to know they're interacting with AI. Sylou handles this in three places:

**A first-use disclaimer.** When you first log into Sylou, a modal appears that you have to acknowledge before using the app. It says Sylou is AI-powered, AI outputs can be wrong, and you're responsible for verifying what you use. The acknowledgment is remembered; the disclaimer is re-shown if the text materially changes. You can re-read it any time from the About menu.

**A persistent reminder in the chat.** Below the chat input, a small notice is always visible: *"You're chatting with an AI assistant. AI responses may be incorrect, verify what matters."* It can't be dismissed.
The same applies to the AI Actions window that is displayed from text selection ("Interact with AI"), which displays the same notice.

**Clear labelling on AI messages.** Each AI message in the chat shows "AI Assistant" next to its avatar, so it's obvious which messages came from the AI even if you scroll back later.

## Article 50(2) — marking AI-generated content

AI-generated content needs to be detectable as such, in a machine-readable way. Sylou does this on its main AI-generating surfaces:

**AI chat messages** carry `data-ai-generated="true"` and `data-ai-model` attributes in the rendered HTML. The JSON export of chat threads preserves AI origin through the following standard fields: look for `role` "assistant" as well as `model_used`.
AI editor actions that are not displayed in the chat (Fix Grammar, Translate, Rewrite, Simplify, Expand) are also logged into the JSON export as `ai_response`.

**Shared FLOW reports** carry `<meta>` tags at the document level identifying the page as containing AI-generated content and naming the model. The AI-generated sections (the radar chart, scores, summary, key contributions on the Report tab; the AI-selected collaboration style on the FLOW Collaboration Style tab) are wrapped in `<section>` elements with `data-ai-generated="true"`, `data-ai-model`, and accessibility labels.

**Human-authored content is not marked.** The user's writing, self-assessment, post-its, or replay of their own activity carry no AI-generated markers. Where a non-AI element sits inside an AI-marked section (notably the public-domain artworks in the FLOW Collaboration Style), it carries an explicit `data-ai-generated="false"` marker.

**Editor provenance.** Sylou's editor tracks the origin of every paragraph through provenance tags: `[t]` typed by the user, `[cc]` copied from chat, `[ce]` copied from elsewhere, `[ai]` inserted via AI tools. This is preserved in Sylou's data and shown in the FLOW report.

### One known limitation

When content is copied out of Sylou into another app (such as Word, Google Docs or an email) the AI-origin information doesn't survive. This is true of every writing tool we know of, and to the best of our knowledge no widely adopted standard reliably preserves AI provenance across copy-paste between unrelated applications today. Within Sylou's own json exports and Sylou itself, provenance is preserved (which is the point of the sharable FLOW reports).

## Self-hosters: this is on you too

Sylou is open-source and self-hostable. If you self-host Sylou and let other users access it, you become the operator of that instance. Depending on how you deploy and who uses it, you may have your own obligations under the AI Act, separately from the Sylou project.

A few practical notes:

- The transparency mechanisms described above are built into the code. Please don't remove them in your deployment, weakening them likely weakens your own position under the Act.
- Customise the disclaimer and any user-facing legal text to match your actual setup and needs (your data handling, your LLM provider, your terms).
- If you're operating at any scale, get your own legal advice, this document isn't a substitute.

## Updates

We'll update this document if the relevant rules change, if Sylou's transparency features evolve, or if we learn we've got something wrong. The current version is always in the repo.

The transparency measures described here won't be silently removed in future versions. Material changes will be noted in release notes and in updates to this document.

## Got feedback?

If you think something here is off, missing, or worth discussing, open an issue or email [contact@sylou.eu].

---

*Sylou is open-source software released under AGPL-3.0. The FLOW methodology is published under CC BY-SA 4.0.*
