# Safety and Privacy

Chrome MCP Bridge can inspect a real Chrome profile. That is powerful and sensitive.

## Default Scope

The bridge allows all Chrome tabs by default. Explicit `groupTitle`/`--group-title`, `scoped`, or `strict` workspace policy restores a Chrome tab-group boundary.

Users can configure local workspace defaults for the group title/color with `set-workspace` or `chrome_bridge_set_workspace`. This does not grant broader browser access.

When the extension service worker starts, and whenever the bridge creates, reuses, updates, removes, or observes tab membership changes in its scoped tab group, it checks whether the running Chrome exposes a future `saved` tab-group property. The managed-group guard covers the default `Codex Bridge` title, `Codex Bridge ...` session titles, bridge-created workspace titles remembered in extension-local storage, and bridge-created group IDs remembered only in Chrome session storage. Fresh bridge-created session groups follow the same path immediately after creation, so they are treated as ephemeral for the current Chrome session instead of durable workspace state. Current public Chrome APIs do not expose saved closed tab-group chip management, so this is a no-op today; if Chrome later supports that property, the bridge will mark managed Codex groups `saved: false` on a best-effort basis and forget stale managed tab membership when groups are removed.

When the bridge closes its own tabs through `close-tab`, `close-group`, prompt cleanup, or `runtime-smoke` cleanup, the extension first tries the same best-effort saved-group disablement, then removes those tabs from their Chrome tab group, and only then closes them. Cleanup returns `savedClosedGroupChipPrevention` metadata when this ungroup-before-close path runs. If Chrome cannot ungroup a grouped bridge tab, cleanup fails closed instead of closing the tab and risking a new saved closed group chip. This prevents future bridge cleanup from creating more saved closed groups but cannot delete groups Chrome has already saved.

Whole-browser inventory reads are the default. Explicit `tabs --all`, `windows --all`, `chrome_bridge_tabs({ includeAll: true })`, and `chrome_bridge_windows({ includeAll: true })` remain confirmation-gated because they can expose unrelated tab URLs and titles.

Policy modes:

- `open`: commands can target all Chrome tabs by default.
- `scoped`: commands with explicit tab IDs reject outside tabs unless `allowExternal` or `--allow-external` is passed.
- `strict`: outside tabs are blocked even when `allowExternal` or `--allow-external` is passed.

Commands with explicit tab IDs are open by default; `allowExternal` remains available for scoped compatibility and is blocked by strict policy.

## MCP Tool Profiles

The MCP server exposes the full tool surface by default. IDE clients can set `CHROME_BRIDGE_MCP_TOOL_PROFILE=core` or `CHROME_BRIDGE_MCP_TOOL_PROFILE=read` to reduce tool-list size and keep sensitive private-browser tools out of the active client surface by default.

Profiles do not weaken confirmation gates. When private or mutating tools are exposed, they still require the same `confirmed` and `confirmSensitive` arguments described below.

## Confirmation Gates

Commands that can mutate state or expose private data require confirmation.

Examples:

- clicks
- typing
- selecting
- closing tabs
- trace sessions
- extension reloads
- history search
- bookmark search
- cookie listing
- page storage inspection
- extension-context requests

## Sensitive Confirmation

Some operations require a second confirmation:

- cookie values
- whole-cookie-jar listing
- storage values
- credentialed requests

CLI flag:

```bash
--confirm-sensitive
```

MCP argument:

```json
{
  "confirmSensitive": true
}
```

## Agent Rules

Agents using this bridge should:

- Prefer read-only commands first.
- Avoid unrelated user tabs.
- Avoid submitting forms unless explicitly asked.
- Avoid requesting indexing, changing settings, deleting data, uploading files, or sending private data externally unless explicitly asked.
- Use `ask` / `chrome_bridge_ask_user` for manual confirmations and CAPTCHA coordination; do not implement automatic CAPTCHA bypass.
- Redact private dashboard content from bug reports and public logs.
- Keep `debug-bundle` page artifacts and full trace events disabled by default; enable snapshot, observe, screenshot, or full trace artifacts only for local reports where page content and URLs are safe to include.
- Treat page extraction output as potentially private page content; form extraction reports field structure and value state, not current form values.
- Treat form previews as potentially sensitive; `fill-form` reports field value states, not current or planned raw values.
- Use `select-options` for available-option discovery only; it omits the current selected value/option from read-only output.

Autonomy boundaries: high-level actions are limited to read-only `act-preview` and confirmed one-step `act-apply`; there is no self-approval of confirmations, no autonomous multi-step mutation loop, and no remote LLM execution inside the bridge. See [AUTONOMY-BOUNDARIES.md](AUTONOMY-BOUNDARIES.md).

## Frame And Shadow DOM Boundaries

`observe`, `find-elements`, and `elementRef` actions target the main-frame light DOM. They report `frameDiagnostics`, `shadowDiagnostics`, and `capabilityWarnings` when iframe or shadow DOM boundaries are present, but they do not traverse shadow DOM or expose cross-origin iframe internals as direct `elementRef` targets.

Treat controls inside a cross-origin iframe as a separate browser boundary. Prefer opening or adopting the frame target as its own tab when the site supports that workflow, then read first again before any confirmed action.

## Network Boundary

The Native Messaging Host listens on a per-user Unix Socket in Node's temporary directory. It does not open a TCP listener.

Streamable HTTP is not implemented in this release. Any future Streamable HTTP MCP endpoint must be opt-in, keep `127.0.0.1` as the default bind address, validate `Origin` to defend against DNS rebinding, and require authentication plus TLS before any non-loopback or remotely reachable deployment. See [STREAMABLE-HTTP.md](STREAMABLE-HTTP.md).

The extension uses Chrome Native Messaging plus the same per-user Unix Socket relay. The socket accepts only newline-delimited health and command envelopes from local CLI/MCP processes.

Navigation accepts only `http:`, `https:`, and `about:blank` URLs. Extension-context requests and cookie URL filters accept only `http:` and `https:` URLs. This blocks `javascript:`, `data:`, `file:`, and other non-web schemes from becoming an alternate page-code or local-file access path.
