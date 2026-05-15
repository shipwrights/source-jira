# Security Policy

## Supported versions

We actively maintain the latest minor release line. Bug-fix releases land against the latest minor as patch versions.

| Version | Supported |
|---|---|
| 0.5.x   | yes |
| 0.4.x   | best-effort backport for critical issues |
| < 0.4   | no |

## Reporting a vulnerability

**Please don't open public issues for security problems.**

Use either of these private channels:

1. **GitHub Private Vulnerability Reporting** (preferred)
   On the repo, open the **Security** tab → **Report a vulnerability**. This routes directly to the maintainer with full GitHub auditing.

2. **Email**
   `solomon.aboagye@amalitech.com` — include "source-jira security" in the subject so it doesn't get lost.

Please include in your report:

- A description of the issue and the impact you observed.
- Steps to reproduce (minimal config, command, expected vs actual). Use a throwaway Jira tenant or scrub real credentials.
- The version of `@shipwrights/source-jira` you tested against.
- Any proof-of-concept code, screenshots, or logs (with secrets masked).

## What to expect

- **Acknowledgement**: within 3 business days.
- **Initial assessment**: within 7 business days — we'll tell you whether we consider it a security issue, our severity rating, and our planned next step.
- **Fix and release**: severity-dependent. Critical issues get a patch release within ~7 days; lower-severity issues land in the next normal release.
- **Coordinated disclosure**: we'll work with you on disclosure timing. The default is "fix shipped + 7 days" before public disclosure.
- **Credit**: with your permission, we'll credit you in the release notes.

## Out of scope

The package is a Jira API client + setup wizard. Issues that arise from:

- The user's own `.shipwrights/jira.json` or `.env.local` (e.g., committing a token by accident — that's a workflow problem on the user's side)
- Vulnerabilities in Atlassian Jira itself (report to Atlassian)
- The orchestrator running on a compromised host
- The user's choice of where to store the API token (we recommend `.env.local`; alternatives are the user's call)

…are not vulnerabilities in this project, but we'll still acknowledge the report and help where we can.
