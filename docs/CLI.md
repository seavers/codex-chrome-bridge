# CLI Reference

Run commands from the project root:

```bash
node ./bin/chrome-bridge.mjs <command>
```

Or install/link the package and use:

```bash
chrome-bridge <command>
```

## Command Metadata

The command metadata table below is generated from the shared registry by `npm run docs:commands`.

<!-- BEGIN GENERATED CLI REFERENCE -->
| Command | Contract | Risk | Default Timeout | Confirm | Live Bridge | Summary |
| --- | --- | --- | --- | --- | --- | --- |
| `health` | `health` | read | 10000 ms | no | yes | Read local bridge health and extension connection status. |
| `status` | `status` | read | 30000 ms | no | yes | Print cheap-first bridge status and token-budget recommendations. |
| `windows` | `windows` | read | 10000 ms | conditional | yes | List all Chrome windows by default; pass includeAll=false with an explicit group to limit the result. |
| `group` | `group` | read | 10000 ms | no | yes | Show the current scoped Chrome tab group and its tabs. |
| `tabs` | `tabs` | read | 10000 ms | conditional | yes | List all Chrome tabs by default; pass includeAll=false with an explicit group to limit the result. |
| `workspace` | `workspace` | read | 10000 ms | no | yes | Show local workspace defaults, policy mode, and group counts. |
| `set-workspace` | `setWorkspace` | system | 10000 ms | yes | yes | Set local workspace group title, color, and open/scoped/strict policy defaults. |
| `clear-workspace` | `clearWorkspace` | system | 10000 ms | yes | yes | Clear local workspace defaults and return to the default open policy. |
| `ensure-tab` | `ensureTab` | system | 30000 ms | no | yes | Create or recover the active Chrome work tab; explicit scoped policies still use a dedicated group. |
| `adopt-tab` | `adoptTab` | interaction | 30000 ms | yes | yes | Adopt an already-open Chrome tab into an explicit scoped bridge group. |
| `open` | `open` | interaction | 30000 ms | no | yes | Open a URL in the active Chrome tab or a new tab; explicit scoped policies use the bridge group. |
| `activate` | `activateTab` | interaction | 10000 ms | no | yes | Activate any Chrome tab and optionally focus its window. |
| `close-tab` | `closeTab` | interaction | 10000 ms | yes | yes | Close one Chrome tab. |
| `close-group` | `closeGroup` | interaction | 10000 ms | yes | yes | Close all tabs in the scoped bridge group. |
| `back` | `goBack` | interaction | 30000 ms | no | yes | Navigate the selected tab backward. |
| `forward` | `goForward` | interaction | 30000 ms | no | yes | Navigate the selected tab forward. |
| `reload` | `reloadTab` | interaction | 30000 ms | no | yes | Reload the selected tab. |
| `wait` | `waitForSelector` | read | 30000 ms | no | yes | Wait for a selector to appear in the selected tab. |
| `observe` | `observe` | read | 30000 ms | no | yes | Read ranked actionable elements with querySelector-verified selectors without mutating page state. |
| `act-preview` | `act-preview` | read | 30000 ms | no | yes | Plan one likely next browser action from intent and observed page state without mutating the page. |
| `act-apply` | `act-apply` | interaction | 30000 ms | yes | yes | Apply exactly one previously previewed action by id with confirmation, then return before/after evidence and a recommended next read. |
| `find-elements` | `findElements` | read | 30000 ms | no | yes | Filter ranked actionable elements with querySelector-verified selectors by role, text, nearby text, href, action, or risk. |
| `extract` | `extractPage` | read | 30000 ms | no | yes | Extract structured tables, form structure, lists, key-value blocks, or artifact-backed CPA offer presets without current form values. |
| `snapshot` | `snapshot` | read | 30000 ms | no | yes | Read a bounded structured page snapshot with optional full-page rendered text coverage. |
| `text` | `text` | read | 30000 ms | no | yes | Read bounded visible page text with optional full-page scroll-walk coverage. |
| `html` | `html` | read | 30000 ms | no | yes | Read bounded page HTML for a selector or the whole document. |
| `grep-page` | `grep-page` | read | 30000 ms | no | yes | Read page text into an artifact and print regex-matching snippets only. |
| `page-search` | `page-search` | read | 30000 ms | no | yes | Search full-page text with ranked snippets while keeping raw page text in local artifacts. |
| `links` | `links` | read | 30000 ms | no | yes | Read selector HTML into an artifact and print extracted links only. |
| `tables` | `tables` | read | 30000 ms | no | yes | Read selector HTML into an artifact and print extracted tables only. |
| `download-discovery` | `download-discovery` | read | 30000 ms | no | yes | Discover download and offline-export candidates without clicking or fetching candidate URLs. |
| `download` | `download` | interaction | 60000 ms | yes | yes | Click one confirmed selector, wait for exactly one browser download, and return local file metadata without file contents. |
| `screenshot` | `screenshot` | read | 30000 ms | no | yes | Capture a PNG screenshot of the selected tab, full page, or selector. |
| `pdf` | `printPdf` | read | 60000 ms | no | yes | Print the selected tab to a local PDF artifact. |
| `scroll` | `scroll` | interaction | 10000 ms | no | yes | Scroll the selected tab. |
| `set-viewport` | `setViewport` | interaction | 10000 ms | yes | yes | Apply confirmed viewport emulation to the selected tab until clear-emulation resets it. |
| `emulate-network` | `emulateNetwork` | interaction | 10000 ms | yes | yes | Apply confirmed bounded network emulation to the selected tab until clear-emulation resets it. |
| `clear-emulation` | `clearEmulation` | interaction | 10000 ms | yes | yes | Reset confirmed viewport and network emulation overrides for the selected tab. |
| `click` | `click` | interaction | 30000 ms | yes | yes | Click a selector in the selected tab. |
| `click-at` | `clickAt` | interaction | 30000 ms | yes | yes | Click viewport coordinates, optionally through trusted debugger input. |
| `hover` | `hover` | interaction | 30000 ms | no | yes | Hover an element or coordinates in the selected tab. |
| `drag-drop` | `dragDrop` | interaction | 30000 ms | yes | yes | Drag one element or coordinate point to another target in the selected tab. |
| `type` | `type` | interaction | 30000 ms | yes | yes | Type text into a selector, optionally through trusted debugger input. |
| `press` | `press` | interaction | 30000 ms | yes | yes | Press a keyboard key, optionally through trusted debugger input. |
| `select` | `select` | interaction | 30000 ms | yes | yes | Select an option in a select element. |
| `select-options` | `listSelectOptions` | read | 30000 ms | no | yes | Read available select options without returning current selection state. |
| `fill-form` | `fillForm` | interaction | 30000 ms | yes | yes | Preview or apply field values without submitting or returning raw field values. |
| `handle-dialog` | `handleDialog` | interaction | 30000 ms | yes | yes | Accept or dismiss the currently open JavaScript dialog. |
| `upload-file` | `uploadFile` | interaction | 60000 ms | yes | yes | Set local files on a file input through Chrome Debugger. |
| `trace-start` | `traceStart` | system | 30000 ms | yes | yes | Start bounded console and network metadata tracing. |
| `trace-summary` | `traceSummary` | read | 30000 ms | no | yes | Read trace session metadata without returning the trace event log. |
| `trace-events` | `traceEvents` | read | 30000 ms | no | yes | Read recent bounded trace events. |
| `diagnostics` | `diagnostics` | read | 30000 ms | no | yes | Read bounded page, trace, network-count, resource, and performance diagnostics without raw event logs. |
| `network-export` | `network-export` | read | 30000 ms | no | yes | Write redacted local network-export artifacts from recent trace events without dumping raw network logs to stdout. |
| `lighthouse-plan` | `lighthouse-plan` | read | 5000 ms | no | no | Print the exact local Lighthouse command and follow-up ingest command without running Lighthouse directly. |
| `lighthouse-ingest` | `lighthouse-ingest` | read | 5000 ms | no | no | Summarize a local Lighthouse JSON report into scores and failing audits. |
| `trace-stop` | `traceStop` | system | 30000 ms | no | yes | Stop tracing and return recent events. |
| `history` | `historySearch` | private-read | 30000 ms | yes | yes | Search Chrome history with explicit confirmation. |
| `bookmarks` | `bookmarksSearch` | private-read | 30000 ms | yes | yes | Search Chrome bookmarks with explicit confirmation. |
| `cookies` | `cookiesList` | private-read | 30000 ms | sensitive | yes | List Chrome cookie metadata; values require sensitive confirmation. |
| `storage` | `storageSnapshot` | private-read | 30000 ms | sensitive | yes | Read page storage keys; values require sensitive confirmation. |
| `request` | `fetchUrl` | private-read | 60000 ms | sensitive | yes | Run a bounded extension-context request; credentials require sensitive confirmation. |
| `ask` | `askUser` | system | 305000 ms | no | yes | Open a local prompt tab and wait for a user answer. |
| `session-summary` | `session-summary` | read | 30000 ms | no | yes | Summarize bridge health, workspace policy, scoped group state, and recommendations. |
| `recording-summary` | `recording-summary` | read | 5000 ms | no | no | Summarize an opt-in local action recording JSONL file and produce a human-reviewed replay-lite checklist. |
| `debug-bundle` | `debug-bundle` | read | 60000 ms | no | yes | Write a redacted local debug bundle with page artifacts and full trace events omitted unless requested. |
| `with-temp-tab` | `with-temp-tab` | interaction | 120000 ms | no | yes | Open a run-owned temporary scoped tab, run a bounded read command, and clean up the tab automatically. |
| `cleanup-run-tabs` | `cleanup-run-tabs` | interaction | 30000 ms | no | yes | Close tabs recorded as owned by a run id and remove them from local run state. |
| `last-artifact` | `last-artifact` | read | 5000 ms | no | no | Print metadata for the latest artifact recorded by metadata-first read outputs. |
| `read-artifact` | `read-artifact` | read | 5000 ms | no | no | Read a small head and grep slice from a local artifact without dumping the full file. |
| `command-catalog` | `command-catalog` | read | 5000 ms | no | no | Print this shared command registry as JSON or Markdown. |
| `advise` | `advise` | read | 5000 ms | no | no | Recommend the safest next CLI and MCP tools for a task without contacting Chrome. |
| `mcp-config` | `mcp-config` | read | 5000 ms | no | no | Print MCP client configuration snippets for Claude Code, Cursor, Codex, VS Code, Windsurf, Hermes, or generic stdio clients. |
| `mcp-write` | `mcp-write` | read | 5000 ms | no | no | Write or merge a project-local MCP client config file, or render one to an explicit path without touching user-global config by default. |
| `reload-extension` | `reloadExtension` | system | 5000 ms | yes | yes | Ask the unpacked extension to reload itself after local file edits; requires confirmation. |
| `self-test` | `self-test` | read | 10000 ms | no | no | Run static project parity checks without touching Chrome. |
| `runtime-smoke` | `runtime-smoke` | interaction | 180000 ms | no | yes | Run the real-browser fixture smoke test against the live bridge. |
| `doctor` | `doctor` | read | 10000 ms | no | optional | Inspect local installation paths offline; pass --live-checks to probe bridge health and Chrome settings. |
| `extension-path` | `extension-path` | read | 5000 ms | no | no | Print the unpacked extension directory path. |
| `codex-config` | `codex-config` | read | 5000 ms | no | no | Print the legacy Codex MCP configuration snippet using the current Node executable. |
<!-- END GENERATED CLI REFERENCE -->

## Safety Notes

<!-- BEGIN GENERATED CLI SAFETY NOTES -->
The safety notes below are generated from the shared registry by `npm run docs:commands`.

- `--confirm` is required for: `set-workspace`, `clear-workspace`, `adopt-tab`, `close-tab`, `close-group`, `act-apply`, `download`, `set-viewport`, `emulate-network`, `clear-emulation`, `click`, `click-at`, `drag-drop`, `type`, `press`, `select`, `fill-form`, `handle-dialog`, `upload-file`, `trace-start`, `history`, `bookmarks`, `reload-extension`.
- `--confirm` is conditionally required for: `windows`, `tabs`; use it with `--all` on scoped inventory commands.
- `--confirm-sensitive` is required in addition to `--confirm` for private-value requests exposed by: `cookies`, `storage`, `request`.
- Live bridge caution: run `reload-extension --confirm`, `doctor --live-checks`, and `runtime-smoke` only when no other session is using the bridge.
<!-- END GENERATED CLI SAFETY NOTES -->

## Server and Diagnostics

The command blocks below are generated from the shared registry by `npm run docs:commands`.

<!-- BEGIN GENERATED CLI USAGE: diagnostics -->
```bash
chrome-bridge health
chrome-bridge status [--token-budget]
chrome-bridge windows [--all --confirm] [--group-title <title>] [--group-color <color>]
chrome-bridge doctor [--live-checks] [--copy-path] [--open-extensions]
chrome-bridge extension-path
chrome-bridge advise --task <text> [--surface cli|mcp|both] [--risk read-only|confirmed-interaction|private-read] [--client claude-code|cursor|codex|vscode|windsurf|hermes|generic] [--live-bridge|--offline]
chrome-bridge mcp-config [--client all|claude-code|cursor|codex|vscode|windsurf|hermes|generic]
chrome-bridge mcp-write --client claude-code|cursor|codex|vscode|windsurf|hermes|generic [--root <dir>] [--out <file>] [--force]
chrome-bridge codex-config
chrome-bridge command-catalog [--markdown]
chrome-bridge lighthouse-plan --url <http(s)://...> [--out <file>] [--summary-out <file>] [--chrome-path <file>] [--chrome-flags <text>] [--emulated-form-factor desktop|mobile] [--only-categories <csv>]
chrome-bridge lighthouse-ingest --report <file> [--out <file>] [--max-audits 25]
chrome-bridge last-artifact [--artifact-dir <dir>]
chrome-bridge read-artifact --path <file> [--head <n>] [--grep <regex>] [--max-matches <n>]
chrome-bridge reload-extension --confirm
chrome-bridge self-test
chrome-bridge runtime-smoke [--keep-tab] [--coverage-plan] [--summary-only] [--out <file>]
```
<!-- END GENERATED CLI USAGE: diagnostics -->

## Tabs and Navigation

<!-- BEGIN GENERATED CLI USAGE: tabs-navigation -->
```bash
chrome-bridge group [--tabs] [--group-title <title>] [--group-color <color>]
chrome-bridge tabs [--json --summary-only] [--all --confirm] [--group-title <title>] [--group-color <color>]
chrome-bridge workspace [--tabs]
chrome-bridge set-workspace [--name <name>] [--group-title <title>] [--group-color <color>] [--policy-mode open|scoped|strict] --confirm
chrome-bridge clear-workspace --confirm
chrome-bridge ensure-tab [url] [--active] [--group-title <title>] [--group-color <color>]
chrome-bridge adopt-tab [--tab <id>] [--group-title <title>] [--group-color <color>] --confirm
chrome-bridge open <url> [--tab <id>] [--active] [--new] [--allow-external] [--group-title <title>] [--group-color <color>]
chrome-bridge with-temp-tab <url> [--run-id <id>] [--active] [--keep-tab] [--group-title <title>] [--group-color <color>] -- <text|snapshot|html|screenshot> [read flags]
chrome-bridge cleanup-run-tabs --run-id <id>
chrome-bridge activate [--tab <id>] [--focus-window] [--allow-external]
chrome-bridge close-tab [--tab <id>] --confirm [--allow-external]
chrome-bridge close-group [--group-title <title>] [--group-color <color>] --confirm
chrome-bridge back [--tab <id>] [--allow-external]
chrome-bridge forward [--tab <id>] [--allow-external]
chrome-bridge reload [--tab <id>] [--bypass-cache] [--allow-external]
```
<!-- END GENERATED CLI USAGE: tabs-navigation -->

By default, tab operations can target all Chrome tabs. Explicit `--group-title` or `--policy-mode scoped|strict` restores workspace grouping; session titles are only used for explicit group-oriented commands.

If the extension is enabled in multiple Chrome profiles, `chrome-bridge health` includes `extensions[]` entries for each connected profile. Set `CHROME_BRIDGE_PROFILE_ID` to the target `extensions[].info.profileId` or `extensions[].info.clientId` before running commands from a given shell. When multiple profiles are connected and no target is configured, direct commands fail with `AMBIGUOUS_EXTENSION_PROFILE` rather than controlling a random profile.

`workspace` reports the local workspace defaults, policy mode, group counts, and optionally grouped tabs. `set-workspace` stores local defaults for the group title/color and explicit policy mode. It requires `--confirm`. `open` allows all tabs by default, `scoped` keeps outside tabs explicit-only through `--allow-external`, and `strict` blocks outside tabs even when `--allow-external` is passed.

`close-tab` and `close-group` first try to mark scoped groups unsaved when the running Chrome exposes that API, then remove scoped tabs from their Chrome tab group before closing them. This helps prevent Chrome from leaving new saved closed `Codex Bridge` group chips under the URL bar after bridge cleanup. If Chrome cannot ungroup a grouped bridge tab, the close command fails closed instead of closing it in-place.

`tabs --all` and `windows --all` require `--confirm` because they can expose unrelated tab URLs and titles outside the scoped workspace group.

`doctor` is offline by default and reports local paths plus setup hints without contacting the bridge or Chrome. It also reports recommended MCP profiles per client and offline next actions such as `runtime-smoke --coverage-plan`, `advise --task "<goal>"`, `mcp-config --client ...`, and the new project-local installer path `mcp-write --client ...`. Use `--live-checks` only when no other session is using the bridge; it probes `/health`, verifies the live Native Messaging Host version, checks the extension version, and checks Chrome Apple Events settings. `--copy-path` writes the extension path to the clipboard, and `--open-extensions` opens Chrome's extensions page.

`mcp-write` writes or merges project-local MCP config files for Claude Code, Cursor, Codex, and VS Code without touching user-global config by default. Use `--root <dir>` to target another workspace, `--out <file>` to render an explicit file for Windsurf, Hermes, or generic hosts, and `--force` only when you intentionally want to overwrite a non-mergeable existing file.

`command-catalog` prints the shared registry metadata used by self-test and docs checks: extension action names, local diagnostic/tooling commands, risk tiers, default timeouts, live-bridge flags, CLI aliases, MCP tool names, direct `/command` payload keys, and confirmation requirements. Use `--markdown` for tables. The generated checked-in version is [COMMAND-CATALOG.md](COMMAND-CATALOG.md).

`reload-extension --confirm` asks the unpacked extension to reload itself after local extension file edits. Use it only after confirming no other session is relying on the current extension instance.

Navigation commands accept `http:`, `https:`, and `about:blank` URLs. Extension-context requests and cookie URL filters accept `http:` and `https:` URLs. Unsafe script/data/file-style URL schemes are rejected before a command reaches the extension.

## Existing-Tab Workflow

When the user already has the target page open in Chrome, adopt it first instead of opening a duplicate tab:

```bash
chrome-bridge tabs --all --confirm
chrome-bridge adopt-tab --tab <id> --confirm
chrome-bridge workspace --tabs
chrome-bridge observe --limit 30
chrome-bridge extract --kind forms
chrome-bridge debug-bundle --out <dir>
```

If the target page is the last focused Chrome tab, omit `--tab <id>` and run `chrome-bridge adopt-tab --confirm`. After adoption, normal scoped commands operate inside the configured workspace group, so use read-only discovery (`observe`, `find-elements`, `extract`, `snapshot`, `text`, screenshots, or PDF export) before any confirmed interaction.

## Page Reads

<!-- BEGIN GENERATED CLI USAGE: page-reads -->
```bash
chrome-bridge wait (--selector <css> | --ref <ref>) [--timeout-ms 10000] [--hidden-ok] [--tab <id>] [--allow-external]
chrome-bridge observe [--tab <id>] [--limit 80] [--max-text-chars 160] [--allow-external]
chrome-bridge act-preview --intent <text> [--tab <id>] [--max-candidates 5] [--risk read-only|confirmed-interaction|private-read] [--selector-preference stable|any] [--allow-external]
chrome-bridge act-apply --preview-id <id> --confirm [--text <text>] [--value <value> | --label <label> | --index <n>]
chrome-bridge find-elements [--role <role>] [--text <text>] [--near-text <text>] [--placeholder <text>] [--href <text>] [--action <kind>] [--risk <risk>] [--limit 80] [--tab <id>] [--allow-external]
chrome-bridge extract [--kind all|tables|forms|lists|keyValues] [--preset cpa-offer|article|product-page|pricing-table --network <name> --out <file> [--artifact-dir <dir>]] [--max-items 50] [--tab <id>] [--allow-external]
chrome-bridge snapshot [--tab <id>] [--max-chars 200000] [--full-page] [--wait-for-text <text>] [--wait-for-pattern <regex>] [--scroll-step-px <n>] [--max-scroll-steps <n>] [--scroll-delay-ms <n>] [--out <path>] [--summary-only] [--include-content] [--no-content] [--max-inline-chars 4000] [--allow-external]
chrome-bridge text [--tab <id>] [--max-chars 200000] [--full-page] [--wait-for-text <text>] [--wait-for-pattern <regex>] [--scroll-step-px <n>] [--max-scroll-steps <n>] [--scroll-delay-ms <n>] [--out <path>] [--summary-only] [--include-content] [--no-content] [--max-inline-chars 4000] [--allow-external]
chrome-bridge html [--tab <id>] [--selector <css> | --ref <ref>] [--max-chars 500000] [--out <path>] [--inner] [--summary-only] [--include-content] [--no-content] [--max-inline-chars 4000] [--allow-external]
chrome-bridge grep-page --pattern <regex> [--tab <id>] [--artifact-dir <dir>] [--max-matches 20] [--viewport-only] [--allow-external]
chrome-bridge page-search --query <text> [--tab <id>] [--artifact-dir <dir>] [--out <file>] [--max-matches 8] [--max-snippet-chars 320] [--viewport-only] [--allow-external]
chrome-bridge links [--selector <css>] [--tab <id>] [--artifact-dir <dir>] [--allow-external]
chrome-bridge tables [--selector <css>] [--tab <id>] [--artifact-dir <dir>] [--allow-external]
chrome-bridge download-discovery --out <file> [--selector <css>] [--tab <id>] [--artifact-dir <dir>] [--allow-external]
chrome-bridge screenshot [--tab <id>] --out <file> [--full-page] [--selector <css> | --ref <ref>] [--max-pixels <n>] [--fallback viewport|error] [--timeout-ms <n>] [--allow-external]
chrome-bridge pdf [--tab <id>] --out <file> [--landscape] [--omit-background] [--page-ranges <ranges>] [--scale <0.1-2>] [--allow-external]
chrome-bridge scroll --tab <id> --y <pixels> [--allow-external]
```
<!-- END GENERATED CLI USAGE: page-reads -->

`observe` is read-only. It returns ranked actionable elements with querySelector-verified selectors, labels, roles, suggested action kinds, and risk hints so agents can choose targets before using confirmed interaction commands. Short selectors use stable attributes when available; otherwise Chrome Bridge falls back to an `nth-of-type` path that resolves back to the observed element.

`observe` and `find-elements` target the main-frame light DOM. Their output includes `frameDiagnostics`, `shadowDiagnostics`, and `capabilityWarnings` so agents can detect iframe or shadow DOM boundaries instead of assuming every visible control is directly targetable by `elementRef`.

`page-search` is for large pages where a full `text --include-content` dump would be wasteful. It writes raw page text to a local artifact, writes a separate search artifact, and returns only ranked snippets plus artifact paths.

`act-preview` builds on `observe`: give it an intent like "click login", "open pricing", "search for \"wireless mouse\"", or "download report", and it will return ranked deterministic action candidates, risk flags, exact low-level CLI/MCP proposals, and an "ask user first" hint when the action still needs user input or looks risky. It never mutates the page.

`act-apply` is the bounded follow-up. It requires a previously issued `preview-id`, `--confirm`, and the same page state the preview saw. If the tab navigated, the preview expired, or the preview was already used, the command fails closed instead of improvising. On success it executes exactly one low-level action and returns before/after evidence plus the next recommended read.

`find-elements --near-text` filters candidates by nearby container text, which helps target controls next to a label, heading, or form section without requiring exact button text.

`extract --kind forms` returns form structure and field value state, but not current field values.

## Interactions

Interactions require `--confirm`.

Set `CHROME_BRIDGE_RECORDING_PATH=/tmp/chrome-bridge-actions.jsonl` to append redacted command metadata while using the CLI. Run `chrome-bridge recording-summary --recording /tmp/chrome-bridge-actions.jsonl` to produce a replay-lite checklist; it is intentionally human-reviewed and never auto-executes recorded actions.

<!-- BEGIN GENERATED CLI USAGE: interactions -->
```bash
chrome-bridge click --tab <id> (--selector <css> | --ref <ref>) --confirm [--allow-external]
chrome-bridge download (--selector <css> | --ref <ref>) --confirm [--download-timeout-ms <ms>] [--tab <id>] [--allow-external]
chrome-bridge click-at --x <px> --y <px> --confirm [--trusted] [--tab <id>] [--allow-external]
chrome-bridge hover [--selector <css> | --ref <ref>] [--x <px> --y <px>] [--trusted] [--tab <id>] [--allow-external]
chrome-bridge drag-drop (--selector <css> | --ref <ref> | --x <px> --y <px>) (--target-selector <css> | --target-ref <ref> | --target-x <px> --target-y <px>) --confirm [--trusted] [--tab <id>] [--allow-external]
chrome-bridge type --tab <id> (--selector <css> | --ref <ref>) --text <text> --confirm [--trusted] [--allow-external]
chrome-bridge press --key <key> --confirm [--selector <css> | --ref <ref>] [--trusted] [--tab <id>] [--allow-external]
chrome-bridge select (--selector <css> | --ref <ref>) --confirm [--value <value> | --label <label> | --index <n>] [--tab <id>] [--allow-external]
chrome-bridge select-options (--selector <css> | --ref <ref>) [--tab <id>] [--allow-external]
chrome-bridge fill-form --fields-json <json> [--dry-run] [--confirm] [--tab <id>] [--allow-external]
chrome-bridge handle-dialog --confirm [--dismiss] [--prompt-text <text>] [--tab <id>] [--allow-external]
chrome-bridge upload-file (--selector <css> | --ref <ref>) (--file <path> | --files-json <json>) --confirm [--tab <id>] [--allow-external]
```
<!-- END GENERATED CLI USAGE: interactions -->

Use `--trusted` when you need Chrome Debugger input events rather than DOM-dispatched events.

`fill-form` previews changes with `--dry-run`; applying values requires `--confirm`. It does not submit the form or return current/planned raw field values.

`select-options` lists available options without returning the current selected value or selected option.

`upload-file` accepts a single `--file` path or a `--files-json` array of string paths.

## Trace

<!-- BEGIN GENERATED CLI USAGE: trace -->
```bash
chrome-bridge trace-start --confirm [--tab <id>] [--max-events 500] [--no-network] [--no-console] [--include-extension-events] [--allow-external]
chrome-bridge trace-summary [--tab <id>] [--allow-external]
chrome-bridge trace-events [--tab <id>] [--limit 100] [--allow-external]
chrome-bridge diagnostics [--tab <id>] [--out <file>] [--allow-external]
chrome-bridge set-viewport --width <px> --height <px> --confirm [--device-scale-factor <n>] [--mobile] [--tab <id>] [--allow-external]
chrome-bridge emulate-network --profile offline|slow-3g|fast-3g|slow-4g|wifi|no-throttling|custom --confirm [--latency-ms <n>] [--download-kbps <n>] [--upload-kbps <n>] [--tab <id>] [--allow-external]
chrome-bridge clear-emulation --confirm [--tab <id>] [--allow-external]
chrome-bridge network-export [--tab <id>] [--artifact-dir <dir>] [--out <file>] [--requests-out <file>] [--har-out <file>] [--limit <n>] [--include-headers --confirm-sensitive] [--include-bodies --confirm-sensitive] [--allow-external]
chrome-bridge trace-stop [--tab <id>] [--limit 100] [--allow-external]
```
<!-- END GENERATED CLI USAGE: trace -->

Trace captures bounded console and network metadata. It does not capture request or response bodies. Use `trace-summary` when you only need active state, timing, and event counts without returning console or network event logs.

## Browser Data

These commands require `--confirm`.

<!-- BEGIN GENERATED CLI USAGE: browser-data -->
```bash
chrome-bridge history [--query <text>] --confirm [--limit 25] [--start-time <ms>] [--end-time <ms>]
chrome-bridge bookmarks [--query <text>] --confirm [--limit 50]
chrome-bridge cookies [--url <url> | --domain <domain>] --confirm [--include-values --confirm-sensitive] [--limit 50]
chrome-bridge storage [--tab <id>] --confirm [--include-values --confirm-sensitive] [--allow-external]
chrome-bridge request <url> --confirm [--method GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS] [--headers-json <json>] [--body <text>] [--credentials include --confirm-sensitive] [--max-chars 20000] [--request-timeout-ms 60000]
```
<!-- END GENERATED CLI USAGE: browser-data -->

Cookie values, whole-cookie-jar queries, storage values, and credentialed requests require `--confirm-sensitive`.

## Human-in-the-Loop

<!-- BEGIN GENERATED CLI USAGE: human-in-the-loop -->
```bash
chrome-bridge ask --question <text> [--choices-json <json>] [--no-text] [--timeout-ms 300000] [--keep-tab]
chrome-bridge session-summary
chrome-bridge recording-summary --recording <file> [--limit 500] [--out <file>]
chrome-bridge debug-bundle --out <dir> [--tab <id>] [--allow-external] [--include-snapshot] [--include-observe] [--include-screenshot] [--include-trace-events]
```
<!-- END GENERATED CLI USAGE: human-in-the-loop -->

The command opens a local extension page inside the active scoped group and waits for the user to respond.

`--choices-json` accepts either strings or `{ "value": "...", "label": "..." }` objects:

```bash
chrome-bridge ask --question "Continue?" --choices-json '["Yes","No"]' --no-text
```

`session-summary` includes bridge health, scoped group state, workspace policy state, concrete `nextActions`, and recommendations such as Native Messaging Host restart, extension reload, first-tab setup, or active `strict` policy warnings. `debug-bundle` writes the same summary into `session-summary.json`.

`debug-bundle` redacts URL/title/text/value fields in its default JSON files and writes `trace-summary.json` rather than full trace events. Use `--include-snapshot`, `--include-observe`, `--include-screenshot`, or `--include-trace-events` only when the resulting local bundle may safely contain page text, element labels, pixels, URLs, or console/log text from the active browser page.
