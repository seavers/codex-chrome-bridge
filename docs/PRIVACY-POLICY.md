# Chrome MCP Bridge Privacy Policy

Last updated: 2026-06-12

Chrome MCP Bridge is a local Chrome extension, bridge daemon, CLI, and MCP server. It is designed to run on the user's machine and communicate over loopback by default.

## What The Software Does

- Reads and interacts with Chrome tabs that the user explicitly scopes into the bridge workflow.
- Exchanges data between the Chrome extension and the local Native Messaging Host through a per-user Unix Socket.
- Writes optional local artifacts such as JSON summaries, screenshots, PDFs, and debug bundles when the user requests them.

## Data Handling

- The project does not include built-in analytics.
- No analytics or remote telemetry are enabled by default.
- In plain terms: no analytics are sent to a hosted Chrome MCP Bridge service by default.
- The project does not send browsing data to a hosted Chrome MCP Bridge service because none exists in the default product.
- The default bridge bind is loopback-only.
- The extension and bridge communicate over local loopback by default.
- Metadata-first commands keep large or sensitive page content in local files when possible instead of printing it to stdout.

## Permissions

The extension requests broad Chrome permissions because it works against the user's real browser profile, including scoped tab management, debugger-backed interactions, browser data queries, and local page inspection.

## User Control

- Mutating browser actions require explicit confirmation.
- Private browser-data reads require additional confirmation.
- Users can remove the extension, stop the bridge server, or delete local output artifacts at any time.

## Retention

Chrome MCP Bridge does not include a remote storage backend. Data remains in the local Chrome profile, local bridge process memory, or local artifact files chosen by the user.

## Contact

For project questions, use the repository support and security channels documented in `SUPPORT.md` and `SECURITY.md`.
