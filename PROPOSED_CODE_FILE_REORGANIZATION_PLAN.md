# Proposed Code File Reorganization Plan

Status: primary implementation wave completed on 2026-06-12. Public entrypoints remain stable while the scripts taxonomy, shared command registry, CLI entrypoint, MCP entrypoint, and page-scripts wrapper split are now enforced by dedicated checks.

Implemented phases:

- Phase 0: reorganization guardrails.
- Phase 1: scripts taxonomy.
- Phase 2: `shared/command-registry.mjs` stable wrapper plus `shared/registry/` modules.
- Phase 3: `bin/chrome-bridge.mjs` stable wrapper plus `bin/cli/main.mjs`.
- Phase 4: `mcp/chrome-bridge-mcp.mjs` stable wrapper plus `mcp/server/main.mjs`.
- Phase 5: `extension/page-scripts.js` stable wrapper plus `extension/page-scripts/main.js`.

Deferred decisions:

- Phase 6 extension folder grouping and Phase 7 server split remain optional future work because their blast radius is higher and the current modules are still cohesive enough.

This plan applies Jeffrey's "Code Reorganizer" workflow to Chrome MCP Bridge. I inspected the current runtime folders, file sizes, import surfaces, command registry, extension manifest constraints, and the architecture document before proposing changes.

## Executive Summary

The repository is already split by runtime surface:

- `extension/` owns Chrome extension APIs.
- `server/` owns the local Native Messaging Unix Socket bridge.
- `bin/` owns the CLI entrypoint.
- `mcp/` owns the stdio MCP server entrypoint.
- `shared/` owns cross-surface helpers and the command contract.
- `scripts/` owns verification and packaging scripts.

The main organizational problem is not random files everywhere. The problem is that several folders have become flat "feature drawers", and four files have grown into high-friction hubs:

- `bin/chrome-bridge.mjs`: about 4,137 lines.
- `mcp/chrome-bridge-mcp.mjs`: about 2,175 lines.
- `shared/command-registry.mjs`: about 1,827 lines.
- `extension/page-scripts.js`: about 1,442 lines.

The safest reorganization is therefore incremental:

1. Introduce shallow feature folders while preserving the current public entrypoints.
2. Split the largest hub files behind compatibility wrappers.
3. Keep extension package paths and npm package paths stable until each move has dedicated checks.
4. Avoid a deep `src/` rewrite right now; it would create churn without improving the published package API.

## Current Structure Findings

### Runtime Entrypoints

`bin/chrome-bridge.mjs` is the CLI binary declared in `package.json`.

It currently contains:

- argument parsing
- bridge HTTP client helpers
- local command handling
- browser command wrappers
- self-test
- runtime-smoke
- doctor/session-summary
- debug-bundle
- action preview/apply orchestration
- artifact/output helpers
- command dispatch for all CLI commands

`mcp/chrome-bridge-mcp.mjs` is the MCP binary declared in `package.json`.

It currently contains:

- MCP server construction
- Zod schemas
- bridge HTTP client helpers
- local CLI-backed helpers
- local diagnostics and runtime smoke tools
- MCP resources
- MCP prompts
- profile filtering
- tool registration for every MCP tool

`native/host.mjs` is moderate-large but cohesive. It owns the bridge process boundary, extension connection lifecycle, direct command validation, origin checks, long-poll fallback, and shutdown cleanup.

### Extension Surface

`extension/background.js` is now a reasonably sized router at about 245 lines. It imports focused modules and dispatches extension actions with a single switch.

The extension folder is mostly feature-separated already:

- `navigation-actions.js`
- `page-read-actions.js`
- `page-interactions.js`
- `page-artifacts.js`
- `browser-data.js`
- `debugger-session.js`
- `emulation-actions.js`
- `download-actions.js`
- `trace-actions.js`
- `workspace-tabs.js`
- `tab-group-persistence.js`
- `user-prompts.js`

The main issue is `page-scripts.js`. It contains many injected functions that run in page context. Those functions are necessarily self-contained, but the file is now large enough that developers cannot quickly tell where text collection, selectors, observation, extraction, form handling, and interactions live.

### Shared Surface

`shared/` has useful feature helpers, but it mixes categories:

- command contract: `command-registry.mjs`
- output/artifacts: `output-envelope.mjs`, `diagnostics-output.mjs`, `network-export.mjs`
- extraction: `structured-extract.mjs`, `cpa-offer-extract.mjs`, `download-discovery.mjs`, `page-search.mjs`
- action planning: `act-preview.mjs`, `act-preview-state.mjs`, `action-recording.mjs`
- run/session helpers: `run-tabs.mjs`, `session-group-title.mjs`
- safety/utilities: `safe-record.mjs`, `fetch-timeout.mjs`, `tool-advisor.mjs`
- Lighthouse: `lighthouse-plan.mjs`, `lighthouse-ingest.mjs`

The biggest issue is `command-registry.mjs`: it is doing too many jobs at once. It is simultaneously the action schema source of truth, docs metadata source, CLI usage source, MCP tool list source, generated Markdown source, and payload validation implementation.

### Scripts Surface

`scripts/` is the flattest folder. It contains packaging scripts, launch-agent scripts, docs generation, contract checks, feature checks, MCP smoke checks, privacy checks, package checks, roadmap checks, and client-doc checks.

The flat script naming is consistent, but onboarding suffers because there are more than 40 files with similar `check-*` names.

### Published Package Constraints

`package.json` currently publishes these directories:

- `bin/`
- `docs/`
- `examples/`
- `extension/`
- `mcp/`
- `scripts/`
- `server/`
- `shared/`

It declares binaries:

- `chrome-bridge` -> `./bin/chrome-bridge.mjs`
- `chrome-bridge-mcp` -> `./mcp/chrome-bridge-mcp.mjs`

The Chrome extension manifest points directly at:

- `extension/background.js`
- `extension/ask.html`
- `extension/ask.js`
- `extension/offscreen.html`
- `extension/offscreen.js`

Therefore we should preserve these entrypoint paths during the first implementation wave.

## Proposed Target Structure

This is the recommended shallow target. It keeps public entrypoints stable and avoids too many nesting levels.

```text
bin/
  chrome-bridge.mjs
  cli/
    args.mjs
    bridge-client.mjs
    commands/
      browser.mjs
      diagnostics.mjs
      local.mjs
      runtime-smoke.mjs
      setup.mjs
    output.mjs

mcp/
  chrome-bridge-mcp.mjs
  server/
    bridge-client.mjs
    schemas.mjs
    profiles.mjs
    resources.mjs
    prompts.mjs
    tools/
      browser-tools.mjs
      local-tools.mjs
      artifact-tools.mjs
      private-tools.mjs

server/
  bridge-server.mjs
  internal/
    http-helpers.mjs
    extension-session.mjs
    command-ingress.mjs

shared/
  registry/
    actions.mjs
    metadata.mjs
    cli-usage.mjs
    mcp-tools.mjs
    validation.mjs
    generated-docs.mjs
    index.mjs
  artifacts/
    output-envelope.mjs
    diagnostics-output.mjs
    network-export.mjs
  extraction/
    structured-extract.mjs
    cpa-offer-extract.mjs
    download-discovery.mjs
    page-search.mjs
  actions/
    act-preview.mjs
    act-preview-state.mjs
    action-recording.mjs
  lighthouse/
    lighthouse-plan.mjs
    lighthouse-ingest.mjs
  session/
    run-tabs.mjs
    session-group-title.mjs
  utils/
    fetch-timeout.mjs
    safe-record.mjs
    tool-advisor.mjs

extension/
  background.js
  manifest.json
  ask.html
  ask.js
  offscreen.html
  offscreen.js
  actions/
    browser-data.js
    download-actions.js
    emulation-actions.js
    navigation-actions.js
    page-artifacts.js
    page-interactions.js
    page-read-actions.js
    runtime-actions.js
    trace-actions.js
  chrome/
    debugger-session.js
    extension-errors.js
    keyboard-events.js
    page-execution.js
    tab-info.js
    tab-loading.js
  workspace/
    focus-context.js
    safety-gates.js
    tab-cleanup.js
    tab-group-persistence.js
    workspace-policy.js
    workspace-tabs.js
  prompts/
    user-prompts.js
  injected/
    selectors.js
    text.js
    observe.js
    extract.js
    forms.js
    interactions.js
    index.js

scripts/
  package/
    build-extension-zip.mjs
    check-package-contents.mjs
    check-extension-package.mjs
    check-alias-package.mjs
  docs/
    generate-command-catalog.mjs
    check-docs-coverage.mjs
    check-client-docs.mjs
    check-client-config-examples.mjs
  checks/
    contracts/
      check-command-registry.mjs
      check-bridge-contract.mjs
      check-output-contract.mjs
    mcp/
      check-mcp-local-tools.mjs
      check-mcp-runtime-smoke.mjs
      check-mcp-prompts.mjs
      check-mcp-resources.mjs
    extension/
      check-tab-group-persistence.mjs
      check-frame-dom-capabilities.mjs
      check-drag-drop.mjs
      check-emulation.mjs
      check-download-manager.mjs
    features/
      check-act-preview.mjs
      check-act-apply.mjs
      check-page-search.mjs
      check-network-export.mjs
      check-cpa-offer-preset.mjs
      check-lighthouse-plan.mjs
      check-diagnostics.mjs
      check-full-page-read.mjs
      check-size-aware-screenshot.mjs
      check-output-hygiene-helpers.mjs
      check-action-recording.mjs
      check-run-tab-ownership.mjs
      check-tool-advisor.mjs
      check-examples-gallery.mjs
      check-roadmap-next-slice.mjs
      check-ubs-fixes.mjs
    docs/
      check-streamable-http-plan.mjs
      check-autonomy-cloud-boundaries.mjs
    release/
      check-privacy-scan.mjs
      check-roadmap-coverage.mjs
      check-runtime-smoke-plan.mjs
  service/
    install-launch-agent.mjs
    uninstall-launch-agent.mjs
```

## Recommended Implementation Phases

### Phase 0: Add Reorganization Guardrails

Before moving code, add a small checker such as `scripts/checks/release/check-reorganization-boundaries.mjs` that verifies:

- published binary paths still exist
- extension manifest entrypoint paths still exist
- `npm run check` references existing script paths
- `package.json.files` still includes required runtime directories
- generated docs scripts still run from the expected root

Why first: this repository has a very large `check` script and many path-sensitive docs/package checks. A guardrail prevents death by a thousand path edits.

Calling code changes:

- Add `check:reorganization-boundaries` to `package.json`.
- Add it near the start of `npm run check`.
- Update README verification list after the checker exists.

Verification:

- `npm run check:reorganization-boundaries`
- `npm run check:pack`

### Phase 1: Organize `scripts/` Without Runtime Risk

Move scripts into shallow category folders first. This has the lowest runtime risk because scripts are not imported by production runtime except through `package.json` commands.

Proposed moves:

- `scripts/build-extension-zip.mjs` -> `scripts/package/build-extension-zip.mjs`
- `scripts/check-package-contents.mjs` -> `scripts/package/check-package-contents.mjs`
- `scripts/check-extension-package.mjs` -> `scripts/package/check-extension-package.mjs`
- `scripts/check-alias-package.mjs` -> `scripts/package/check-alias-package.mjs`
- `scripts/generate-command-catalog.mjs` -> `scripts/docs/generate-command-catalog.mjs`
- `scripts/check-docs-coverage.mjs` -> `scripts/docs/check-docs-coverage.mjs`
- `scripts/check-client-docs.mjs` -> `scripts/docs/check-client-docs.mjs`
- `scripts/check-client-config-examples.mjs` -> `scripts/docs/check-client-config-examples.mjs`
- Move MCP checkers under `scripts/checks/mcp/`.
- Move extension behavior checkers under `scripts/checks/extension/`.
- Move feature checkers under `scripts/checks/features/`.
- Move policy/roadmap/privacy checks under `scripts/checks/release/` or `scripts/checks/docs/`.
- Move LaunchAgent scripts to `scripts/service/`.

Rationale:

- New contributors can find packaging, docs, MCP, extension, and feature checks quickly.
- The command surface remains unchanged because npm scripts keep the names.
- We avoid touching runtime imports in the first migration.

Calling code changes:

- Update every `package.json` script path.
- Update `npm run check` path fragments.
- Update docs that mention direct script paths if any.
- Update `.github/workflows/check.yml` only if it references direct script paths rather than npm scripts.
- Update `scripts/package/check-package-contents.mjs` required paths if it asserts script file locations.

Verification:

- `npm run check:pack`
- `npm run check:docs`
- `npm run check`
- `npm run check:audit`

### Phase 2: Split `shared/command-registry.mjs` Behind A Stable Wrapper

Do not move callers directly to many new registry files in one commit. Instead:

1. Create `shared/registry/`.
2. Move internal sections into focused modules:
   - `actions.mjs`: `BRIDGE_VERSION`, permissions, action schemas, action lists, risk tiers, timeouts.
   - `metadata.mjs`: `ACTION_DOCS`, `LOCAL_COMMAND_DOCS`, command metadata/catalog generation.
   - `cli-usage.mjs`: usage lines/groups and generated CLI reference helpers.
   - `mcp-tools.mjs`: MCP tool names and generated MCP reference helpers.
   - `validation.mjs`: `CommandPayloadValidationError` and `validateCommandPayload`.
   - `generated-docs.mjs`: generated Markdown block helpers if not kept with CLI/MCP files.
   - `index.mjs`: exports the combined public registry API.
3. Keep `shared/command-registry.mjs` as a compatibility wrapper that re-exports from `shared/registry/index.mjs`.

Rationale:

- Most of the codebase imports `../shared/command-registry.mjs`. Keeping that path stable reduces migration risk.
- Splitting by responsibility makes future command additions less intimidating.
- The wrapper lets later commits migrate imports gradually or not at all.

Calling code changes:

- Minimal first pass: update no callers, only keep wrapper exports.
- Update `scripts/checks/contracts/check-command-registry.mjs` if it scans for exact strings inside `shared/command-registry.mjs`.
- Update docs only after the split is stable.

Verification:

- `npm run self-test`
- `npm run check:registry`
- `npm run check:docs`
- `npm run check:mcp-local-tools`
- `npm run check:cli-local-tools`
- `npm run check`

### Phase 3: Extract CLI Internals From `bin/chrome-bridge.mjs`

Keep `bin/chrome-bridge.mjs` as the executable entrypoint, but turn it into a thin bootstrap.

Proposed modules:

- `bin/cli/args.mjs`: `parseArgs`, numeric parsing, JSON option parsing, target/confirmation payload helpers.
- `bin/cli/bridge-client.mjs`: `command`, `health`, bridge fetch timeout handling.
- `bin/cli/output.mjs`: `printJson`, file writers, data URL writers, artifact output helpers.
- `bin/cli/commands/local.mjs`: `self-test`, `doctor`, `mcp-config`, `codex-config`, `command-catalog`, `advise`.
- `bin/cli/commands/browser.mjs`: direct browser action command handlers.
- `bin/cli/commands/diagnostics.mjs`: `diagnostics`, `debug-bundle`, `network-export`, Lighthouse helpers.
- `bin/cli/commands/runtime-smoke.mjs`: runtime smoke fixture server and coverage plan.

Rationale:

- The current CLI is the largest file and hardest to review.
- Command parsing and command execution are currently interleaved.
- A thin CLI bootstrap makes future aliases or alternate transport launchers easier.

Migration strategy:

1. Extract pure helpers first without changing command behavior.
2. Extract local/offline commands next.
3. Extract browser command blocks in small category commits.
4. Leave `main().catch(...)` in `bin/chrome-bridge.mjs`.

Calling code changes:

- No package binary path change.
- Update `npm run check` to include new `bin/cli/**/*.mjs` files.
- Update any checker that scans `bin/chrome-bridge.mjs` for exact command strings. Several checkers currently inspect CLI source directly, so they must either scan the new modules or use a helper that searches the whole CLI folder.

Verification:

- `node --check ./bin/chrome-bridge.mjs`
- `npm run self-test`
- `npm run check:cli-local-tools`
- `npm run check:act-preview`
- `npm run check:act-apply`
- `npm run check:runtime-smoke-plan`
- `npm run check`

### Phase 4: Extract MCP Server Internals

Keep `mcp/chrome-bridge-mcp.mjs` as the executable entrypoint, but split it into focused modules.

Proposed modules:

- `mcp/server/bridge-client.mjs`: bridge fetch/command helpers and action recording.
- `mcp/server/schemas.mjs`: shared Zod schemas.
- `mcp/server/profiles.mjs`: MCP tool profile sets and profile summaries.
- `mcp/server/resources.mjs`: resource text and resource registration.
- `mcp/server/prompts.mjs`: prompt text and prompt registration.
- `mcp/server/tools/browser-tools.mjs`: browser read/navigation/interaction tools.
- `mcp/server/tools/local-tools.mjs`: doctor, self-test, mcp-config, command catalog.
- `mcp/server/tools/artifact-tools.mjs`: diagnostics, debug bundle, Lighthouse, network export, recording summary.
- `mcp/server/tools/private-tools.mjs`: history, bookmarks, cookies, storage, request.

Rationale:

- The MCP server is a 2,000+ line declaration file.
- Tool definitions are easier to review when grouped by safety/risk.
- Profiles, resources, prompts, and tools are separate concerns.

Calling code changes:

- No `chrome-bridge-mcp` binary path change.
- Update source-scanning checks in `scripts/checks/contracts/check-command-registry.mjs`, `check-mcp-local-tools.mjs`, and feature checkers if they look for `server.tool(...)` in the single file.
- Prefer adding a test helper that loads all files under `mcp/server/` for source checks.

Verification:

- `npm run check:mcp-local-tools`
- `npm run check:mcp-runtime-smoke`
- `npm run check:mcp-prompts`
- `npm run check:mcp-resources`
- `npm run check:client-config-examples`
- `npm run check`

### Phase 5: Split Injected Page Scripts

This is the highest-risk extension refactor, so do it after scripts/shared/CLI/MCP are cleaner.

Proposed target:

- `extension/injected/selectors.js`
- `extension/injected/text.js`
- `extension/injected/observe.js`
- `extension/injected/extract.js`
- `extension/injected/forms.js`
- `extension/injected/interactions.js`
- `extension/injected/index.js`

Two implementation options:

1. Keep `extension/page-scripts.js` as a wrapper that imports and re-exports functions from `extension/injected/index.js`.
2. Move imports in `page-read-actions.js`, `page-interactions.js`, `download-actions.js`, and `page-artifacts.js` to the new injected modules directly.

Recommended option: start with wrapper exports, then migrate direct imports later.

Rationale:

- Injected functions must remain serializable/self-contained for `chrome.scripting.executeScript`.
- A big-bang split can accidentally introduce closure/import assumptions that fail inside page context.
- Wrapper-first preserves existing imports while giving us smaller files.

Calling code changes:

- Update `extension/page-read-actions.js`, `page-interactions.js`, `download-actions.js`, and `page-artifacts.js` only after wrapper tests pass.
- Update `npm run check` to syntax-check new files.
- Update extension zip/package checks to include new files.

Verification:

- `npm run check:full-page-read`
- `npm run check:frame-dom-capabilities`
- `npm run check:element-ref-contract`
- `npm run check:drag-drop`
- `npm run check:page-search`
- `npm run check:extension-package`
- live `runtime-smoke` after extension reload

### Phase 6: Optional Extension Folder Grouping

Only after injected scripts are stable, consider moving extension modules into `actions/`, `chrome/`, `workspace/`, and `prompts/`.

This phase has packaging risk because the extension runtime imports relative paths from `background.js`. It is still manageable, but the benefit is lower than splitting `page-scripts.js`.

Recommended rule:

- Do not move `background.js`, `manifest.json`, `ask.html`, `ask.js`, `offscreen.html`, or `offscreen.js`.
- Move implementation modules only.
- Keep each move grouped by domain and verified with `extension:zip` plus fake-Chrome checkers.

Calling code changes:

- Update imports in `extension/background.js`.
- Update imports among extension modules.
- Update source-scanning scripts that reference exact old paths.
- Update docs/ARCHITECTURE.md.

Verification:

- `npm run check:extension-package`
- `npm run check:tab-group-persistence`
- `npm run check:download-manager`
- `npm run check:emulation`
- `npm run check`
- live extension reload and runtime smoke

### Phase 7: Optional Server Split

`native/host.mjs` is large but cohesive. Splitting it should be lower priority than CLI/MCP/registry/page-scripts.

If split later:

- `server/internal/http-helpers.mjs`
- `server/internal/extension-session.mjs`
- `server/internal/command-ingress.mjs`

Keep `native/host.mjs` exporting:

- `parseBridgePort`
- `createBridgeServer`
- `startBridgeServer`

Calling code changes:

- No public import path change in `bin/chrome-bridge.mjs` or tests.
- Update `npm run check` for new internal files.

Verification:

- `npm run check:bridge-contract`
- `npm run check:runtime-smoke-plan`
- `npm run check`

## Consolidation And Split Recommendations

### Files To Split

Split these first:

- `bin/chrome-bridge.mjs`
- `mcp/chrome-bridge-mcp.mjs`
- `shared/command-registry.mjs`
- `extension/page-scripts.js`
- `scripts/checks/contracts/check-command-registry.mjs`
- `scripts/checks/cli/check-cli-local-tools.mjs`
- `scripts/checks/mcp/check-mcp-local-tools.mjs`

The three large checker files can be split after runtime modules move, because they currently encode many cross-surface invariants. A good target is `scripts/checks/helpers/` for fake bridge/MCP client helpers and per-domain checker modules.

### Files Not Worth Splitting Yet

Do not split these immediately:

- `native/host.mjs`: large but single responsibility.
- `shared/structured-extract.mjs`: large-ish but cohesive.
- `shared/tool-advisor.mjs`: cohesive deterministic advisor logic.
- `extension/navigation-actions.js`: moderately large but coherent.
- `extension/tab-group-persistence.js`: complex but cohesive.

### Files That Could Be Merged

Avoid merging most files. The repo's problem is large hubs, not excessive tiny runtime modules.

Potential low-risk merge candidates:

- `extension/runtime-actions.js` and `extension/safety-gates.js` are tiny, but they have distinct meanings. Keep separate for clarity.
- `shared/fetch-timeout.mjs` and `shared/safe-record.mjs` are tiny utilities, but merging into `shared/utils/` as separate files is clearer than combining them.

## Path-Sensitive Callers To Update

Every implementation phase must account for these path-sensitive surfaces:

- `package.json` scripts and the giant `npm run check` command.
- `package.json.files` if new top-level directories are added.
- `.npmignore` if package contents are filtered there.
- `.github/workflows/check.yml` if direct paths appear.
- `scripts/package/check-package-contents.mjs` required package file assertions.
- `scripts/checks/contracts/check-command-registry.mjs` source-string assertions.
- `scripts/docs/check-docs-coverage.mjs` generated docs path assumptions.
- `docs/ARCHITECTURE.md`.
- `README.md` verification command descriptions.
- `docs/PUBLISHING.md` if script paths are mentioned.
- `extension/manifest.json` if extension entrypoints move. The first phases should avoid this.
- `scripts/package/build-extension-zip.mjs` if extension layout assumptions become stricter.
- `aliases/chrome-mcp-bridge/bin/*.mjs` if alias wrappers hardcode binary paths.

## Verification Checklist For Any Move

Minimum after a scripts-only move:

```bash
npm run check:pack
npm run check:privacy
npm run check
```

Minimum after shared registry or CLI/MCP moves:

```bash
npm run self-test
npm run check:registry
npm run check:cli-local-tools
npm run check:mcp-local-tools
npm run check:docs
npm run check
npm run check:audit
npm run check:pack
```

Minimum after extension moves:

```bash
npm run check:extension-package
npm run check:bridge-contract
npm run check:tab-group-persistence
npm run check:full-page-read
npm run check:drag-drop
npm run check
npm run check:pack
node ./bin/chrome-bridge.mjs reload-extension --confirm
node ./bin/chrome-bridge.mjs doctor --live-checks
node ./bin/chrome-bridge.mjs runtime-smoke --summary-only --out /tmp/chrome-bridge-runtime-smoke.json
```

## Recommended First Implementation PR

The first actual implementation should be deliberately boring:

1. Add `scripts/checks/release/check-reorganization-boundaries.mjs`.
2. Move only packaging/docs/service scripts into subfolders.
3. Update `package.json` script paths.
4. Update `scripts/package/check-package-contents.mjs`.
5. Update README verification prose if needed.
6. Run `npm run check`, `npm run check:audit`, and `npm run check:pack`.

Do not move extension runtime modules, CLI internals, MCP internals, or shared registry internals in the first PR. That keeps the blast radius small and gives us confidence in path rewrite mechanics.

## Why This Structure Is Optimal For Developers And Agents

This structure makes the repository answer "where should I look?" quickly:

- Need browser API behavior? Look in `extension/actions/`.
- Need Chrome-specific primitives? Look in `extension/chrome/`.
- Need scoped tab/session behavior? Look in `extension/workspace/` or `shared/session/`.
- Need CLI behavior? Look in `bin/cli/commands/`.
- Need MCP behavior? Look in `mcp/server/tools/`, `resources.mjs`, or `prompts.mjs`.
- Need output contracts and artifacts? Look in `shared/artifacts/`.
- Need extraction/presets/search? Look in `shared/extraction/`.
- Need command schema/docs/validation? Look in `shared/registry/`.
- Need package or CI checks? Look in `scripts/package/` or `scripts/checks/`.

It also keeps the public API stable:

- Existing npm binaries remain unchanged.
- Existing extension manifest entrypoints remain unchanged in early phases.
- Existing docs and generated references continue to derive from the same registry API.
- Existing tests can be updated one category at a time rather than all at once.

The result should be a repository that feels organized without becoming over-nested, and a migration path that keeps every step verifiable.
