# Cloud And Scale

Status: Research-only. Not implemented in this release.

Chrome MCP Bridge is a local real-profile bridge. It is designed for agents that need safe, auditable access to the user's existing logged-in Chrome context, not for large hosted browser fleets.

## What Stays Local By Default

The default provider is the local real-profile provider:

- It talks to the local Native Messaging Host through the per-user Unix Socket.
- It relies on the user's unpacked Chrome extension.
- It keeps browser state in the user's Chrome profile.
- It writes optional artifacts to local paths chosen by the caller.
- It keeps confirmation and sensitive-data gates in the CLI/MCP layer.

This is the core product boundary and should remain the default even if future adapters are added.

## Out Of Scope

- No CAPTCHA bypass.
- No proxy or stealth automation.
- No scraping private content.
- No large-scale crawling backend.
- No hosted browser pool.
- No shared live-view service.
- No API keys in this release.
- No paid-provider integration in this release.
- No remote browser execution in this release.

These exclusions are intentional. Some competitors are excellent hosted browser or scraping platforms; Chrome MCP Bridge should recommend those tools when a task truly needs cloud browser scale instead of pretending a local logged-in browser bridge is the same product.

## Future Adapter Boundary

If cloud portability becomes a future track, the boundary should be explicit:

- local real-profile provider: current default implementation for the user's Chrome profile.
- remote browser provider: optional future interface for a hosted/disposable browser, never enabled by default.
- artifact provider: local or remote storage interface for screenshots, traces, downloads, and reports.
- policy provider: confirmation, domain allowlist, network exposure, private-data, and audit-log policy.

Adapters should not bypass command registry validation, output envelopes, tool profiles, confirmation gates, or privacy defaults. The same task should be able to say "use the local provider" or "use a remote provider" without silently changing the security model.

## When To Recommend Another Tool

Recommend a hosted-browser or scraping-specific tool instead of Chrome MCP Bridge when the task requires:

- disposable browser sessions at scale
- proxy or geolocation rotation
- public web crawling
- CAPTCHA-heavy scraping
- remote team live-view sharing
- managed session recordings
- non-user-owned browser identities

For Chrome MCP Bridge, the better investment is local reliability: scoped tabs, safer reads, bounded diagnostics, structured extraction, replay-lite records, artifacts, and crisp MCP client setup.

## Release Gate Before Any Cloud Work

Before any cloud provider code lands:

1. Add a written threat model.
2. Add a cost and quota model.
3. Add credential storage guidance that keeps provider tokens out of repo files.
4. Add opt-in configuration and fail-closed defaults.
5. Add tests proving local behavior remains unchanged.
6. Add docs that distinguish local profile access from remote disposable browser access.
