# Security Policy

## Supported Versions

The current public package line is `0.4.x`.

## Reporting a Vulnerability

Please open a private security advisory on GitHub if available:

https://github.com/shutovdef-dotcom/codex-chrome-bridge/security/advisories/new

If private advisories are unavailable, contact the repository maintainer privately before disclosing details.

Do not include private browser data, cookies, tokens, dashboard screenshots, or account identifiers in public issues.

## Security Model

Codex Chrome Bridge connects three local surfaces:

- A Chrome Manifest V3 extension loaded in the user's real Chrome profile.
- A local Chrome Native Messaging Host with a per-user Unix Socket.
- A CLI and MCP stdio server that send commands to the Native Messaging Host.

The extension has broad Chrome permissions because it is meant to inspect real browser tabs. The project relies on scoping and confirmation gates:

- Browser work is scoped to the `Codex Bridge` tab group by default.
- Mutating and sensitive commands require confirmation.
- High-risk values require a second sensitive confirmation.
- The Native Messaging Host is local-only by default.
- Automatic CAPTCHA bypass is intentionally out of scope.

See [docs/SAFETY.md](docs/SAFETY.md) for operational guidance.
