# Install Fast Paths

Chrome MCP Bridge can be installed in under five minutes if you follow the client-specific fast path instead of assembling the pieces manually.

## Shared Steps

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Load unpacked `extension/` in `chrome://extensions/`.
4. Copy the extension ID from `chrome://extensions/` and install the Native Messaging Host with `npm run install:native-host -- <extension-id>`.
5. Generate a client snippet with `node ./bin/chrome-bridge.mjs mcp-config --client <name>` or write a project-local file with `node ./bin/chrome-bridge.mjs mcp-write --client <name>`.
6. Verify the live setup with:

```bash
node ./bin/chrome-bridge.mjs doctor --live-checks
node ./bin/chrome-bridge.mjs runtime-smoke --summary-only --out /tmp/chrome-bridge-runtime-smoke.json
```

## One-Command And One-Click Status

Use this matrix when deciding how much setup UI to expose for a client.

| Client | Best current path | Status |
| --- | --- | --- |
| Claude Code | `node ./bin/chrome-bridge.mjs mcp-write --client claude-code` | One command writes a project-local `.mcp.json`. |
| Cursor | `node ./bin/chrome-bridge.mjs mcp-write --client cursor` | One command writes `.cursor/mcp.json`; Cursor Settings -> MCP remains the manual UI fallback. |
| Codex | `node ./bin/chrome-bridge.mjs mcp-write --client codex` | One command writes `.codex/config.toml`. |
| VS Code | `node ./bin/chrome-bridge.mjs mcp-write --client vscode` or `code --add-mcp '<json>'` from `mcp-config --client vscode` | One command writes `.vscode/mcp.json`; VS Code CLI can add an MCP server from generated JSON. |
| Windsurf / Cascade | `node ./bin/chrome-bridge.mjs mcp-config --client windsurf` | Copy-paste config path; keep `core` profile by default. |
| Hermes Agent | `node ./bin/chrome-bridge.mjs mcp-config --client hermes` | Copy-paste config path until Hermes exposes a stable project-local writer. |
| Chrome Extension | `npm run extension:zip` plus [CHROME-WEB-STORE.md](CHROME-WEB-STORE.md) | Store packet is ready for maintainer review; actual Chrome Web Store submission is manual. |

## Claude Code

- Fast path: `node ./bin/chrome-bridge.mjs mcp-write --client claude-code`
- Default profile: `full`
- Local file: `.mcp.json`

## Cursor

- Fast path: `node ./bin/chrome-bridge.mjs mcp-write --client cursor`
- Default profile: `core`
- Why: Cursor benefits from the smaller tool list and safer defaults.

## Codex

- Fast path: `node ./bin/chrome-bridge.mjs mcp-write --client codex`
- Default profile: `full`
- Local file: `.codex/config.toml`

## VS Code

- Fast path: `node ./bin/chrome-bridge.mjs mcp-write --client vscode`
- Default profile: `full`
- Local file: `.vscode/mcp.json`

## Windsurf / Cascade

- Fast path: `node ./bin/chrome-bridge.mjs mcp-config --client windsurf`
- Recommended profile: `CHROME_BRIDGE_MCP_TOOL_PROFILE=core`
- Suggested output path: pass `--out ~/.codeium/windsurf/mcp_config.json` when you want a rendered file.

## Hermes Agent

- Fast path: `node ./bin/chrome-bridge.mjs mcp-config --client hermes`
- Default profile: `full`
- Suggested output path: pass `--out ~/.hermes/config.yaml` when you want a rendered file.

## Generic MCP Hosts

- Fast path: `node ./bin/chrome-bridge.mjs mcp-config --client generic`
- Recommended profile: `read`
- Use this when you only need inspection, extraction, screenshots, or diagnostics.

For more complete snippets and troubleshooting, continue in [COMPATIBILITY.md](COMPATIBILITY.md).
