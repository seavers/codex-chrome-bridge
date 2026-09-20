# Chrome Extension Setup

Chrome MCP Bridge, formerly Codex Chrome Bridge, uses an unpacked Chrome extension from the `extension/` directory.

For client-specific install shortcuts, see [INSTALL.md](INSTALL.md). For Chrome Web Store readiness and packaging, use `npm run extension:zip`, the privacy text in [PRIVACY-POLICY.md](PRIVACY-POLICY.md), and the submission packet in [CHROME-WEB-STORE.md](CHROME-WEB-STORE.md).

## Install

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select the `extension/` folder from this repository.
5. Install the Native Messaging Host using the extension ID shown in `chrome://extensions/`:

```bash
npm run install:native-host -- <extension-id>
```

6. Check health:

```bash
node ./bin/chrome-bridge.mjs health
```

The extension is ready when `extension.connected` is `true`, `extension.info.version` matches `package.json`, and the health response reports `native-messaging+unix-socket`.

## Packaging

Create a Chrome Web Store style zip from the exact checked-in extension tree with:

```bash
npm run extension:zip
```

This writes a deterministic archive under `dist/` and excludes repo-only files outside `extension/`. Verify it with:

```bash
npm run check:extension-package
```

The repository now includes store-readiness docs, but submission itself remains a manual maintainer decision.

## Reload After Edits

If extension permissions or source files change, reload the unpacked extension in `chrome://extensions/`.

Once the extension is connected, future source edits can often be applied with:

```bash
node ./bin/chrome-bridge.mjs reload-extension --confirm
```

Permission changes still require a manual Chrome extension reload.

## Human Prompt Page

`ask.html` is a local extension page used by the `ask` CLI command and `chrome_bridge_ask_user` MCP tool. It opens inside the `Codex Bridge` tab group and sends the user's answer back to the extension background script.

Prompt cleanup uses the same saved-group feature detection and ungroup-before-close path as `close-tab` and `close-group`, so short-lived prompt tabs do not leave behind new saved closed `Codex Bridge` groups when Chrome cleanup runs. The background service worker also sweeps existing managed groups on startup and registers tab-group create/update/removal plus tab membership listeners that re-apply the best-effort unsaved marker to managed Codex groups when Chrome exposes that surface. Managed detection includes `Codex Bridge ...` session titles, bridge-created workspace titles remembered in extension-local storage, and session-scoped bridge-created group IDs remembered only in Chrome session storage.

## Permissions

The extension currently requests:

- `activeTab`
- `alarms`
- `bookmarks`
- `cookies`
- `debugger`
- `history`
- `offscreen`
- `scripting`
- `storage`
- `tabGroups`
- `tabs`
- `<all_urls>` host permissions

These permissions are broad because the tool works with real Chrome tabs. Use this only with a local bridge server you control.

See [PRIVACY-POLICY.md](PRIVACY-POLICY.md) for the plain-language privacy statement intended for distribution pages and store submission forms.
