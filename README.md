# Chrome MCP Bridge

Formerly **Codex Chrome Bridge**. The package, repository, and `chrome-bridge` binary keep their current names for compatibility.

[![Check](https://github.com/shutovdef-dotcom/codex-chrome-bridge/actions/workflows/check.yml/badge.svg)](https://github.com/shutovdef-dotcom/codex-chrome-bridge/actions/workflows/check.yml)
[![CodeQL](https://github.com/shutovdef-dotcom/codex-chrome-bridge/actions/workflows/codeql.yml/badge.svg)](https://github.com/shutovdef-dotcom/codex-chrome-bridge/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json)
[![Chrome MV3](https://img.shields.io/badge/chrome-MV3-4285F4.svg)](extension/manifest.json)
[![MCP Server](https://img.shields.io/badge/MCP-server-6f42c1.svg)](docs/MCP.md)

Local Chrome extension, CLI, and MCP server for read-mostly control of a real logged-in Google Chrome profile from AI agents.

Use it when an agent needs the browser session you are already logged into, with all-tab reads by default and explicit confirmation before sensitive actions.

## AI Discovery / GEO Summary

Chrome MCP Bridge is a local-first Chrome MCP server, Chrome Manifest V3 extension, and CLI for AI agents that need controlled access to a real, already logged-in Google Chrome profile. It works with MCP-capable clients such as Claude Code, Cursor, Codex, VS Code, Windsurf/Cascade, Hermes Agent, and other stdio MCP clients.

Use this project for MCP browser automation, real Chrome profile automation, AI agent browser tools, logged-in dashboard inspection, Chrome extension MCP bridge workflows, local browser control for Claude Code, Cursor, Codex, VS Code, Windsurf, Hermes, Search Console or analytics review, and privacy-aware browser automation.

The project is intentionally not designed for CAPTCHA bypass, remote browser takeover, credential extraction, unattended account mutation, scraping behind access controls without permission, or replacing the user's judgment on sensitive actions.

## Why

Most browser automation starts a clean browser profile. That is great for tests and bad for real dashboards.

Chrome MCP Bridge is for logged-in, human-owned Chrome workflows:

- search consoles and webmaster dashboards
- analytics tools
- admin panels
- extension-authenticated pages
- manual steps that need the user's browser context

## Highlights

- Real Chrome profile: uses the user's existing cookies, extensions, and logins.
- Open by default: reads and tab targeting use all Chrome tabs; explicit scoped policies can use a `Codex Bridge` or session-specific group.
- Workspace policy: local named workspace defaults expose the active group title/color and support scoped or strict outside-tab policy.
- Existing-tab adoption: can pull an already-open Chrome tab into the scoped group.
- Clean group lifecycle: bridge-owned groups are swept on startup, watched on create/update/removal plus tab membership changes, and marked unsaved when Chrome exposes that API. The guard recognizes `Codex Bridge ...` session titles, remembered bridge-created workspace titles, and session-scoped bridge-created group IDs; freshly created bridge session groups are remembered only for the current Chrome session, and bridge-owned tabs are then ungrouped before bridge-driven closing to avoid creating new saved closed tab-group chips.
- CLI and MCP: usable from a terminal or any MCP-capable client.
- MCP client setup: `mcp-config` prints ready-to-paste snippets for Claude Code, Cursor, Codex, VS Code, Windsurf/Cascade, Hermes Agent, and generic stdio MCP clients.
- Project-local MCP install: `mcp-write` writes or merges local client config files for Claude Code, Cursor, Codex, and VS Code without touching user-global config by default.
- Profile-aware onboarding: `doctor`, `mcp-config`, `session-summary`, and `chrome_bridge_tool_advisor` now recommend safer next steps and compact MCP profiles per client.
- Compact IDE profile: Cursor/Windsurf snippets set `CHROME_BRIDGE_MCP_TOOL_PROFILE=core`, exposing 40 high-value tools instead of the full surface for better IDE-agent ergonomics.
- MCP guidance surfaces: built-in prompts and resources expose quickstart, safety, compatibility, profile, and workflow guidance without forcing agents to rediscover the right tool chain.
- Read-first surface: text, HTML, structured snapshots, ranked snippets through `page-search`, screenshots, waits, tabs, and windows.
- Agent discovery: ranked read-only `observe` output for actionable elements, querySelector-verified selectors, and `frameDiagnostics` / `shadowDiagnostics` capability metadata.
- Ref-first actions: `observe` and `find-elements` return compact `elementRef` values such as `e3`; follow-up commands can use `--ref <ref>` instead of repeating a CSS selector.
- High-level action planning: read-only `act-preview` turns natural-language intent like "click login" or "download report" into deterministic low-level CLI/MCP action proposals without mutating the page.
- Bounded high-level apply: confirmed `act-apply` executes exactly one previously previewed action, rejects stale previews, and returns before/after evidence plus the next recommended read.
- Structured extraction: read tables, form structure, lists, key-value blocks, and artifact-backed presets such as `cpa-offer`, `article`, `product-page`, and `pricing-table` without returning private form values.
- Export helpers: save screenshots, print the current tab to PDF locally, discover likely download/offline-export affordances without clicking them, and run a confirmed single-download export that returns local file metadata only.
- Controlled interactions: clicks, typing, keyboard, select boxes, hover, drag/drop, and scroll.
- Workflow helpers: privacy-preserving select option discovery and form fill previews, dialog handling, and file input uploads.
- Debugging tools: bounded diagnostics, page performance/resource summaries, handoff-only Lighthouse planning, local Lighthouse report ingestion, console/network trace through Chrome Debugger/CDP, and confirmed per-tab viewport/network emulation with explicit reset.
- Replay-lite recording: set `CHROME_BRIDGE_RECORDING_PATH=/tmp/chrome-bridge-actions.jsonl` to append redacted command metadata, then run `recording-summary` for a human-reviewed checklist that never auto-executes actions.
- Browser data tools: guarded history, bookmarks, cookies, page storage, and extension-context fetch.
- Human-in-the-loop: local prompt tab for user choices, manual confirmations, and CAPTCHA coordination.
- Policy-aware diagnostics: session summaries and redacted debug bundles include workspace policy state; debug bundles omit page artifacts and full trace events unless explicitly requested.
- Local verification: static `self-test` and real-browser `runtime-smoke`.

## Safety Model

Chrome Bridge can see private browser data because it runs in the user's real Chrome profile.

The default posture is intentionally conservative:

- Commands can target all Chrome tabs by default. Explicit `groupTitle`, `scoped`, or `strict` workspace settings restore group boundaries.
- Named workspace defaults can change the local group title/color. `open` allows all tabs, `scoped` requires explicit override for outside tabs, and `strict` blocks outside tabs entirely.
- Whole-browser inventory reads such as `tabs --all`, `windows --all`, and MCP `includeAll: true` require explicit confirmation.
- Mutating actions require `confirmed=true` or `--confirm`.
- Cookie values, whole-cookie-jar access, storage values, and credentialed requests require `confirmSensitive=true` or `--confirm-sensitive`.
- The default transport is Chrome Native Messaging plus a per-user Unix socket at `/tmp/codex-chrome-bridge.sock`; no TCP bridge server is required.
- If two Chrome profiles run the extension at the same time, `/health` reports every connected profile. Commands fail closed until the CLI or MCP process sets `CHROME_BRIDGE_PROFILE_ID` to the intended `profileId` or `clientId`.
- Automatic CAPTCHA bypass is out of scope; use the human prompt for manual coordination.

Read [Safety and Privacy](docs/SAFETY.md) before using this with sensitive accounts.

## Quick Start

```bash
git clone https://github.com/shutovdef-dotcom/codex-chrome-bridge.git
cd codex-chrome-bridge
npm install
npm run check
npm run install:native-host -- <unpacked-extension-id>
```

In Chrome:

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this repository's `extension/` folder.

The Native Messaging manifest must be installed once for the unpacked extension. Copy the extension ID shown by `chrome://extensions/` and pass it to the installer above. The extension then connects to Chrome's Native Messaging Host, which exposes only the local Unix socket to the CLI/MCP process.

Verify the bridge:

```bash
npm run runtime-smoke:plan
node ./bin/chrome-bridge.mjs reload-extension --confirm
node ./bin/chrome-bridge.mjs doctor --live-checks
node ./bin/chrome-bridge.mjs runtime-smoke --summary-only --out /tmp/chrome-bridge-runtime-smoke.json
```

`npm run runtime-smoke:plan` wraps `runtime-smoke --coverage-plan` and prints the required smoke checklist without contacting Chrome or the live bridge. Use it while another Codex session is actively using the bridge; its top-level `nextCommand` / `nextAction`, `verification.finalCommands`, and `verification.finalMcpCalls` fields show the live sequence to run after the bridge is free: run `node ./bin/chrome-bridge.mjs reload-extension --confirm`, run `node ./bin/chrome-bridge.mjs doctor --live-checks`, then run `node ./bin/chrome-bridge.mjs runtime-smoke --summary-only --out /tmp/chrome-bridge-runtime-smoke.json`. The plan and skipped smoke outputs keep `finalVerificationComplete: false`; final verification is complete only after live smoke reports `finalVerificationComplete: true`. Use `--summary-only --out <file>` for agent runs so stdout stays small while the full JSON report remains local.

If the later live smoke is skipped because the bridge server or extension version is stale, the structured JSON output includes top-level `nextCommand` / `nextAction`, nested `verification.nextCommand` / `verification.nextAction`, and the same `verification.finalCommands` / `verification.finalMcpCalls` recovery sequence, so CLI and MCP agents can proceed without reconstructing the upgrade flow.

The smoke test opens temporary `127.0.0.1` fixture tabs, checks existing-tab adoption, scoped reads, strict workspace policy, session-summary recommendations, debug-bundle default redaction, querySelector/nth-of-type selector fallback, screenshots, PDF export, dialog handling, file input upload, interactions, tracing, browser-data safety gates, and cleanup metadata including `savedClosedGroupChipPrevention`.

## Common Commands

```bash
node ./bin/chrome-bridge.mjs ensure-tab
node ./bin/chrome-bridge.mjs adopt-tab --confirm
node ./bin/chrome-bridge.mjs open "https://example.com"
node ./bin/chrome-bridge.mjs windows
node ./bin/chrome-bridge.mjs tabs
node ./bin/chrome-bridge.mjs workspace --tabs
node ./bin/chrome-bridge.mjs command-catalog --markdown
node ./bin/chrome-bridge.mjs observe --limit 30
node ./bin/chrome-bridge.mjs find-elements --text "Submit"
node ./bin/chrome-bridge.mjs find-elements --near-text "Billing address" --action type
node ./bin/chrome-bridge.mjs click --ref e3 --confirm
node ./bin/chrome-bridge.mjs type --ref e5 --text "hello" --confirm
node ./bin/chrome-bridge.mjs extract --kind forms
node ./bin/chrome-bridge.mjs snapshot --max-chars 60000
node ./bin/chrome-bridge.mjs screenshot --out /tmp/chrome-bridge.png
node ./bin/chrome-bridge.mjs pdf --out /tmp/chrome-bridge.pdf
node ./bin/chrome-bridge.mjs text --max-chars 60000
```

Cheap-first reads:

```bash
node ./bin/chrome-bridge.mjs status --token-budget
node ./bin/chrome-bridge.mjs tabs --summary-only
node ./bin/chrome-bridge.mjs grep-page --pattern "payout|geo|error"
node ./bin/chrome-bridge.mjs page-search --query "download spreadsheet report" --artifact-dir /tmp/chrome-bridge-artifacts
node ./bin/chrome-bridge.mjs links --selector "main"
node ./bin/chrome-bridge.mjs tables --selector "main"
node ./bin/chrome-bridge.mjs read-artifact --path /tmp/page.txt --head 40 --grep "payout"
node ./bin/chrome-bridge.mjs extract --preset cpa-offer --network leads_su --out /tmp/offer.json
node ./bin/chrome-bridge.mjs extract --preset article --out /tmp/article.json --artifact-dir /tmp/chrome-bridge-artifacts
node ./bin/chrome-bridge.mjs download-discovery --out /tmp/downloads.json --artifact-dir /tmp/chrome-bridge-artifacts
node ./bin/chrome-bridge.mjs download --selector "[data-testid='export-csv']" --confirm --download-timeout-ms 45000
node ./bin/chrome-bridge.mjs set-viewport --width 390 --height 844 --mobile --confirm
node ./bin/chrome-bridge.mjs emulate-network --profile slow-4g --confirm
node ./bin/chrome-bridge.mjs clear-emulation --confirm
node ./bin/chrome-bridge.mjs network-export --artifact-dir /tmp/chrome-bridge-artifacts --har-out /tmp/chrome-bridge-network.har.json
node ./bin/chrome-bridge.mjs lighthouse-plan --url https://example.com --out /tmp/lighthouse.json --summary-out /tmp/lighthouse-summary.json
node ./bin/chrome-bridge.mjs lighthouse-ingest --report /tmp/lighthouse.json --out /tmp/lighthouse-summary.json
node ./bin/chrome-bridge.mjs diagnostics --out /tmp/chrome-bridge-diagnostics.json
node ./bin/chrome-bridge.mjs screenshot --out /tmp/page.png --full-page --max-pixels 50000000 --fallback viewport
```

Workspace defaults:

```bash
node ./bin/chrome-bridge.mjs set-workspace --name "analytics" --group-title "Codex Analytics" --group-color blue --policy-mode strict --confirm
node ./bin/chrome-bridge.mjs clear-workspace --confirm
```

Controlled interaction:

```bash
node ./bin/chrome-bridge.mjs click --selector "button" --confirm
```

Sensitive data:

```bash
node ./bin/chrome-bridge.mjs cookies --url "https://example.com" --confirm
node ./bin/chrome-bridge.mjs cookies --url "https://example.com" --include-values --confirm --confirm-sensitive
```

Human-in-the-loop prompt:

```bash
node ./bin/chrome-bridge.mjs ask --question "Which account should I inspect?" --choices-json '["Production","Staging"]'
```

Full reference: [CLI](docs/CLI.md).

## Existing-Tab Workflow

Use this path when you already opened the right logged-in dashboard, report, or admin page in Chrome:

```bash
# Adopt the last focused Chrome tab into the scoped bridge group.
node ./bin/chrome-bridge.mjs adopt-tab --confirm

# Read first, before choosing any interaction.
node ./bin/chrome-bridge.mjs observe --limit 30
node ./bin/chrome-bridge.mjs find-elements --near-text "Billing address" --action type
node ./bin/chrome-bridge.mjs extract --kind forms
node ./bin/chrome-bridge.mjs drag-drop --ref e3 --target-ref e7 --confirm
node ./bin/chrome-bridge.mjs extract --preset article --out /tmp/chrome-bridge-article.json --artifact-dir /tmp/chrome-bridge-artifacts
node ./bin/chrome-bridge.mjs download-discovery --out /tmp/chrome-bridge-downloads.json --artifact-dir /tmp/chrome-bridge-artifacts
node ./bin/chrome-bridge.mjs download --selector "[data-testid='export-csv']" --confirm --download-timeout-ms 45000

# Export or debug locally when needed.
node ./bin/chrome-bridge.mjs network-export --artifact-dir /tmp/chrome-bridge-artifacts --har-out /tmp/chrome-bridge-network.har.json
node ./bin/chrome-bridge.mjs lighthouse-plan --url https://example.com --out /tmp/lighthouse.json --summary-out /tmp/chrome-bridge-lighthouse-summary.json
node ./bin/chrome-bridge.mjs lighthouse-ingest --report /tmp/lighthouse.json --out /tmp/chrome-bridge-lighthouse-summary.json
node ./bin/chrome-bridge.mjs pdf --out /tmp/chrome-bridge.pdf
node ./bin/chrome-bridge.mjs diagnostics --out /tmp/chrome-bridge-diagnostics.json
node ./bin/chrome-bridge.mjs debug-bundle --out /tmp/chrome-bridge-debug
```

If the target tab is not the last focused tab, run `node ./bin/chrome-bridge.mjs tabs --all --confirm` first, choose the tab ID explicitly, then run `node ./bin/chrome-bridge.mjs adopt-tab --tab <id> --confirm`.

`observe` and `find-elements` intentionally target the main-frame light DOM. Their output includes `frameDiagnostics`, `shadowDiagnostics`, and `capabilityWarnings` so agents can see when iframe or shadow DOM content may be present but not directly represented by `elementRef` targets.

Use `page-search` when a large page needs ranked snippets rather than a full text dump. It keeps raw page text in a local artifact and returns only compact scored matches plus artifact paths.

For replay-lite diagnostics, set `CHROME_BRIDGE_RECORDING_PATH=/tmp/chrome-bridge-actions.jsonl` before running CLI or MCP commands. The recording stores redacted command metadata only; `node ./bin/chrome-bridge.mjs recording-summary --recording /tmp/chrome-bridge-actions.jsonl` produces a human-reviewed checklist and does not replay actions automatically.

## MCP Setup

Generate a client-specific config snippet:

```bash
node ./bin/chrome-bridge.mjs mcp-config
node ./bin/chrome-bridge.mjs mcp-config --client claude-code
node ./bin/chrome-bridge.mjs mcp-config --client cursor
node ./bin/chrome-bridge.mjs mcp-config --client hermes
node ./bin/chrome-bridge.mjs mcp-write --client cursor
node ./bin/chrome-bridge.mjs mcp-write --client codex
```

Use the generated snippet in Claude Code, Cursor, Codex, VS Code, Windsurf/Cascade, Hermes Agent, or any stdio MCP client. Cursor and Windsurf snippets use the compact `core` tool profile by default; set `CHROME_BRIDGE_MCP_TOOL_PROFILE=full` if you want every tool in clients that handle larger tool lists well.
Generic stdio snippets now default to the conservative `read` profile first; switch them to `full` only when the host really needs private browser-data tools or broader mutation coverage.
`mcp-write` is the safe installer path for project-local configs: it writes `.mcp.json`, `.cursor/mcp.json`, `.codex/config.toml`, or `.vscode/mcp.json` under the current project root, merging JSON/TOML where appropriate. For clients without a stable project-local path, pass `--out <file>` to render an explicit file instead of touching any global config.

When the extension is enabled in more than one Chrome profile, run `node ./bin/chrome-bridge.mjs health` and copy the desired value from `extensions[].info.profileId` or `extensions[].info.clientId`. Set `CHROME_BRIDGE_PROFILE_ID=<that value>` in the CLI/MCP process that should control that profile. Without it, commands intentionally return `AMBIGUOUS_EXTENSION_PROFILE` instead of guessing.

Codex TOML example:

```toml
[mcp_servers.chrome-bridge]
command = "node"
args = ["/absolute/path/to/codex-chrome-bridge/mcp/chrome-bridge-mcp.mjs"]
startup_timeout_sec = 20
tool_timeout_sec = 60
```

Useful MCP tools:

- `chrome_bridge_health`
- `chrome_bridge_windows`
- `chrome_bridge_tabs`
- `chrome_bridge_workspace`
- `chrome_bridge_adopt_tab`
- `chrome_bridge_open`
- `chrome_bridge_observe`
- `chrome_bridge_find_elements`
- `chrome_bridge_extract`
- `chrome_bridge_download_discovery`
- `chrome_bridge_download`
- `chrome_bridge_lighthouse_ingest`
- `chrome_bridge_snapshot`
- `chrome_bridge_screenshot`
- `chrome_bridge_pdf`
- `chrome_bridge_trace_start`
- `chrome_bridge_trace_summary`
- `chrome_bridge_diagnostics`
- `chrome_bridge_cookies_list`
- `chrome_bridge_storage_snapshot`
- `chrome_bridge_ask_user`
- `chrome_bridge_session_summary`
- `chrome_bridge_debug_bundle`
- `chrome_bridge_command_catalog`
- `chrome_bridge_runtime_smoke`

Full reference: [MCP](docs/MCP.md). Client setup guide: [MCP Client Compatibility](docs/COMPATIBILITY.md).

## macOS Native Messaging Host

Install the host manifest once. Chrome starts the Native Messaging Host when the extension connects; no LaunchAgent or manually managed TCP server is required:

```bash
npm run install:native-host -- <unpacked-extension-id>
node ./bin/chrome-bridge.mjs health
```

Uninstall:

```bash
npm run uninstall:native-host
```

## Project Layout

```text
bin/        CLI binary wrapper and CLI implementation modules
extension/  Chrome Manifest V3 extension
mcp/        MCP stdio binary wrapper and server implementation modules
native/     Chrome Native Messaging Host and Unix Socket relay
server/     explicit legacy HTTP/WebSocket bridge server
shared/     command registry, payload contracts, and cross-surface helpers
scripts/    verification, packaging, docs, and macOS LaunchAgent helpers
docs/       user and developer docs
examples/   fixture-backed command examples and MCP client config templates
codex/      optional Codex skill handoff
```

## Documentation

| Topic | Link |
| --- | --- |
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| CLI reference | [docs/CLI.md](docs/CLI.md) |
| MCP reference | [docs/MCP.md](docs/MCP.md) |
| MCP client compatibility | [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) |
| Streamable HTTP transport plan | [docs/STREAMABLE-HTTP.md](docs/STREAMABLE-HTTP.md) |
| Autonomy boundaries | [docs/AUTONOMY-BOUNDARIES.md](docs/AUTONOMY-BOUNDARIES.md) |
| Cloud and scale boundary | [docs/CLOUD-AND-SCALE.md](docs/CLOUD-AND-SCALE.md) |
| Install fast paths | [docs/INSTALL.md](docs/INSTALL.md) |
| Generated command catalog | [docs/COMMAND-CATALOG.md](docs/COMMAND-CATALOG.md) |
| Examples gallery | [docs/EXAMPLES.md](docs/EXAMPLES.md) |
| Real page validation | [docs/REAL-PAGE-VALIDATION.md](docs/REAL-PAGE-VALIDATION.md) |
| Chrome extension setup | [docs/EXTENSION.md](docs/EXTENSION.md) |
| Safety and privacy | [docs/SAFETY.md](docs/SAFETY.md) |
| Extension privacy policy | [docs/PRIVACY-POLICY.md](docs/PRIVACY-POLICY.md) |
| Maintainability guide | [docs/MAINTAINABILITY.md](docs/MAINTAINABILITY.md) |
| Agent token budget | [docs/AGENT-TOKEN-BUDGET.md](docs/AGENT-TOKEN-BUDGET.md) |
| Competitive analysis and roadmap | [docs/COMPETITIVE-ROADMAP.md](docs/COMPETITIVE-ROADMAP.md) |
| Detailed implementation plan | [docs/IMPLEMENTATION-PLAN-2026-06-12.md](docs/IMPLEMENTATION-PLAN-2026-06-12.md) |
| Distribution and GitHub SEO | [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) |
| Registry submission checklist | [docs/REGISTRY-SUBMISSIONS.md](docs/REGISTRY-SUBMISSIONS.md) |
| Chrome Web Store submission packet | [docs/CHROME-WEB-STORE.md](docs/CHROME-WEB-STORE.md) |
| UBS bug scan and fix plan | [docs/UBS-BUG-SCAN-2026-06-12.md](docs/UBS-BUG-SCAN-2026-06-12.md) |
| Publishing checklist | [docs/PUBLISHING.md](docs/PUBLISHING.md) |
| AI-readable project summary | [llms.txt](llms.txt) |

## Verification

```bash
npm run docs:commands
npm run check
npm run check:registry
npm run check:registry-modules
npm run check:docs
npm run check:bridge-contract
npm run check:runtime-smoke-plan
npm run check:roadmap
npm run check:cli-local-tools
npm run check:cli-modules
npm run check:mcp-runtime-smoke
npm run check:mcp-local-tools
npm run check:mcp-modules
npm run check:tab-group-persistence
npm run check:ubs-fixes
npm run check:roadmap-next-slice
npm run check:network-export
npm run check:lighthouse-plan
npm run check:examples-gallery
npm run check:client-docs
npm run check:page-scripts-modules
npm run check:streamable-http-plan
npm run check:autonomy-cloud-boundaries
npm run check:reorganization-boundaries
npm run check:privacy
npm run check:maintainability
npm run check:audit
npm run check:pack
npm run extension:zip
npm run runtime-smoke:plan
node ./bin/chrome-bridge.mjs reload-extension --confirm
node ./bin/chrome-bridge.mjs doctor --live-checks
node ./bin/chrome-bridge.mjs runtime-smoke --summary-only --out /tmp/chrome-bridge-runtime-smoke.json
```

`docs:commands` regenerates the checked-in command catalog, managed CLI usage blocks, managed CLI metadata table, and managed MCP tool reference table from the shared registry. `check:registry` verifies command registry invariants, direct payload validation samples, complete CLI/MCP catalog coverage, debugger-backed action serialization, package/manifest/registry parity, and generated command catalog drift. `check:registry-modules` verifies the registry split keeps `shared/command-registry.mjs` as a stable wrapper, keeps focused `shared/registry/*` modules present, and syntax-checks the module/helper files through `npm run check`. `check:docs` verifies the CLI reference mirrors every registry-owned usage signature, the CLI generated blocks stay grouped correctly, the CLI/MCP reference keeps generated tool metadata blocks in sync, and every registry-defined MCP tool is documented. `check:bridge-contract` starts an isolated local test server, does not touch Chrome, and verifies bridge boundary/error behavior including malformed JSON, oversized JSON handling, timeout handling, stale extension fail-closed behavior, and shutdown cleanup. `check:runtime-smoke-plan` runs the offline smoke plan against a dead bridge URL and verifies stale-extension/stale-bridge skip metadata, structured JSON output, CLI-exit preservation, and `finalVerificationComplete: false` against fake `/health` servers, failing if the plan starts depending on live Chrome or bridge state. `check:roadmap` verifies the merged Phase 0-4 roadmap against registry, source, docs, and the offline runtime-smoke coverage plan without touching Chrome; its `deferredLiveVerification` output records the pending live gate, final CLI commands, final MCP calls, success criteria, and required live coverage items. `check:cli-local-tools` exercises CLI setup diagnostics and command-catalog output against a dead bridge URL, proving they stay offline by default; it also verifies CLI group scope payload forwarding for scoped group commands against a fake `/command` bridge. `check:cli-modules` verifies the public CLI binary remains a tiny executable wrapper while CLI parsing and command dispatch live under `bin/cli/`. `check:mcp-runtime-smoke` starts the MCP server over stdio against fake bridge URLs and verifies the MCP runtime-smoke tool preserves structured coverage-plan, stale-extension/stale-bridge metadata, structured JSON output, summary output, local full-report artifacts, and CLI-exit preservation without touching Chrome. `check:mcp-local-tools` starts the MCP server over stdio and verifies local diagnostics like `chrome_bridge_doctor` stay offline by default; it also verifies MCP group scope payload forwarding for scoped group tools against a fake `/command` bridge. `check:mcp-modules` verifies the public stdio MCP binary remains a tiny executable wrapper while tool, prompt, and resource registration live under `mcp/server/`. `check:tab-group-persistence` runs the extension tab-group persistence and cleanup modules against fake Chrome APIs, proving managed group listeners, listener event callbacks for future managed groups, freshly created bridge session groups, fake saved closed group chips prevention, and stale membership cleanup without touching Chrome. `check:ubs-fixes` covers the UBS follow-up hardening plan: abortable fetch boundaries, safe metadata stripping, rejection-safe offscreen listeners, prompt DOM guards, and corrupted run-state recovery. `check:roadmap-next-slice` covers the artifact-backed structured presets, read-only download discovery, local Lighthouse ingestion, CLI/MCP exposure, and package contents for the current roadmap slice. `check:network-export` verifies the redacted network-export helper, CLI, and MCP surfaces, including artifact generation, token-like query redaction, HAR-like output, and sensitive-confirmation gates. `check:lighthouse-plan` verifies the handoff-only Lighthouse planner across the shared helper, CLI, and MCP surfaces, including exact command emission, protocol validation, and the follow-up `lighthouse-ingest` workflow without touching Chrome. `check:client-docs` verifies the install fast paths and compatibility docs stay aligned for Claude Code, Cursor, Codex, VS Code, Windsurf/Cascade, and Hermes Agent. `check:extension-package` builds a deterministic extension zip, verifies archive contents against the checked-in `extension/` tree, and checks that install/privacy/publishing docs stay in sync with the packaging flow. `check:page-scripts-modules` verifies `extension/page-scripts.js` remains a stable wrapper while injected page collectors and DOM helpers live under `extension/page-scripts/`. `check:examples-gallery` validates the examples gallery, fixtures, package exposure, metadata-first behavior, JSON-LD preset tuning, pricing-card extraction, download discovery inference, and Lighthouse summary ingestion. `check:streamable-http-plan` verifies the future Streamable HTTP transport plan stays explicitly opt-in, keeps stdio as the current default, and documents Origin/DNS rebinding, bind-address, authentication, TLS, and MCP session/protocol header requirements. `check:autonomy-cloud-boundaries` verifies high-level action docs stay bounded around `act-preview` and one-step `act-apply`, while cloud/scale docs remain research-only with no CAPTCHA bypass, proxy/stealth, paid-provider, or remote-browser execution claims. `check:reorganization-boundaries` verifies reorganized script paths, stable public entrypoints, package exposure, and README coverage before deeper file moves continue. `check:privacy` scans repository files for local home paths, private-key headers, common provider tokens, and obvious secret assignments. `check:maintainability` verifies the maintainer guide, current large-module hot spots, source-string check policy, command-change workflow, and the documented Zod v3/v4 dependency decision. `check:pack` parses the dry-run npm tarball, verifies required runtime, extension, shared registry, generated docs, examples, and verification files are included, and runs a packaged registry check in a simulated package layout. `extension:zip` creates a Chrome Web Store style zip from the exact `extension/` tree without bundling repo-only files. `runtime-smoke:plan` is offline and safe while the live bridge is busy. Live verification requires `reload-extension --confirm`, `doctor --live-checks`, and `runtime-smoke --summary-only --out <file>` after the bridge is free. `runtime-smoke` requires Chrome, the unpacked extension, and the bridge server. It only uses a local fixture page.

## Contributing

Issues and pull requests are welcome. Start with:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md)
- [SUPPORT.md](SUPPORT.md)

## License

MIT. See [LICENSE](LICENSE).
