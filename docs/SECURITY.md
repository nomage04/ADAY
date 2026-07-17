# Security policy

## Supported versions

Security fixes are applied to the latest commit on `main`. Development snapshots on `dev` are not considered stable releases.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository:

<https://github.com/nomage04/ADAY/security/advisories/new>

Include a concise description, affected component, reproduction steps, impact and any suggested mitigation. Remove API keys, personal data and private presentations from the report.

You should receive an acknowledgement within seven days. The maintainer will investigate, coordinate a fix and credit reporters who want attribution. Please allow a reasonable remediation window before public disclosure.

## Security model

ADAY is intended for loopback-only use. Do not expose its server to a network. API keys can be stored in plain text only when the user explicitly enables `config/config.local.js`; runtime data and backups may contain sensitive presentation content and must be protected separately.
