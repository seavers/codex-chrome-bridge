# Chrome Web Store Submission Packet

This packet prepares Chrome MCP Bridge for a manual Chrome Web Store submission. It does not mean the extension has already been submitted or approved.

## Listing Copy

Name:

Chrome MCP Bridge

Short description:

Local MCP bridge that lets AI agents inspect and control your real Chrome profile with scoped tabs and explicit safety gates.

Detailed description:

Chrome MCP Bridge connects MCP-capable AI tools to your local Google Chrome profile through a Chrome extension, local loopback Native Messaging Host, CLI, and MCP server. It is designed for read-first workflows where an agent needs to inspect a logged-in dashboard, browser-authenticated page, report, or admin tool that is already available in your Chrome profile.

The extension works with a local server bound to `127.0.0.1`. It does not send browser activity to a remote backend, does not include analytics, and does not provide CAPTCHA bypass or credential extraction. Sensitive browser reads and mutating actions are guarded by explicit confirmation flags in the CLI/MCP layer.

Primary use cases:

- Inspect logged-in dashboards from Claude Code, Cursor, Codex, VS Code, Windsurf, Hermes Agent, or another MCP client.
- Read page text, HTML, structured snapshots, tables, links, forms, screenshots, PDFs, and diagnostics.
- Keep agent work inside a scoped Chrome tab group.
- Use local artifacts instead of dumping large page contents into chat context.
- Confirm interactions before clicking, typing, selecting, uploading, downloading, or reading private browser data.

## Category

Recommended category:

Developer Tools

## Permission Justification

- `activeTab`: access the current scoped tab after the user or bridge selects it.
- `tabs`: list, create, update, activate, and close scoped bridge tabs.
- `tabGroups`: create and maintain the bridge-owned tab group.
- `scripting`: run bounded read/interaction scripts in selected tabs.
- `debugger`: capture screenshots/PDFs, trusted input, file uploads, emulation, and trace events through Chrome Debugger Protocol.
- `downloads`: detect and summarize a single confirmed download without reading file contents.
- `cookies`: read cookie metadata or values only when the caller uses the sensitive confirmation gate.
- `history`: search browser history only when the caller confirms the read.
- `bookmarks`: search bookmarks only when the caller confirms the read.
- `storage`: store local bridge workspace state and inspect page storage only behind confirmation gates.
- `nativeMessaging`: connect the extension service worker to the local bridge host.
- `alarms`: keep extension lifecycle checks lightweight and local.
- `<all_urls>`: support the user's real logged-in Chrome pages across sites after explicit scoping and confirmation.

## Data Use Answers

- Remote code: no remote code execution or remote script loading.
- Analytics: no analytics.
- Ads: no advertising.
- Sale of data: no sale, transfer, or brokerage of user data.
- External backend: no hosted backend for browser activity.
- Local network: communicates with the local Native Messaging Host through the per-user Unix Socket.
- User content: page content may be read locally by explicit CLI/MCP commands.
- Authentication data: cookies can be read only through confirmed sensitive commands; the default browser workflow does not expose cookie values.
- File contents: downloads return local file metadata only; file contents are not uploaded or inlined by default.

## Screenshots To Prepare

Capture these before submission:

- `chrome://extensions` with the unpacked extension loaded.
- A scoped `Chrome MCP Bridge` or session-named tab group.
- `chrome-bridge doctor --live-checks` passing in a terminal.
- A safe public fixture page inspected through `observe`.
- A local artifact output example, such as a screenshot or PDF saved to `/tmp`.

## Manual Submission Checklist

1. Run `npm run check`.
2. Run `npm run check:audit`.
3. Run `npm run check:pack`.
4. Run `npm run extension:zip`.
5. Reload the unpacked extension with `node ./bin/chrome-bridge.mjs reload-extension --confirm`.
6. Run `node ./bin/chrome-bridge.mjs doctor --live-checks`.
7. Run `node ./bin/chrome-bridge.mjs runtime-smoke --summary-only --out /tmp/chrome-bridge-runtime-smoke.json`.
8. Review [PRIVACY-POLICY.md](PRIVACY-POLICY.md).
9. Upload the generated extension zip from `dist/`.
10. Use the listing copy and permission explanations from this packet.

## Reviewer Notes

Chrome MCP Bridge is a developer tool. It is intentionally local-first and should be reviewed as a local extension plus loopback bridge workflow. The broad permissions support real-profile developer automation across arbitrary pages, but the CLI/MCP layer keeps sensitive reads and mutations behind explicit confirmation gates.
