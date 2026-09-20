#!/usr/bin/env node
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  COMMAND_METADATA,
  COMMAND_PAYLOAD_SCHEMAS,
  DEBUGGER_SERIALIZED_ACTIONS,
  LOCAL_COMMAND_METADATA,
  validateCommandPayload,
} from '../../../shared/command-registry.mjs';

const execFileAsync = promisify(execFile);
import { readCliSource } from '../lib/cli-source.mjs';

import { readMcpSource } from '../lib/mcp-source.mjs';

import { readPageScriptsSource } from '../lib/page-scripts-source.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = path.join(rootDir, 'bin/chrome-bridge.mjs');
const failures = [];
let checked = 0;

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  checked += 1;
  if (!condition) fail(message);
}

async function readProjectFile(filePath) {
  return fs.readFile(path.join(rootDir, filePath), 'utf8');
}

function command(action, expected = {}) {
  const metadata = COMMAND_METADATA[action];
  check(Boolean(metadata), `roadmap command is missing from registry: ${action}`);
  if (!metadata) return;
  if (expected.cli) check(metadata.cli.includes(expected.cli), `${action} must expose CLI command ${expected.cli}`);
  if (expected.mcp) check(metadata.mcp.includes(expected.mcp), `${action} must expose MCP tool ${expected.mcp}`);
  if (expected.riskTier) check(metadata.riskTier === expected.riskTier, `${action} risk tier must be ${expected.riskTier}`);
  if (expected.requiresConfirmation !== undefined) {
    check(metadata.requiresConfirmation === expected.requiresConfirmation, `${action} confirmation metadata drift`);
  }
  if (expected.allowedKeys) {
    for (const key of expected.allowedKeys) {
      check(metadata.allowedKeys.includes(key), `${action} must allow payload key ${key}`);
    }
  }
}

function localCommand(id, expected = {}) {
  const metadata = LOCAL_COMMAND_METADATA[id];
  check(Boolean(metadata), `roadmap local command is missing from registry: ${id}`);
  if (!metadata) return;
  if (expected.cli) check(metadata.cli.includes(expected.cli), `${id} must expose CLI command ${expected.cli}`);
  if (expected.mcp) check(metadata.mcp.includes(expected.mcp), `${id} must expose MCP tool ${expected.mcp}`);
  if (expected.liveBridge) check(metadata.liveBridge === expected.liveBridge, `${id} live bridge metadata must be ${expected.liveBridge}`);
}

function rejectsPayload(action, payload, messageIncludes, label) {
  try {
    validateCommandPayload(action, payload);
    check(false, `${label} must reject invalid payload`);
  } catch (error) {
    check(String(error?.message || error).includes(messageIncludes), `${label} rejection message must mention ${messageIncludes}`);
  }
}

async function runCoveragePlan() {
  try {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, 'runtime-smoke', '--coverage-plan'], {
      cwd: rootDir,
      env: {
        ...process.env,
        CHROME_BRIDGE_SOCKET: '/tmp/chrome-bridge-unavailable.sock',
      },
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    fail(`runtime-smoke --coverage-plan failed during roadmap coverage check: ${String(error?.message || error)}`);
    return null;
  }
}

const [
  packageText,
  serverText,
  cliText,
  mcpText,
  backgroundText,
  browserDataText,
  debuggerSessionText,
  pageReadActionsText,
  pageInteractionsText,
  pageArtifactsText,
  pageScriptsText,
  traceActionsText,
  workspaceTabsText,
  workspacePolicyText,
  tabCleanupText,
  tabGroupPersistenceText,
  bridgeContractText,
  commandRegistryCheckerText,
  docsCheckerText,
  runtimeSmokePlanCheckerText,
  cliLocalToolsCheckerText,
  mcpRuntimeSmokeCheckerText,
  mcpLocalToolsCheckerText,
  tabGroupPersistenceCheckerText,
  readmeText,
  cliDocsText,
  mcpDocsText,
  architectureText,
  safetyText,
  roadmapText,
  publishingText,
] = await Promise.all([
  readProjectFile('package.json'),
  readProjectFile('native/host.mjs'),
  readCliSource(rootDir),
  readMcpSource(rootDir),
  readProjectFile('extension/background.js'),
  readProjectFile('extension/browser-data.js'),
  readProjectFile('extension/debugger-session.js'),
  readProjectFile('extension/page-read-actions.js'),
  readProjectFile('extension/page-interactions.js'),
  readProjectFile('extension/page-artifacts.js'),
  readPageScriptsSource(rootDir),
  readProjectFile('extension/trace-actions.js'),
  readProjectFile('extension/workspace-tabs.js'),
  readProjectFile('extension/workspace-policy.js'),
  readProjectFile('extension/tab-cleanup.js'),
  readProjectFile('extension/tab-group-persistence.js'),
  readProjectFile('scripts/checks/contracts/check-bridge-contract.mjs'),
  readProjectFile('scripts/checks/contracts/check-command-registry.mjs'),
  readProjectFile('scripts/docs/check-docs-coverage.mjs'),
  readProjectFile('scripts/checks/release/check-runtime-smoke-plan.mjs'),
  readProjectFile('scripts/checks/cli/check-cli-local-tools.mjs'),
  readProjectFile('scripts/checks/mcp/check-mcp-runtime-smoke.mjs'),
  readProjectFile('scripts/checks/mcp/check-mcp-local-tools.mjs'),
  readProjectFile('scripts/checks/extension/check-tab-group-persistence.mjs'),
  readProjectFile('README.md'),
  readProjectFile('docs/CLI.md'),
  readProjectFile('docs/MCP.md'),
  readProjectFile('docs/ARCHITECTURE.md'),
  readProjectFile('docs/SAFETY.md'),
  readProjectFile('docs/COMPETITIVE-ROADMAP.md'),
  readProjectFile('docs/PUBLISHING.md'),
]);
const packageJson = JSON.parse(packageText);

// Phase 0: Native Messaging and Unix Socket contract hardening.
check(serverText.includes('BRIDGE_VERSION'), 'Phase 0 must report the Native Host version');
check(serverText.includes('startSocketServer'), 'Phase 0 must own the Unix Socket listener');
check(serverText.includes('sendNativeMessage'), 'Phase 0 must relay commands through Native Messaging');
check(serverText.includes("request?.type === 'command'"), 'Phase 0 must dispatch command envelopes');
check(serverText.includes('EXTENSION_NOT_CONNECTED'), 'Phase 0 must fail closed when the extension is disconnected');
check(bridgeContractText.includes('native-messaging+unix-socket'), 'Phase 0 must have Native Messaging contract coverage');
check(bridgeContractText.includes('EXTENSION_COMMAND_FAILED'), 'Phase 0 must preserve extension error codes');
check(!backgroundText.includes('Network.getResponseBody') && !debuggerSessionText.includes('Network.getResponseBody'), 'Phase 0 trace implementation must not capture response bodies');
rejectsPayload('open', { url: 'javascript:alert(1)' }, 'URL protocol', 'Phase 0 open URL validation');
rejectsPayload('fetchUrl', { url: 'file:///etc/passwd', confirmed: true }, 'URL protocol', 'Phase 0 request URL validation');
check(
  !Object.keys(COMMAND_PAYLOAD_SCHEMAS).some((action) => /eval|execute|script/i.test(action))
    && !Object.values(COMMAND_PAYLOAD_SCHEMAS).some((keys) => keys.includes('expression') || keys.includes('functionBody')),
  'Phase 0 must not expose arbitrary page-code execution actions or payload keys',
);

// Phase 1: existing-tab workflow and agent discovery.
command('adoptTab', { cli: 'adopt-tab', mcp: 'chrome_bridge_adopt_tab', riskTier: 'interaction', requiresConfirmation: true, allowedKeys: ['tabId'] });
command('printPdf', { cli: 'pdf', mcp: 'chrome_bridge_pdf', riskTier: 'read' });
command('observe', { cli: 'observe', mcp: 'chrome_bridge_observe', riskTier: 'read', allowedKeys: ['limit', 'maxTextChars'] });
command('findElements', { cli: 'find-elements', mcp: 'chrome_bridge_find_elements', riskTier: 'read', allowedKeys: ['role', 'text', 'nearText', 'placeholder', 'href', 'actionKind', 'risk'] });
check(pageReadActionsText.includes('collectObserve') && pageReadActionsText.includes('elementFilters'), 'Phase 1 must implement observe and find-elements through read-only page scripts');
check(pageScriptsText.includes('nearText') && pageScriptsText.includes('actionKind') && pageScriptsText.includes('risk'), 'Phase 1 page scripts must support ranked/filterable discovery metadata');
check(pageScriptsText.includes('function stableSelectorFor') && pageScriptsText.includes('document.querySelector(selector) === element'), 'Phase 1 discovery selectors must use a stable querySelector-verified fallback');
check(pageScriptsText.includes('nth-of-type'), 'Phase 1 discovery selectors must fall back to an nth-of-type path when short attributes are unavailable');
check(cliDocsText.includes('querySelector-verified selectors'), 'Phase 1 CLI docs must explain querySelector-verified discovery selectors');
check(readmeText.includes('## Existing-Tab Workflow') && cliDocsText.includes('## Existing-Tab Workflow'), 'Phase 1 docs must expose existing-tab workflow');

// Phase 2: structured extraction and debug artifacts.
command('extractPage', { cli: 'extract', mcp: 'chrome_bridge_extract', riskTier: 'read', allowedKeys: ['kind', 'maxItems'] });
localCommand('session-summary', { cli: 'session-summary', mcp: 'chrome_bridge_session_summary', liveBridge: 'yes' });
localCommand('debug-bundle', { cli: 'debug-bundle', mcp: 'chrome_bridge_debug_bundle', liveBridge: 'yes' });
check(pageReadActionsText.includes('collectExtract'), 'Phase 2 must implement structured extraction through page scripts');
check(pageScriptsText.includes('tables') && pageScriptsText.includes('forms') && pageScriptsText.includes('keyValues'), 'Phase 2 extraction must cover tables, forms, lists, and key-value blocks');
check(cliText.includes('redactDebugBundleValue') && cliText.includes('trace-summary.json'), 'Phase 2 debug bundle must redact default artifacts and summarize trace by default');
check(cliText.includes('session-summary.json') && cliText.includes('workspacePolicy'), 'Phase 2 debug bundle/session summary must include workspace policy state');
check(mcpDocsText.includes('debug_bundle') && mcpDocsText.includes('redacts') && safetyText.includes('debug-bundle'), 'Phase 2 docs must explain privacy-preserving debug bundles');

// Phase 3: broader interaction coverage.
command('listSelectOptions', { cli: 'select-options', mcp: 'chrome_bridge_select_options', riskTier: 'read' });
command('fillForm', { cli: 'fill-form', mcp: 'chrome_bridge_fill_form', riskTier: 'interaction', requiresConfirmation: true });
command('handleDialog', { cli: 'handle-dialog', mcp: 'chrome_bridge_handle_dialog', riskTier: 'interaction', requiresConfirmation: true });
command('uploadFile', { cli: 'upload-file', mcp: 'chrome_bridge_upload_file', riskTier: 'interaction', requiresConfirmation: true });
check(pageInteractionsText.includes('dryRun') && pageInteractionsText.includes('Page.handleJavaScriptDialog') && pageInteractionsText.includes('DOM.setFileInputFiles'), 'Phase 3 must implement dry-run forms, dialogs, and file upload');
for (const action of ['traceStart', 'traceStop', 'screenshot', 'printPdf', 'clickAt', 'type', 'press', 'handleDialog', 'uploadFile']) {
  check(DEBUGGER_SERIALIZED_ACTIONS.includes(action), `Phase 3 debugger-backed action must be serialized: ${action}`);
}
check(debuggerSessionText.includes('debuggerLocks') && debuggerSessionText.includes('withDebugger'), 'Phase 3 must serialize debugger-backed work per tab');

// Phase 4: registry, docs generation, modularity, and workspace policy.
localCommand('command-catalog', { cli: 'command-catalog', mcp: 'chrome_bridge_command_catalog', liveBridge: 'no' });
command('workspace', { cli: 'workspace', mcp: 'chrome_bridge_workspace', riskTier: 'read' });
command('setWorkspace', { cli: 'set-workspace', mcp: 'chrome_bridge_set_workspace', riskTier: 'system', requiresConfirmation: true, allowedKeys: ['policyMode'] });
command('clearWorkspace', { cli: 'clear-workspace', mcp: 'chrome_bridge_clear_workspace', riskTier: 'system', requiresConfirmation: true });
check(commandRegistryCheckerText.includes('complete CLI/MCP catalog coverage') || commandRegistryCheckerText.includes('CLI commands'), 'Phase 4 must verify CLI/MCP registry parity');
check(docsCheckerText.includes('generated CLI reference block') && docsCheckerText.includes('generated MCP tool block'), 'Phase 4 must verify generated CLI/MCP docs coverage');
check(packageJson.scripts?.['docs:commands'] === 'node ./scripts/docs/generate-command-catalog.mjs', 'Phase 4 must expose registry-derived docs generation');
for (const modulePath of [
  'extension/navigation-actions.js',
  'extension/page-read-actions.js',
  'extension/page-interactions.js',
  'extension/page-artifacts.js',
  'extension/debugger-session.js',
  'extension/workspace-tabs.js',
]) {
  check(packageText.includes(modulePath.split('/')[0]) || architectureText.includes(modulePath), `Phase 4 architecture docs must mention module ${modulePath}`);
}
check(workspacePolicyText.includes("'strict'") && workspaceTabsText.includes('allowExternal is blocked by strict workspace policy'), 'Phase 4 must implement explicit scoped/strict workspace policy');
check(tabCleanupText.includes('chrome.tabs.ungroup') && tabGroupPersistenceText.includes('enforceManagedTabGroupPersistence'), 'Phase 4 must mitigate saved closed tab groups through cleanup and startup sweep');
check(roadmapText.includes('session-scoped bridge-created group IDs') && roadmapText.includes('Chrome session storage'), 'Phase 4 roadmap must document session-scoped managed group IDs');

// Offline/live verification boundary.
localCommand('runtime-smoke', { cli: 'runtime-smoke', mcp: 'chrome_bridge_runtime_smoke', liveBridge: 'yes' });
localCommand('doctor', { cli: 'doctor', mcp: 'chrome_bridge_doctor', liveBridge: 'optional' });
check(runtimeSmokePlanCheckerText.includes('CHROME_BRIDGE_SOCKET') && runtimeSmokePlanCheckerText.includes('/tmp/chrome-bridge-unavailable.sock'), 'Deferred verification must have an offline smoke-plan checker');
check(cliLocalToolsCheckerText.includes("runCli(['doctor'])") && cliLocalToolsCheckerText.includes('catalogJson.counts?.mcpTools'), 'Deferred verification must cover local CLI diagnostics offline');
check(mcpRuntimeSmokeCheckerText.includes('chrome_bridge_runtime_smoke') && mcpRuntimeSmokeCheckerText.includes('cliExitError'), 'Deferred verification must cover MCP runtime-smoke JSON preservation');
check(mcpLocalToolsCheckerText.includes('chrome_bridge_command_catalog') && mcpLocalToolsCheckerText.includes('unexpected MCP tool'), 'Deferred verification must cover MCP local tools and listTools parity');
check(tabGroupPersistenceCheckerText.includes('createFakeChrome') && tabGroupPersistenceCheckerText.includes('savedGroupPersistence'), 'Deferred verification must cover tab-group persistence lifecycle with fake Chrome APIs');
check(
  (
    roadmapText.includes('Deferred Runtime Verification')
    || roadmapText.includes('Runtime Verification When The Live Bridge Is Busy')
  ) && publishingText.includes('verification.status: "passed"'),
  'Deferred live runtime verification criteria must be documented',
);
check(roadmapText.includes('top-level `nextCommand` / `nextAction`'), 'Deferred runtime roadmap must document top-level recovery metadata');
check(roadmapText.includes('verification.nextCommand') && roadmapText.includes('verification.nextAction'), 'Deferred runtime roadmap must document contextual next recovery metadata');
check(roadmapText.includes('verification.finalCommands') && roadmapText.includes('verification.finalMcpCalls'), 'Deferred runtime roadmap must document final CLI/MCP recovery metadata');
check(roadmapText.includes('chrome-bridge reload-extension --confirm'), 'Deferred runtime roadmap must document the exact extension reload command');
check(roadmapText.includes('chrome-bridge doctor --live-checks'), 'Deferred runtime roadmap must document the exact live doctor command');
check(roadmapText.includes('chrome-bridge runtime-smoke'), 'Deferred runtime roadmap must document the exact live runtime smoke command');
check(roadmapText.includes('savedClosedGroupChipPrevention'), 'Roadmap execution/deferred verification must mention saved closed group chip prevention metadata');

const coveragePlan = await runCoveragePlan();
const requiredCoverage = coveragePlan?.coverage?.required || [];
const deferredLiveVerification = coveragePlan ? {
  status: coveragePlan.verification?.status || 'unknown',
  liveBridge: coveragePlan.liveBridge === true,
  liveVerificationRequired: coveragePlan.verification?.liveVerificationRequired === true,
  nextCommand: coveragePlan.nextCommand || coveragePlan.verification?.nextCommand || null,
  nextAction: coveragePlan.nextAction || coveragePlan.verification?.nextAction || null,
  finalCommands: coveragePlan.verification?.finalCommands || [],
  finalMcpCalls: coveragePlan.verification?.finalMcpCalls || [],
  successCriteria: coveragePlan.verification?.successCriteria || {},
  requiredCoverageCount: coveragePlan.coverage?.requiredCount || requiredCoverage.length,
  requiredCoverage,
} : null;
if (coveragePlan) {
  check(coveragePlan.ok === true, 'offline coverage plan must succeed');
  check(coveragePlan.liveBridge === false, 'offline coverage plan must not touch the live bridge');
  check(coveragePlan.verification?.status === 'not-run', 'offline coverage plan must not claim live verification');
  check(coveragePlan.verification?.liveVerificationRequired === true, 'offline coverage plan must require final live verification');
  check(coveragePlan.nextCommand === 'chrome-bridge reload-extension --confirm', 'offline coverage plan must include top-level first recovery command');
  check(coveragePlan.nextAction?.includes('Reload the unpacked Chrome MCP Bridge extension'), 'offline coverage plan must include top-level first recovery action');
  check(coveragePlan.verification?.nextCommand === 'chrome-bridge reload-extension --confirm', 'offline coverage plan must include the first recovery command');
  check(coveragePlan.verification?.nextAction?.includes('Reload the unpacked Chrome MCP Bridge extension'), 'offline coverage plan must include the first recovery action');
  check(coveragePlan.verification?.finalCommands?.includes('chrome-bridge runtime-smoke'), 'offline coverage plan must include final live CLI commands');
  check(coveragePlan.verification?.finalMcpCalls?.some((call) => call?.tool === 'chrome_bridge_runtime_smoke'), 'offline coverage plan must include final live MCP calls');
  check(deferredLiveVerification?.status === 'not-run', 'roadmap output must expose pending deferred live verification status');
  check(deferredLiveVerification?.liveBridge === false, 'roadmap output must expose offline live-bridge state');
  check(deferredLiveVerification?.nextCommand === 'chrome-bridge reload-extension --confirm', 'roadmap output must expose first live recovery command');
  check(deferredLiveVerification?.finalCommands?.includes('chrome-bridge runtime-smoke'), 'roadmap output must expose final CLI runtime smoke command');
  check(deferredLiveVerification?.finalMcpCalls?.some((call) => call?.tool === 'chrome_bridge_runtime_smoke'), 'roadmap output must expose final MCP runtime smoke call');
  for (const coverageItem of [
    'set strict smoke workspace',
    'adopt existing smoke tab',
    'session summary covers strict policy',
    'debug bundle default redaction',
    'observe actionable elements',
    'observe nth-of-type selector fallback',
    'find-elements near text filtered',
    'extract forms',
    'pdf export',
    'handle dialog prompt',
    'upload file input',
    'trace events',
    'safety: credentialed request requires confirmSensitive',
    'strict policy rejects outside tab even with allowExternal',
    'cleanup close smoke tab',
  ]) {
    check(requiredCoverage.includes(coverageItem), `offline coverage plan must include required live smoke item: ${coverageItem}`);
  }
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  checked,
  phases: 5,
  liveBridge: false,
  runtimeSmokeDeferred: true,
  recoveryMetadata: Boolean(coveragePlan?.nextCommand && coveragePlan?.nextAction && coveragePlan?.verification?.nextCommand && coveragePlan?.verification?.finalMcpCalls?.length),
  requiredLiveCoverageCount: coveragePlan?.coverage?.requiredCount || null,
  deferredLiveVerification,
}, null, 2)}\n`);
