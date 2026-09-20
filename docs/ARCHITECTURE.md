# Architecture

Chrome MCP Bridge, formerly Codex Chrome Bridge, has four runtime pieces plus shared command contracts and verification tooling.

## Chrome Extension

The `extension/` directory contains a Manifest V3 extension:

- `manifest.json` declares permissions.
- `background.js` executes browser commands.
- `browser-data.js` owns private browser-data actions for history, bookmarks, cookies, and extension-context requests.
- `debugger-session.js` owns Chrome Debugger attach/detach lifecycle, per-tab serialization, and trace event buffering.
- `extension-errors.js` classifies extension-side command failures into stable bridge error codes.
- `keyboard-events.js` owns Chrome Debugger key-event payload mapping for trusted keyboard input.
- `navigation-actions.js` owns tab/window inventory, workspace status/configuration, tab creation/adoption, scoped closes, and basic navigation actions.
- `offscreen-lifecycle.js` owns creation and retry-safe startup of the MV3 offscreen bridge document.
- `page-artifacts.js` owns screenshot and PDF artifact capture.
- `page-execution.js` owns the `chrome.scripting.executeScript` execution boundary for injected page helpers.
- `page-interactions.js` owns page mutation, trusted input, dialog, and file-upload actions.
- `page-read-actions.js` owns page inspection and read actions such as observe, extract, text, HTML, select-option discovery, and storage snapshots.
- `page-scripts.js` is the stable wrapper for injected page helpers; `page-scripts/main.js` contains the self-contained functions injected into web pages through `chrome.scripting.executeScript`.
- `runtime-actions.js` owns extension runtime actions such as confirmed extension reload.
- `safety-gates.js` owns confirmation and sensitive-confirmation runtime guards.
- `tab-cleanup.js` owns tab close cleanup, including ungroup-before-close mitigation for saved closed tab groups.
- `tab-group-persistence.js` owns feature-detected saved-tab-group disablement for current no-op/future Chrome API support, plus startup sweeping, create/update/removal listeners, and managed tab membership tracking that keep Codex groups ephemeral when that surface exists. It treats default, `Codex Bridge ...` session, remembered bridge-created workspace titles, and session-scoped bridge-created group IDs from Chrome session storage as managed.
- `tab-info.js` owns tab and tab-group response serialization.
- `tab-loading.js` owns tab-load completion polling helpers.
- `trace-actions.js` owns trace command wrappers around the debugger session helpers.
- `user-prompts.js` owns human-in-the-loop prompt state, prompt tab lifecycle, and answer completion.
- `workspace-policy.js` owns local workspace defaults and scoped policy normalization.
- `workspace-tabs.js` owns scoped workspace tab/group targeting and extension-local workspace storage state, including the bounded remembered-title list used by tab-group persistence sweeps and Chrome session storage for browser-session group IDs.
- `offscreen.html` and `offscreen.js` connect to `com.codex.chrome_bridge` through Chrome Native Messaging and relay requests to the local Unix Socket.
- `ask.html` and `ask.js` provide a local human-in-the-loop prompt page.

The extension is the only component that talks directly to Chrome extension APIs.

## Native Messaging Host

`native/host.mjs` is started by Chrome when the extension calls `chrome.runtime.connectNative()`. It owns the per-user Unix Socket at `/tmp/codex-chrome-bridge.sock` and relays newline-delimited CLI/MCP requests to the extension over Native Messaging.

It exposes:

- `health` socket requests for diagnostics.
- `command` socket requests for CLI/MCP commands.
- Native Messaging frames between Chrome and the extension.

Install the host manifest once with `npm run install:native-host -- <extension-id>`. The extension ID is the ID shown for the unpacked extension in `chrome://extensions/`. The host does not persist browser data.

`server/bridge-server.mjs` remains as an explicit legacy HTTP/WebSocket compatibility server for isolated contract tests and callers that set `CHROME_BRIDGE_URL=http://...`; it is not started by the default CLI/MCP path.

The server keeps a per-profile extension client map instead of a single global extension socket. The extension hello includes a stable per-Chrome-profile `profileId` stored in `chrome.storage.local`, plus the older `clientId` fallback. `/health` preserves the legacy `extension` summary and also exposes `extensions[]` with each connected profile. When more than one profile is connected, `/command` fails closed with `AMBIGUOUS_EXTENSION_PROFILE` unless the caller supplies routing-only `payload.profileId`; CLI and MCP wrappers add that field automatically from `CHROME_BRIDGE_PROFILE_ID`. The routing field is stripped before extension dispatch, so extension action handlers only see their normal action payload.

It also rejects unsupported actions, rejects browser and extension origins on direct command ingress, exposes CORS only on extension ingress paths, requires `application/json` for JSON POST endpoints, validates direct JSON bodies and explicit command envelope fields, validates command payloads including required fields, nested form/header/prompt shapes, enum fields, numeric bounds, confirmation gates, top-level timeouts, and URL schemes before extension dispatch, refuses non-loopback binds by default, requires extension-origin ingress with origin/id parity when reported, returns stable disconnected-extension errors, preserves extension error codes/details for CLI/MCP diagnostics, and refuses most commands when the connected extension version is missing or does not match the bridge version, so unverified or stale unpacked extensions fail closed instead of drifting silently. The confirmed `reloadExtension` action is the deliberate recovery exception, allowing a stale unpacked extension to reload itself during upgrade verification.

## Shared Command Registry

`shared/command-registry.mjs` is the stable wrapper for the Node-side command contract source of truth in `shared/registry/`.
`shared/session-group-title.mjs` derives CLI/MCP per-session group titles from `CHROME_BRIDGE_SESSION_TITLE`, Codex session title env vars, or a short `CODEX_THREAD_ID`, while preserving explicit `groupTitle` overrides.

It defines:

- bridge version metadata
- expected extension actions
- manifest permissions used by `self-test`
- CLI command names
- CLI usage signatures used by `chrome-bridge --help`
- CLI reference usage groups used by `npm run docs:commands`
- MCP tool names
- local MCP client setup metadata exposed through `mcp-config` / `chrome_bridge_mcp_config`
- server payload schemas for direct `/command` callers
- per-action risk tiers and default timeout metadata
- debugger-backed actions that must be serialized per tab
- command catalog summaries, CLI aliases, MCP tool names, and confirmation requirements
- local diagnostic/tooling command metadata, including whether each command touches the live bridge

The extension still owns Chrome API execution, but the server allowlist, runtime default timeouts, CLI `--help` signatures, CLI reference usage groups, CLI reference metadata table, MCP reference tool table, static parity checks, generated [command catalog](COMMAND-CATALOG.md), and `command-catalog` / `chrome_bridge_command_catalog` output derive from this shared registry. The generated Markdown catalog exposes action risk, default timeout, confirmation, CLI usage signatures, and direct `/command` payload-key metadata from the same source, including keeping `confirmSensitive` limited to private-value actions.

`npm run check:registry` verifies the registry contract without touching Chrome: schema uniqueness, package/manifest/registry version and permission parity, metadata/catalog parity, complete CLI and MCP catalog coverage, registry-owned CLI usage signatures and groups, debugger-backed action serialization, confirmation invariants, selected payload validation cases including unsafe URL-scheme rejection, and generated command catalog drift. `npm run check:docs` separately verifies that the CLI reference mirrors every registry-owned usage signature, the CLI generated usage blocks match registry groups, the CLI and MCP references keep their generated tool metadata blocks in sync, and the MCP reference mentions every registry-defined tool.

`npm run check:bridge-contract` also avoids Chrome. It starts an isolated local bridge server on an ephemeral port and verifies disabled long-poll fallback, unsupported action rejection, malformed JSON/payload/envelope/media-type/timeout/oversized-body rejection, direct-command origin rejection, disconnected-extension 503 behavior, unsafe host rejection, extension-origin ingress and origin/id mismatch rejection including known-extension poll requests, stale/missing extension-version fail-closed behavior, stale-extension reload recovery, shutdown cleanup for WebSocket/pending-command lifecycle, and extension error code/detail propagation.

## CLI

`bin/chrome-bridge.mjs` is the stable user-facing command-line binary. It delegates to `bin/cli/main.mjs`, which sends commands to the Native Messaging Host's Unix Socket and prints JSON results.

It also contains:

- `self-test`, a static project parity check.
- `runtime-smoke`, a safe real-browser smoke test using a temporary `127.0.0.1` fixture page.
- `doctor`, diagnostics for extension setup.
- `ask`, a local prompt for user answers without leaving the scoped Chrome group.

## MCP Server

`mcp/chrome-bridge-mcp.mjs` is the stable MCP stdio binary. It delegates to `mcp/server/main.mjs`, which exposes the same browser surface as MCP tools over stdio for Claude Code, Cursor, Codex, VS Code, Windsurf/Cascade, Hermes Agent, and generic MCP clients.

The MCP server supports `CHROME_BRIDGE_MCP_TOOL_PROFILE=full|core|read`. The default `full` profile exposes every tool. The `core` profile keeps the active tool list compact for IDE clients and omits sensitive private-browser tools by default, while `read` favors conservative read-mostly inspection.

The MCP server is intentionally thin:

- It validates tool arguments with Zod.
- It forwards commands to the Native Messaging Host's Unix Socket.
- It returns JSON as MCP text content.

## Data Flow

```text
MCP client or CLI
  -> Unix Socket /tmp/codex-chrome-bridge.sock
  -> Native Messaging Host
  -> Chrome extension Native Messaging port
  -> Chrome extension APIs / page scripts / Chrome Debugger
  -> result back through the same path
```

## Trust Boundary

The important boundary is the user's real Chrome profile. Anything visible to Chrome may be private.

Use [SAFETY.md](SAFETY.md) as the source of truth for confirmation gates and private-data handling.

Named workspace defaults are stored in extension-local storage. The default `open` policy allows all tabs; `scoped` requires `allowExternal` for outside tabs, while `strict` blocks outside tabs entirely. CLI/MCP session-derived titles are only applied to group-oriented or explicitly scoped commands, so separate Codex sessions can still use separate Chrome tab groups when requested.
