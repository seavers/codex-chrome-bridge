# Chrome Bridge Command Catalog

Version: 0.4.1

| Action | Category | Risk | Default Timeout | CLI | MCP | Confirm | Direct Payload Keys | Summary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| windows | scope | read | 10000 ms | windows | chrome_bridge_windows | conditional | includeAll, groupTitle, groupColor, confirmed | List all Chrome windows by default; pass includeAll=false with an explicit group to limit the result. |
| tabs | scope | read | 10000 ms | tabs | chrome_bridge_tabs | conditional | includeAll, groupTitle, groupColor, confirmed | List all Chrome tabs by default; pass includeAll=false with an explicit group to limit the result. |
| group | scope | read | 10000 ms | group | chrome_bridge_group | no | includeTabs, groupTitle, groupColor | Show the current scoped Chrome tab group and its tabs. |
| workspace | scope | read | 10000 ms | workspace | chrome_bridge_workspace | no | includeTabs | Show local workspace defaults, policy mode, and group counts. |
| setWorkspace | scope | system | 10000 ms | set-workspace | chrome_bridge_set_workspace | yes | name, groupTitle, groupColor, policyMode, confirmed | Set local workspace group title, color, and open/scoped/strict policy defaults. |
| clearWorkspace | scope | system | 10000 ms | clear-workspace | chrome_bridge_clear_workspace | yes | confirmed | Clear local workspace defaults and return to the default open policy. |
| ensureTab | navigation | system | 30000 ms | ensure-tab | chrome_bridge_ensure_tab | no | url, active, groupTitle, groupColor | Create or recover the active Chrome work tab; explicit scoped policies still use a dedicated group. |
| adoptTab | navigation | interaction | 30000 ms | adopt-tab | chrome_bridge_adopt_tab | yes | tabId, confirmed, groupTitle, groupColor | Adopt an already-open Chrome tab into an explicit scoped bridge group. |
| open | navigation | interaction | 30000 ms | open | chrome_bridge_open | no | tabId, allowExternal, groupTitle, groupColor, url, active, newTab | Open a URL in the active Chrome tab or a new tab; explicit scoped policies use the bridge group. |
| activateTab | navigation | interaction | 10000 ms | activate | chrome_bridge_activate_tab | no | tabId, allowExternal, groupTitle, groupColor, focusWindow | Activate any Chrome tab and optionally focus its window. |
| closeTab | navigation | interaction | 10000 ms | close-tab | chrome_bridge_close_tab | yes | tabId, allowExternal, groupTitle, groupColor, confirmed | Close one Chrome tab. |
| closeGroup | navigation | interaction | 10000 ms | close-group | chrome_bridge_close_group | yes | confirmed, groupTitle, groupColor | Close all tabs in the scoped bridge group. |
| goBack | navigation | interaction | 30000 ms | back | chrome_bridge_back | no | tabId, allowExternal, groupTitle, groupColor, timeoutMs | Navigate the selected tab backward. |
| goForward | navigation | interaction | 30000 ms | forward | chrome_bridge_forward | no | tabId, allowExternal, groupTitle, groupColor, timeoutMs | Navigate the selected tab forward. |
| reloadTab | navigation | interaction | 30000 ms | reload | chrome_bridge_reload_tab | no | tabId, allowExternal, groupTitle, groupColor, bypassCache, timeoutMs | Reload the selected tab. |
| waitForSelector | read | read | 30000 ms | wait | chrome_bridge_wait_for_selector | no | tabId, allowExternal, groupTitle, groupColor, selector, elementRef, timeoutMs, visible | Wait for a selector to appear in the selected tab. |
| observe | read | read | 30000 ms | observe | chrome_bridge_observe | no | tabId, allowExternal, groupTitle, groupColor, limit, maxTextChars, role, text, nearText, placeholder, href, actionKind, risk | Read ranked actionable elements with querySelector-verified selectors without mutating page state. |
| findElements | read | read | 30000 ms | find-elements | chrome_bridge_find_elements | no | tabId, allowExternal, groupTitle, groupColor, limit, maxTextChars, role, text, nearText, placeholder, href, actionKind, risk | Filter ranked actionable elements with querySelector-verified selectors by role, text, nearby text, href, action, or risk. |
| extractPage | read | read | 30000 ms | extract | chrome_bridge_extract | no | tabId, allowExternal, groupTitle, groupColor, kind, maxItems, maxTextChars | Extract structured tables, form structure, lists, key-value blocks, or artifact-backed CPA offer presets without current form values. |
| snapshot | read | read | 30000 ms | snapshot | chrome_bridge_snapshot | no | tabId, allowExternal, groupTitle, groupColor, maxChars, fullPage, waitForText, waitForPattern, scrollStepPx, maxScrollSteps, scrollDelayMs | Read a bounded structured page snapshot with optional full-page rendered text coverage. |
| text | read | read | 30000 ms | text | chrome_bridge_text | no | tabId, allowExternal, groupTitle, groupColor, maxChars, fullPage, waitForText, waitForPattern, scrollStepPx, maxScrollSteps, scrollDelayMs | Read bounded visible page text with optional full-page scroll-walk coverage. |
| html | read | read | 30000 ms | html | chrome_bridge_html | no | tabId, allowExternal, groupTitle, groupColor, maxChars, selector, elementRef, outer | Read bounded page HTML for a selector or the whole document. |
| diagnostics | debug | read | 30000 ms | diagnostics | chrome_bridge_diagnostics | no | tabId, allowExternal, groupTitle, groupColor | Read bounded page, trace, network-count, resource, and performance diagnostics without raw event logs. |
| screenshot | artifact | read | 30000 ms | screenshot | chrome_bridge_screenshot | no | tabId, allowExternal, groupTitle, groupColor, fullPage, selector, elementRef, maxPixels, fallback | Capture a PNG screenshot of the selected tab, full page, or selector. |
| printPdf | artifact | read | 60000 ms | pdf | chrome_bridge_pdf | no | tabId, allowExternal, groupTitle, groupColor, landscape, printBackground, preferCssPageSize, pageRanges, scale | Print the selected tab to a local PDF artifact. |
| listSelectOptions | read | read | 30000 ms | select-options | chrome_bridge_select_options | no | tabId, allowExternal, groupTitle, groupColor, selector, elementRef | Read available select options without returning current selection state. |
| scroll | interaction | interaction | 10000 ms | scroll | chrome_bridge_scroll | no | tabId, allowExternal, groupTitle, groupColor, x, y | Scroll the selected tab. |
| setViewport | debug | interaction | 10000 ms | set-viewport | chrome_bridge_set_viewport | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, width, height, deviceScaleFactor, mobile | Apply confirmed viewport emulation to the selected tab until clear-emulation resets it. |
| emulateNetwork | debug | interaction | 10000 ms | emulate-network | chrome_bridge_emulate_network | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, networkProfile, latencyMs, downloadKbps, uploadKbps | Apply confirmed bounded network emulation to the selected tab until clear-emulation resets it. |
| clearEmulation | debug | interaction | 10000 ms | clear-emulation | chrome_bridge_clear_emulation | yes | tabId, allowExternal, groupTitle, groupColor, confirmed | Reset confirmed viewport and network emulation overrides for the selected tab. |
| click | interaction | interaction | 30000 ms | click | chrome_bridge_click | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, selector, elementRef | Click a selector in the selected tab. |
| download | interaction | interaction | 60000 ms | download | chrome_bridge_download | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, selector, elementRef, downloadTimeoutMs | Click one confirmed selector, wait for exactly one browser download, and return local file metadata without file contents. |
| clickAt | interaction | interaction | 30000 ms | click-at | chrome_bridge_click_at | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, x, y, button, trusted | Click viewport coordinates, optionally through trusted debugger input. |
| hover | interaction | interaction | 30000 ms | hover | chrome_bridge_hover | no | tabId, allowExternal, groupTitle, groupColor, selector, elementRef, x, y, trusted | Hover an element or coordinates in the selected tab. |
| dragDrop | interaction | interaction | 30000 ms | drag-drop | chrome_bridge_drag_drop | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, selector, elementRef, targetSelector, targetElementRef, x, y, targetX, targetY, trusted | Drag one element or coordinate point to another target in the selected tab. |
| type | interaction | interaction | 30000 ms | type | chrome_bridge_type | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, selector, elementRef, text, trusted | Type text into a selector, optionally through trusted debugger input. |
| press | interaction | interaction | 30000 ms | press | chrome_bridge_press | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, selector, elementRef, key, code, ctrlKey, metaKey, altKey, shiftKey, trusted | Press a keyboard key, optionally through trusted debugger input. |
| select | interaction | interaction | 30000 ms | select | chrome_bridge_select | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, selector, elementRef, value, label, index | Select an option in a select element. |
| fillForm | interaction | interaction | 30000 ms | fill-form | chrome_bridge_fill_form | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, fields, dryRun | Preview or apply field values without submitting or returning raw field values. |
| handleDialog | interaction | interaction | 30000 ms | handle-dialog | chrome_bridge_handle_dialog | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, accept, promptText | Accept or dismiss the currently open JavaScript dialog. |
| uploadFile | interaction | interaction | 60000 ms | upload-file | chrome_bridge_upload_file | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, selector, elementRef, file, files | Set local files on a file input through Chrome Debugger. |
| traceStart | debug | system | 30000 ms | trace-start | chrome_bridge_trace_start | yes | tabId, allowExternal, groupTitle, groupColor, confirmed, maxEvents, network, console, includeExtensionEvents | Start bounded console and network metadata tracing. |
| traceSummary | debug | read | 30000 ms | trace-summary | chrome_bridge_trace_summary | no | tabId, allowExternal, groupTitle, groupColor | Read trace session metadata without returning the trace event log. |
| traceEvents | debug | read | 30000 ms | trace-events | chrome_bridge_trace_events | no | tabId, allowExternal, groupTitle, groupColor, limit | Read recent bounded trace events. |
| traceStop | debug | system | 30000 ms | trace-stop | chrome_bridge_trace_stop | no | tabId, allowExternal, groupTitle, groupColor, limit | Stop tracing and return recent events. |
| historySearch | private-read | private-read | 30000 ms | history | chrome_bridge_history_search | yes | query, limit, startTime, endTime, confirmed | Search Chrome history with explicit confirmation. |
| bookmarksSearch | private-read | private-read | 30000 ms | bookmarks | chrome_bridge_bookmarks_search | yes | query, limit, confirmed | Search Chrome bookmarks with explicit confirmation. |
| cookiesList | private-read | private-read | 30000 ms | cookies | chrome_bridge_cookies_list | sensitive | url, domain, name, limit, includeValues, confirmed, confirmSensitive | List Chrome cookie metadata; values require sensitive confirmation. |
| storageSnapshot | private-read | private-read | 30000 ms | storage | chrome_bridge_storage_snapshot | sensitive | tabId, allowExternal, groupTitle, groupColor, confirmed, confirmSensitive, includeValues, maxValueChars | Read page storage keys; values require sensitive confirmation. |
| fetchUrl | private-read | private-read | 60000 ms | request | chrome_bridge_request | sensitive | url, method, headers, body, credentials, maxChars, requestTimeoutMs, confirmed, confirmSensitive | Run a bounded extension-context request; credentials require sensitive confirmation. |
| askUser | human | system | 305000 ms | ask | chrome_bridge_ask_user | no | question, choices, allowText, closeOnAnswer, timeoutMs | Open a local prompt tab and wait for a user answer. |
| reloadExtension | system | system | 5000 ms | reload-extension | chrome_bridge_reload_extension | yes | confirmed | Ask the unpacked extension to reload itself after local file edits; requires confirmation. |

## Local Commands And Tools

| ID | Category | Risk | Default Timeout | CLI | MCP | Live Bridge | Summary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| health | diagnostic | read | 10000 ms | health | chrome_bridge_health | yes | Read local bridge health and extension connection status. |
| status | diagnostic | read | 30000 ms | status | - | yes | Print cheap-first bridge status and token-budget recommendations. |
| session-summary | diagnostic | read | 30000 ms | session-summary | chrome_bridge_session_summary | yes | Summarize bridge health, workspace policy, scoped group state, and recommendations. |
| debug-bundle | debug | read | 60000 ms | debug-bundle | chrome_bridge_debug_bundle | yes | Write a redacted local debug bundle with page artifacts and full trace events omitted unless requested. |
| recording-summary | artifact | read | 5000 ms | recording-summary | chrome_bridge_recording_summary | no | Summarize an opt-in local action recording JSONL file and produce a human-reviewed replay-lite checklist. |
| with-temp-tab | navigation | interaction | 120000 ms | with-temp-tab | - | yes | Open a run-owned temporary scoped tab, run a bounded read command, and clean up the tab automatically. |
| cleanup-run-tabs | navigation | interaction | 30000 ms | cleanup-run-tabs | - | yes | Close tabs recorded as owned by a run id and remove them from local run state. |
| last-artifact | artifact | read | 5000 ms | last-artifact | - | no | Print metadata for the latest artifact recorded by metadata-first read outputs. |
| read-artifact | artifact | read | 5000 ms | read-artifact | - | no | Read a small head and grep slice from a local artifact without dumping the full file. |
| grep-page | read | read | 30000 ms | grep-page | - | yes | Read page text into an artifact and print regex-matching snippets only. |
| page-search | read | read | 30000 ms | page-search | chrome_bridge_page_search | yes | Search full-page text with ranked snippets while keeping raw page text in local artifacts. |
| links | read | read | 30000 ms | links | - | yes | Read selector HTML into an artifact and print extracted links only. |
| tables | read | read | 30000 ms | tables | - | yes | Read selector HTML into an artifact and print extracted tables only. |
| download-discovery | read | read | 30000 ms | download-discovery | chrome_bridge_download_discovery | yes | Discover download and offline-export candidates without clicking or fetching candidate URLs. |
| act-preview | read | read | 30000 ms | act-preview | chrome_bridge_act_preview | yes | Plan one likely next browser action from intent and observed page state without mutating the page. |
| act-apply | interaction | interaction | 30000 ms | act-apply | chrome_bridge_act_apply | yes | Apply exactly one previously previewed action by id with confirmation, then return before/after evidence and a recommended next read. |
| lighthouse-ingest | diagnostic | read | 5000 ms | lighthouse-ingest | chrome_bridge_lighthouse_ingest | no | Summarize a local Lighthouse JSON report into scores and failing audits. |
| lighthouse-plan | diagnostic | read | 5000 ms | lighthouse-plan | chrome_bridge_lighthouse_plan | no | Print the exact local Lighthouse command and follow-up ingest command without running Lighthouse directly. |
| network-export | debug | read | 30000 ms | network-export | chrome_bridge_network_export | yes | Write redacted local network-export artifacts from recent trace events without dumping raw network logs to stdout. |
| command-catalog | diagnostic | read | 5000 ms | command-catalog | chrome_bridge_command_catalog | no | Print this shared command registry as JSON or Markdown. |
| advise | diagnostic | read | 5000 ms | advise | chrome_bridge_tool_advisor | no | Recommend the safest next CLI and MCP tools for a task without contacting Chrome. |
| mcp-config | diagnostic | read | 5000 ms | mcp-config | chrome_bridge_mcp_config | no | Print MCP client configuration snippets for Claude Code, Cursor, Codex, VS Code, Windsurf, Hermes, or generic stdio clients. |
| mcp-write | diagnostic | read | 5000 ms | mcp-write | - | no | Write or merge a project-local MCP client config file, or render one to an explicit path without touching user-global config by default. |
| self-test | verification | read | 10000 ms | self-test | chrome_bridge_self_test | no | Run static project parity checks without touching Chrome. |
| runtime-smoke | verification | interaction | 180000 ms | runtime-smoke | chrome_bridge_runtime_smoke | yes | Run the real-browser fixture smoke test against the live bridge. |
| doctor | diagnostic | read | 10000 ms | doctor | chrome_bridge_doctor | optional | Inspect local installation paths offline; pass --live-checks to probe bridge health and Chrome settings. |
| extension-path | diagnostic | read | 5000 ms | extension-path | chrome_bridge_extension_path | no | Print the unpacked extension directory path. |
| codex-config | diagnostic | read | 5000 ms | codex-config | chrome_bridge_codex_config | no | Print the legacy Codex MCP configuration snippet using the current Node executable. |

## CLI Usage Signatures

```text
chrome-bridge health
chrome-bridge windows [--all --confirm] [--group-title <title>] [--group-color <color>]
chrome-bridge group [--tabs] [--group-title <title>] [--group-color <color>]
chrome-bridge tabs [--json --summary-only] [--all --confirm] [--group-title <title>] [--group-color <color>]
chrome-bridge workspace [--tabs]
chrome-bridge set-workspace [--name <name>] [--group-title <title>] [--group-color <color>] [--policy-mode open|scoped|strict] --confirm
chrome-bridge clear-workspace --confirm
chrome-bridge ensure-tab [url] [--active] [--group-title <title>] [--group-color <color>]
chrome-bridge adopt-tab [--tab <id>] [--group-title <title>] [--group-color <color>] --confirm
chrome-bridge open <url> [--tab <id>] [--active] [--new] [--allow-external] [--group-title <title>] [--group-color <color>]
chrome-bridge activate [--tab <id>] [--focus-window] [--allow-external]
chrome-bridge close-tab [--tab <id>] --confirm [--allow-external]
chrome-bridge close-group [--group-title <title>] [--group-color <color>] --confirm
chrome-bridge back [--tab <id>] [--allow-external]
chrome-bridge forward [--tab <id>] [--allow-external]
chrome-bridge reload [--tab <id>] [--bypass-cache] [--allow-external]
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
chrome-bridge download (--selector <css> | --ref <ref>) --confirm [--download-timeout-ms <ms>] [--tab <id>] [--allow-external]
chrome-bridge screenshot [--tab <id>] --out <file> [--full-page] [--selector <css> | --ref <ref>] [--max-pixels <n>] [--fallback viewport|error] [--timeout-ms <n>] [--allow-external]
chrome-bridge pdf [--tab <id>] --out <file> [--landscape] [--omit-background] [--page-ranges <ranges>] [--scale <0.1-2>] [--allow-external]
chrome-bridge scroll --tab <id> --y <pixels> [--allow-external]
chrome-bridge set-viewport --width <px> --height <px> --confirm [--device-scale-factor <n>] [--mobile] [--tab <id>] [--allow-external]
chrome-bridge emulate-network --profile offline|slow-3g|fast-3g|slow-4g|wifi|no-throttling|custom --confirm [--latency-ms <n>] [--download-kbps <n>] [--upload-kbps <n>] [--tab <id>] [--allow-external]
chrome-bridge clear-emulation --confirm [--tab <id>] [--allow-external]
chrome-bridge click --tab <id> (--selector <css> | --ref <ref>) --confirm [--allow-external]
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
chrome-bridge trace-start --confirm [--tab <id>] [--max-events 500] [--no-network] [--no-console] [--include-extension-events] [--allow-external]
chrome-bridge trace-summary [--tab <id>] [--allow-external]
chrome-bridge trace-events [--tab <id>] [--limit 100] [--allow-external]
chrome-bridge diagnostics [--tab <id>] [--out <file>] [--allow-external]
chrome-bridge network-export [--tab <id>] [--artifact-dir <dir>] [--out <file>] [--requests-out <file>] [--har-out <file>] [--limit <n>] [--include-headers --confirm-sensitive] [--include-bodies --confirm-sensitive] [--allow-external]
chrome-bridge lighthouse-plan --url <http(s)://...> [--out <file>] [--summary-out <file>] [--chrome-path <file>] [--chrome-flags <text>] [--emulated-form-factor desktop|mobile] [--only-categories <csv>]
chrome-bridge lighthouse-ingest --report <file> [--out <file>] [--max-audits 25]
chrome-bridge trace-stop [--tab <id>] [--limit 100] [--allow-external]
chrome-bridge history [--query <text>] --confirm [--limit 25] [--start-time <ms>] [--end-time <ms>]
chrome-bridge bookmarks [--query <text>] --confirm [--limit 50]
chrome-bridge cookies [--url <url> | --domain <domain>] --confirm [--include-values --confirm-sensitive] [--limit 50]
chrome-bridge storage [--tab <id>] --confirm [--include-values --confirm-sensitive] [--allow-external]
chrome-bridge request <url> --confirm [--method GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS] [--headers-json <json>] [--body <text>] [--credentials include --confirm-sensitive] [--max-chars 20000] [--request-timeout-ms 60000]
chrome-bridge ask --question <text> [--choices-json <json>] [--no-text] [--timeout-ms 300000] [--keep-tab]
chrome-bridge session-summary
chrome-bridge recording-summary --recording <file> [--limit 500] [--out <file>]
chrome-bridge debug-bundle --out <dir> [--tab <id>] [--allow-external] [--include-snapshot] [--include-observe] [--include-screenshot] [--include-trace-events]
chrome-bridge with-temp-tab <url> [--run-id <id>] [--active] [--keep-tab] [--group-title <title>] [--group-color <color>] -- <text|snapshot|html|screenshot> [read flags]
chrome-bridge cleanup-run-tabs --run-id <id>
chrome-bridge status [--token-budget]
chrome-bridge last-artifact [--artifact-dir <dir>]
chrome-bridge read-artifact --path <file> [--head <n>] [--grep <regex>] [--max-matches <n>]
chrome-bridge command-catalog [--markdown]
chrome-bridge advise --task <text> [--surface cli|mcp|both] [--risk read-only|confirmed-interaction|private-read] [--client claude-code|cursor|codex|vscode|windsurf|hermes|generic] [--live-bridge|--offline]
chrome-bridge mcp-config [--client all|claude-code|cursor|codex|vscode|windsurf|hermes|generic]
chrome-bridge mcp-write --client claude-code|cursor|codex|vscode|windsurf|hermes|generic [--root <dir>] [--out <file>] [--force]
chrome-bridge reload-extension --confirm
chrome-bridge self-test
chrome-bridge runtime-smoke [--keep-tab] [--coverage-plan] [--summary-only] [--out <file>]
chrome-bridge doctor [--live-checks] [--copy-path] [--open-extensions]
chrome-bridge extension-path
chrome-bridge codex-config
```

## Debugger-Serialized Actions

These extension actions use the Chrome Debugger API and are serialized per tab by the extension:

- `screenshot`
- `printPdf`
- `setViewport`
- `emulateNetwork`
- `clearEmulation`
- `clickAt`
- `hover`
- `dragDrop`
- `type`
- `press`
- `handleDialog`
- `uploadFile`
- `traceStart`
- `traceStop`
