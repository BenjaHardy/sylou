# Security Policy

Thank you for taking the time to help keep Sylou secure.

If you have found a security vulnerability in Sylou - anything that could allow an attacker to compromise user data, bypass authentication, exfiltrate writing content or chat history, manipulate FLOW reports, or otherwise harm users - please report it privately rather than opening a public issue. This gives the maintainer a chance to fix the vulnerability before it's known to potential attackers, which is in everyone's interest.

## How to report

Email **security@sylou.eu** with as much detail as you can reasonably provide:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof-of-concept if you have one
- The Sylou version, instance type (official or self-hosted), and any relevant environment details
- Your name or handle for attribution (optional; anonymous reports are also welcome)

If the vulnerability is sensitive enough that email feels inappropriate, mention this in a short initial message and we'll agree on a more secure channel for the details.

## What to expect

Sylou is a solo-maintained open-source project, so response times are best-effort rather than service-level guaranteed. That said, the rough commitments are:

- **Acknowledgment**: within one week of your report, usually sooner
- **Initial assessment**: within two weeks, whether the report is confirmed, needs more information, or is out of scope
- **Fix and disclosure**: timeline depends on severity. Critical vulnerabilities (remote code execution, authentication bypass, mass data exposure) are prioritized over lower-severity issues. Most issues should be resolved within 30–90 days of confirmation, sometimes faster.

You'll be kept informed at each step. If a fix is going to take significantly longer than expected, you'll hear why.

## Disclosure

Once a fix is ready, it's shipped as a tagged release with release notes that flag the security fix without necessarily detailing the exploit. 

After a grace period - defaulting to about two weeks, adjusted for severity - a full security advisory is published with the technical details and credit to the reporter (with your permission and under whatever name or handle you prefer). 

The grace period gives self-hosters time to update before exploit details are public; the more severe the issue, the more carefully this window is managed (sometimes shorter to prompt urgent updates, sometimes coordinated with reporters).

If you'd prefer not to be credited, just say so in your report. Anonymous reports get the same handling as named ones.

## What's in scope

Vulnerabilities in:

- The Sylou source code (frontend and Edge Functions)
- The FLOW Pledge Badge generation and verification flow
- The shared-report and replay mechanisms
- The provenance-capture architecture (the integrity of the [t]/[cc]/[ce]/[ai] tagging)
- The authentication, authorization, and session-handling code paths

## What's typically out of scope

- Vulnerabilities in third-party dependencies that haven't yet been patched upstream (please report these to the upstream project; the Sylou patch will follow upstream)
- Issues that require physical access to a user's device
- Self-XSS that requires the user to paste attacker-supplied code into their own browser console
- Theoretical issues without a demonstrable impact on user data, integrity, or availability
- Issues in self-hosted instances that arise from operator misconfiguration rather than from Sylou itself (these are still worth flagging, but they're operator issues rather than project issues)
- Denial-of-service attacks against the official Sylou instance via volumetric or resource-exhaustion means (these are infrastructure-level concerns, not source-level vulnerabilities)
- Methodology disagreements about FLOW scoring (these are methodology contributions, not security issues — see CONTRIBUTING.md -> #methodology-contributions)

If you're not sure whether something is in scope, err on the side of reporting. A quick triage email is much better than an unreported vulnerability.

## Safe harbor for good-faith research

If you're researching Sylou's security in good faith — finding vulnerabilities to report them, not to exploit them — the project commits to:

- Not pursuing legal action against you for your research, provided you act in good faith
- Not asking you to delete or destroy research findings (you can keep records of what you found)
- Working with you to understand and resolve the issue

In return, please:

- Test only against your own self-hosted instance, using only your own account and content. Please don't probe the maintainer's instance at sylou.eu: it isn't a public service and it holds the maintainer's own content. Since Sylou is open-source and self-hostable, standing up your own instance to test against is straightforward.
- Don't access, modify, or exfiltrate other users' data
- Don't run automated scans or fuzzing that could affect availability for other users
- Don't publicly disclose the vulnerability before it's been resolved and disclosed by the project
- Give the project a reasonable opportunity to respond before going public

This isn't a formal bug bounty program (there's no monetary reward) but good-faith security research is genuinely appreciated and will be acknowledged.

## Questions

If anything above is unclear, or you're not sure how to handle a specific situation, email **security@sylou.eu** and ask. Better an extra email than an unreported vulnerability.

Thank you for helping keep Sylou and its users safe.
