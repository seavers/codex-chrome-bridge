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
- `ask.html` and `ask.js` provide a local human-in-the-loop prompt page.

The extension is the only component that talks directly to Chrome extension APIs.

## Native Messaging Host

`native/host.mjs` is started by Chrome when the extension service worker calls `chrome.runtime.connectNative()`. It owns one per-user Unix Socket in Node's temporary directory and relays newline-delimited CLI/MCP requests to the extension over Native Messaging. The service worker is the only extension transport owner; there is no second Offscreen connection.

It exposes:

- `health` socket requests for diagnostics.
- `command` socket requests for CLI/MCP commands.
- Native Messaging frames between Chrome and the extension.

Install the host manifest once with `npm run install:native-host -- <extension-id>`. The extension ID is the ID shown for the unpacked extension in `chrome://extensions/`. The host does not persist browser data.

The Native Host validates the request type, relays commands to the connected extension, preserves extension error codes and details, and reports the actual per-user socket path for diagnostics. Command payload validation and confirmation gates remain in the shared registry and CLI/MCP layers. The confirmed `reloadExtension` action is the deliberate recovery exception for stale unpacked extensions.

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

`npm run check:bridge-contract` also avoids Chrome. It starts an isolated Native Messaging Host on an ephemeral port and verifies disabled long-poll fallback, unsupported action rejection, malformed JSON/payload/envelope/media-type/timeout/oversized-body rejection, direct-command origin rejection, disconnected-extension 503 behavior, unsafe host rejection, extension-origin ingress and origin/id mismatch rejection including known-extension poll requests, stale/missing extension-version fail-closed behavior, stale-extension reload recovery, shutdown cleanup for Native Messaging/pending-command lifecycle, and extension error code/detail propagation.

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
  -> Unix Socket reported by the Native Messaging Host
  -> Native Messaging Host
  -> Chrome extension Native Messaging port
  -> Chrome extension APIs / page scripts / Chrome Debugger
  -> result back through the same path
```

## Trust Boundary

The important boundary is the user's real Chrome profile. Anything visible to Chrome may be private.

Use [SAFETY.md](SAFETY.md) as the source of truth for confirmation gates and private-data handling.

Named workspace defaults are stored in extension-local storage. The default `open` policy allows all tabs; `scoped` requires `allowExternal` for outside tabs, while `strict` blocks outside tabs entirely. CLI/MCP session-derived titles are only applied to group-oriented or explicitly scoped commands, so separate Codex sessions can still use separate Chrome tab groups when requested.
