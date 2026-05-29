/**
 * Shared content for the legal disclaimer, first-time welcome, and About dialogs.
 *
 * VERSION-BUMP GUIDANCE
 * ---------------------
 * The localStorage keys used to gate these surfaces are versioned:
 *   - sylou.disclaimer.acknowledged.v1
 *   - sylou.welcome.shown.v1
 *
 * Bump the version suffix (v1 → v2) in BOTH the key constants below and in
 * any reading site ONLY when the copy in DisclaimerBody or WelcomeBody changes
 * MATERIALLY — i.e. legal substance, scope of commitments, data-handling
 * statements, or the meaning users are acknowledging.
 *
 * Do NOT bump for typos, wording polish, formatting tweaks, link updates, or
 * other non-substantive edits. Re-prompting users for trivial changes erodes
 * the signal value of the acknowledgement.
 */

export const MEETSYLOU_URL = "https://www.meetsylou.eu";

export const DISCLAIMER_ACK_KEY = "sylou.disclaimer.acknowledged.v1";
export const WELCOME_SHOWN_KEY = "sylou.welcome.shown.v1";

export function DisclaimerBody() {
  return (
    <div className="space-y-4 text-sm text-foreground/90 leading-relaxed">
      <p>
        Sylou is open-source software that helps you write with AI assistance while keeping the
        human-AI collaboration visible. Before using it, please understand the following:
      </p>

      <section className="space-y-1">
        <h3 className="font-semibold text-foreground">About AI outputs.</h3>
        <p>
          Sylou relies on Large Language Models (LLMs) to assist your writing and to analyze your
          work. Like all LLMs, they can produce incorrect, biased, or misleading information. You
          are responsible for verifying outputs and for how you use them.
        </p>
      </section>

      <section className="space-y-1">
        <h3 className="font-semibold text-foreground">About this instance and your data.</h3>
        <p>
          Sylou is designed to be self-hosted. This instance is operated by whoever deployed it;
          they alone control the infrastructure where your data is stored and they are responsible
          for how it is handled. The Sylou project itself does not run a service for users and has
          no access to anything you write here. The Sylou code makes specific commitments: no
          telemetry, no third-party data sharing beyond the necessary call to the LLM provider, no
          analytics. These are verifiable in the open-source repository.
        </p>
      </section>

      <section className="space-y-1">
        <h3 className="font-semibold text-foreground">About LLM providers.</h3>
        <p>
          This instance uses LLM APIs configured by the operator. When you send a message that
          involves an LLM, the contents of that message reach the LLM provider, who handles it
          under their own terms and privacy policy. Sylou does not control what the LLM provider
          does with that data.
        </p>
      </section>

      <section className="space-y-1">
        <h3 className="font-semibold text-foreground">About the software.</h3>
        <p>
          Sylou is in active development. Features may change, bugs may exist, and you should keep
          your own backups of important work. Sylou is provided as-is, without warranty of any
          kind, under the terms of the AGPL-3.0 license.
        </p>
      </section>
    </div>
  );
}

export function WelcomeBody() {
  return (
    <div className="space-y-4 text-sm text-foreground/90 leading-relaxed">
      <p>
        Sylou is an open-source text editor designed to make human-AI collaboration in writing
        visible. It combines an AI-powered writing environment with a structured analysis framework,
        FLOW, that maps how AI assistance and human work fit together across the writing process.
      </p>

      <div className="space-y-1">
        <p className="font-semibold text-foreground">The four FLOW pillars are:</p>
        <ul className="space-y-1 pl-1">
          <li><span className="font-semibold text-foreground">F — Find:</span> research and critical thinking (research it)</li>
          <li><span className="font-semibold text-foreground">L — Lead:</span> ideas and opinion (form ideas about it)</li>
          <li><span className="font-semibold text-foreground">O — Organize:</span> structure and argumentation (structure it)</li>
          <li><span className="font-semibold text-foreground">W — Write:</span> writing and authorship (write it)</li>
        </ul>
      </div>

      <p>
        Each pillar is analyzed independently, producing a FLOW report and work profile that you can
        share, export, and use to communicate how a piece of writing was actually produced; these
        come together with further evidence and reports which, when taken together, aim to
        provide further assurance of human contribution to external users.
      </p>

      <p>
        Sylou is open-source under AGPL-3.0, with the FLOW methodology published separately under
        CC BY-SA 4.0. The source code can be inspected, modified, and self-hosted by anyone. Learn
        more at{" "}
        <a
          href={MEETSYLOU_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          meetsylou.eu
        </a>
        .
      </p>

      <section className="space-y-1">
        <p className="font-semibold text-foreground">We'd love your feedback.</p>
        <p>
          Sylou is a work in progress, and we hope it contributes to AI-use transparency,
          responsibility, and education. If you have thoughts, ideas, or suggestions:
        </p>
        <ul className="space-y-1 pl-1">
          <li>
            email us at{" "}
            <a
              href="mailto:contact@sylou.eu"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              contact@sylou.eu
            </a>
          </li>
          <li>
            join the conversation on GitHub
          </li>
          <li>
            fill in the short survey at{" "}
            <a
              href={MEETSYLOU_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              meetsylou.eu
            </a>
            : it genuinely helps us shape what comes next.
          </li>
        </ul>
      </section>

      <p className="text-xs text-muted-foreground pt-2 border-t border-border">
        Dismiss this welcome at any time. You can revisit the project documentation from the About
        menu.
      </p>
    </div>
  );
}
