#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRIDGE_VERSION,
  CLI_COMMANDS,
  CLI_USAGE_GROUPS,
  CLI_USAGE_LINES,
  COMMAND_CATALOG,
  COMMAND_METADATA,
  COMMAND_PAYLOAD_SCHEMAS,
  DEBUGGER_SERIALIZED_ACTIONS,
  EXTENSION_ACTIONS,
  LOCAL_COMMAND_CATALOG,
  LOCAL_COMMAND_METADATA,
  MANIFEST_PERMISSIONS,
  MCP_TOOLS,
  commandCatalog,
  commandCatalogMarkdown,
  commandDefaultTimeoutMs,
  commandRiskTier,
  cliUsageLineForCommand,
  validateCommandPayload,
} from '../../../shared/command-registry.mjs';

import { readCliSource } from '../lib/cli-source.mjs';

import { readMcpSource } from '../lib/mcp-source.mjs';

import { readPageScriptsSource } from '../lib/page-scripts-source.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const failures = [];
const isRepositoryCheckout = Boolean(await fs.stat(path.join(rootDir, '.git')).catch(() => null));

function readRepoOnlyFile(relativePath) {
  return fs.readFile(path.join(rootDir, relativePath), 'utf8')
    .catch((error) => {
      if (!isRepositoryCheckout) return '';
      throw error;
    });
}

const [
  manifestText,
  packageText,
  serverText,
  cliText,
  mcpText,
  backgroundText,
  browserDataText,
  debuggerSessionText,
  emulationActionsText,
  extensionErrorsText,
  focusContextText,
  keyboardEventsText,
  navigationActionsText,
  pageExecutionText,
  pageArtifactsText,
  pageReadActionsText,
  pageInteractionsText,
  pageScriptsText,
  runtimeActionsText,
  safetyGatesText,
  tabCleanupText,
  tabGroupPersistenceText,
  tabInfoText,
  tabLoadingText,
  traceActionsText,
  userPromptsText,
  workspaceTabsText,
  packageContentsCheckerText,
  privacyScannerText,
  checkWorkflowText,
  readmeText,
  architectureText,
  extensionDocsText,
  publishingText,
  roadmapText,
  mcpDocsText,
  pullRequestTemplateText,
  contributingText,
  codexChromeBridgeSkillText,
  llmsText,
] = await Promise.all([
  fs.readFile(path.join(rootDir, 'extension/manifest.json'), 'utf8'),
  fs.readFile(path.join(rootDir, 'package.json'), 'utf8'),
  fs.readFile(path.join(rootDir, 'native/host.mjs'), 'utf8'),
  readCliSource(rootDir),
  readMcpSource(rootDir),
  fs.readFile(path.join(rootDir, 'extension/background.js'), 'utf8'),
  fs.readFile(path.join(rootDir, 'extension/browser-data.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/debugger-session.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/emulation-actions.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/extension-errors.js'), 'utf8'),
  fs.readFile(path.join(rootDir, 'extension/focus-context.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/keyboard-events.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/navigation-actions.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/page-execution.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/page-artifacts.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/page-read-actions.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/page-interactions.js'), 'utf8').catch(() => ''),
  readPageScriptsSource(rootDir),
  fs.readFile(path.join(rootDir, 'extension/runtime-actions.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/safety-gates.js'), 'utf8'),
  fs.readFile(path.join(rootDir, 'extension/tab-cleanup.js'), 'utf8'),
  fs.readFile(path.join(rootDir, 'extension/tab-group-persistence.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/tab-info.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/tab-loading.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/trace-actions.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/user-prompts.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'extension/workspace-tabs.js'), 'utf8').catch(() => ''),
  fs.readFile(path.join(rootDir, 'scripts/package/check-package-contents.mjs'), 'utf8'),
  fs.readFile(path.join(rootDir, 'scripts/checks/release/check-privacy-scan.mjs'), 'utf8'),
  readRepoOnlyFile('.github/workflows/check.yml'),
  fs.readFile(path.join(rootDir, 'README.md'), 'utf8'),
  fs.readFile(path.join(rootDir, 'docs/ARCHITECTURE.md'), 'utf8'),
  fs.readFile(path.join(rootDir, 'docs/EXTENSION.md'), 'utf8'),
  fs.readFile(path.join(rootDir, 'docs/PUBLISHING.md'), 'utf8'),
  fs.readFile(path.join(rootDir, 'docs/COMPETITIVE-ROADMAP.md'), 'utf8'),
  fs.readFile(path.join(rootDir, 'docs/MCP.md'), 'utf8'),
  readRepoOnlyFile('.github/PULL_REQUEST_TEMPLATE.md'),
  fs.readFile(path.join(rootDir, 'CONTRIBUTING.md'), 'utf8'),
  readRepoOnlyFile('codex/skills/chrome-bridge/SKILL.md'),
  fs.readFile(path.join(rootDir, 'llms.txt'), 'utf8'),
]);
const manifest = JSON.parse(manifestText);
const packageJson = JSON.parse(packageText);
const cliUsageBlock = /function usage\(\) \{\n  return \[\n[\s\S]*?\n  \]\.join\('\\n'\);\n\}/.exec(cliText)?.[0] || '';
const readmeSmokeSummary = /^The smoke test opens .*$/m.exec(readmeText)?.[0] || '';

function check(condition, message) {
  if (!condition) failures.push(message);
}

function uniqueValues(values, label) {
  const seen = new Set();
  for (const value of values) {
    check(!seen.has(value), `${label} contains duplicate value: ${value}`);
    seen.add(value);
  }
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSet(left, right) {
  return sameArray([...left].sort(), [...right].sort());
}

function expectPayload(action, payload, ok, label) {
  try {
    validateCommandPayload(action, payload);
    check(ok, `${label} unexpectedly passed`);
  } catch (error) {
    check(!ok, `${label} unexpectedly failed: ${String(error?.message || error)}`);
  }
}

function functionBlock(source, name) {
  const marker = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = marker.exec(source);
  if (!match) return '';
  const paramsStart = source.indexOf('(', match.index);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        paramsEnd = index;
        break;
      }
    }
  }
  const braceStart = source.indexOf('{', paramsEnd);
  if (braceStart < 0) return '';
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  return '';
}

function mcpToolBlock(name) {
  const marker = `server.tool(\n  '${name}',`;
  const start = mcpText.indexOf(marker);
  if (start < 0) return '';
  const next = mcpText.indexOf('\n\nserver.tool(', start + marker.length);
  return mcpText.slice(start, next < 0 ? undefined : next);
}

function cliCommandBlock(command) {
  const marker = `if (cmd === '${command}')`;
  const start = cliText.indexOf(marker);
  if (start < 0) return '';
  const braceStart = cliText.indexOf('{', start);
  if (braceStart < 0) return '';
  let depth = 0;
  for (let index = braceStart; index < cliText.length; index += 1) {
    const char = cliText[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return cliText.slice(start, index + 1);
    }
  }
  return '';
}

uniqueValues(MANIFEST_PERMISSIONS, 'manifest permissions');
uniqueValues(EXTENSION_ACTIONS, 'extension actions');
uniqueValues(CLI_COMMANDS, 'CLI commands');
uniqueValues(CLI_USAGE_GROUPS.map((group) => group.id), 'CLI usage group ids');
uniqueValues(CLI_USAGE_LINES, 'CLI usage lines');
uniqueValues(DEBUGGER_SERIALIZED_ACTIONS, 'debugger serialized actions');
uniqueValues(MCP_TOOLS, 'MCP tools');

check(BRIDGE_VERSION === '0.4.1', `unexpected bridge version: ${BRIDGE_VERSION}`);
check(packageJson.version === BRIDGE_VERSION, `package.json version ${packageJson.version} does not match registry ${BRIDGE_VERSION}`);
check(manifest.manifest_version === 3, `extension manifest version must be 3, got ${manifest.manifest_version}`);
check(manifest.version === BRIDGE_VERSION, `extension manifest version ${manifest.version} does not match registry ${BRIDGE_VERSION}`);
check(sameSet(manifest.permissions || [], MANIFEST_PERMISSIONS), 'extension manifest permissions do not match registry permissions');
check((manifest.host_permissions || []).includes('<all_urls>'), 'extension manifest must explicitly declare <all_urls> host access');
check((packageJson.files || []).includes('shared/'), 'package.json files must include shared/');
check((packageJson.files || []).includes('docs/'), 'package.json files must include docs/');
check(packageJson.scripts?.['check:pack'] === 'node ./scripts/package/check-package-contents.mjs', 'check:pack must verify exact package contents');
check(packageJson.scripts?.['check:privacy'] === 'node ./scripts/checks/release/check-privacy-scan.mjs', 'check:privacy must run the privacy scanner');
check(packageJson.scripts?.['check:roadmap'] === 'node ./scripts/checks/release/check-roadmap-coverage.mjs', 'check:roadmap must verify merged roadmap coverage');
check(packageJson.scripts?.['check:mcp-prompts'] === 'node ./scripts/checks/mcp/check-mcp-prompts.mjs', 'check:mcp-prompts must verify MCP prompts');
check(packageJson.scripts?.['check:mcp-resources'] === 'node ./scripts/checks/mcp/check-mcp-resources.mjs', 'check:mcp-resources must verify MCP resources');
check(packageJson.scripts?.['check:tool-advisor'] === 'node ./scripts/checks/features/check-tool-advisor.mjs', 'check:tool-advisor must verify deterministic advisor surfaces');
check(packageJson.scripts?.['check:download-manager'] === 'node ./scripts/checks/extension/check-download-manager.mjs', 'check:download-manager must verify confirmed single-download behavior');
check(packageJson.scripts?.['check:emulation'] === 'node ./scripts/checks/extension/check-emulation.mjs', 'check:emulation must verify bounded viewport and network emulation behavior');
check(packageJson.scripts?.check?.includes('npm run check:privacy'), 'npm run check must include check:privacy');
check(packageJson.scripts?.check?.includes('npm run check:roadmap'), 'npm run check must include check:roadmap');
check(packageJson.scripts?.check?.includes('npm run check:mcp-prompts'), 'npm run check must include check:mcp-prompts');
check(packageJson.scripts?.check?.includes('npm run check:mcp-resources'), 'npm run check must include check:mcp-resources');
check(packageJson.scripts?.check?.includes('npm run check:tool-advisor'), 'npm run check must include check:tool-advisor');
check(packageJson.scripts?.check?.includes('npm run check:download-manager'), 'npm run check must include check:download-manager');
check(packageJson.scripts?.check?.includes('npm run check:emulation'), 'npm run check must include check:emulation');
check(packageJson.scripts?.check?.includes('node --check ./extension/download-actions.js'), 'npm run check must syntax-check extension/download-actions.js');
check(packageJson.scripts?.check?.includes('node --check ./extension/emulation-actions.js'), 'npm run check must syntax-check extension/emulation-actions.js');
check(packageJson.scripts?.check?.includes('node --check ./extension/tab-cleanup.js'), 'npm run check must syntax-check extension/tab-cleanup.js');
check(packageJson.scripts?.check?.includes('node --check ./extension/tab-group-persistence.js'), 'npm run check must syntax-check extension/tab-group-persistence.js');
if (isRepositoryCheckout || checkWorkflowText) {
  check(checkWorkflowText.includes('node-version:'), 'GitHub check workflow must use a Node.js version matrix');
  for (const nodeVersion of ['20', '22', '24']) {
    check(new RegExp(`-\\s*${nodeVersion}\\b`).test(checkWorkflowText), `GitHub check workflow must include Node.js ${nodeVersion}`);
  }
  for (const command of ['npm ci', 'npm run check', 'npm run check:audit', 'npm run check:pack']) {
    check(checkWorkflowText.includes(`run: ${command}`), `GitHub check workflow must run ${command}`);
  }
  check(!checkWorkflowText.includes('runtime-smoke'), 'GitHub check workflow must not run live runtime-smoke');
}
check(packageContentsCheckerText.includes('REQUIRED_PACKAGE_FILES'), 'package contents checker must declare required package files');
for (const requiredPackageFile of [
  'bin/cli/main.mjs',
  'mcp/server/main.mjs',
  'shared/command-registry.mjs',
  'shared/registry/actions.mjs',
  'shared/registry/metadata.mjs',
  'shared/registry/cli-usage.mjs',
  'shared/registry/surfaces.mjs',
  'shared/registry/generated-docs.mjs',
  'shared/registry/validation.mjs',
  'shared/registry/index.mjs',
  'shared/diagnostics-output.mjs',
  'shared/download-discovery.mjs',
  'shared/fetch-timeout.mjs',
  'shared/lighthouse-ingest.mjs',
  'shared/output-envelope.mjs',
  'shared/run-tabs.mjs',
  'shared/safe-record.mjs',
  'shared/session-group-title.mjs',
  'shared/structured-extract.mjs',
  'extension/download-actions.js',
  'extension/emulation-actions.js',
  'extension/extension-errors.js',
  'extension/page-scripts.js',
  'extension/page-scripts/main.js',
  'extension/navigation-actions.js',
  'extension/page-execution.js',
  'extension/page-artifacts.js',
  'extension/page-read-actions.js',
  'extension/tab-cleanup.js',
  'extension/tab-group-persistence.js',
  'extension/safety-gates.js',
  'extension/workspace-policy.js',
  'docs/COMMAND-CATALOG.md',
  'docs/COMPATIBILITY.md',
  'docs/COMPETITIVE-ROADMAP.md',
  'docs/DISTRIBUTION.md',
  'docs/MAINTAINABILITY.md',
  'scripts/checks/contracts/check-command-registry.mjs',
  'scripts/checks/contracts/check-registry-module-boundaries.mjs',
  'scripts/checks/contracts/check-bridge-contract.mjs',
  'scripts/checks/lib/registry-source.mjs',
  'scripts/docs/check-docs-coverage.mjs',
  'scripts/checks/release/check-roadmap-coverage.mjs',
  'scripts/checks/cli/check-cli-module-boundaries.mjs',
  'scripts/checks/lib/cli-source.mjs',
  'scripts/checks/mcp/check-mcp-module-boundaries.mjs',
  'scripts/checks/lib/mcp-source.mjs',
  'scripts/checks/extension/check-page-scripts-modules.mjs',
  'scripts/checks/lib/page-scripts-source.mjs',
  'scripts/checks/lib/file-metrics.mjs',
  'scripts/package/check-package-contents.mjs',
  'scripts/checks/release/check-privacy-scan.mjs',
  'scripts/checks/release/check-maintainability.mjs',
  'scripts/checks/extension/check-download-manager.mjs',
  'scripts/checks/extension/check-emulation.mjs',
  'scripts/checks/features/check-diagnostics.mjs',
  'scripts/checks/features/check-ubs-fixes.mjs',
  'scripts/checks/features/check-roadmap-next-slice.mjs',
]) {
  check(packageContentsCheckerText.includes(`'${requiredPackageFile}'`), `package contents checker must require ${requiredPackageFile}`);
}
check(privacyScannerText.includes('LOCAL_HOME_PATTERN'), 'privacy scanner must check local home paths');
check(privacyScannerText.includes('private-key'), 'privacy scanner must check private-key headers');
check(privacyScannerText.includes('secret-assignment'), 'privacy scanner must check obvious secret assignments');
check(!privacyScannerText.includes('package-lock.json'), 'privacy scanner must include package-lock.json in leak checks');
check(CLI_USAGE_LINES.length === CLI_COMMANDS.length, 'CLI usage line count must match CLI command count');
check(
  CLI_USAGE_GROUPS.reduce((sum, group) => sum + group.commands.length, 0) === CLI_COMMANDS.length,
  'CLI usage groups must cover every CLI command exactly once',
);
check(EXTENSION_ACTIONS.length === Object.keys(COMMAND_PAYLOAD_SCHEMAS).length, 'extension actions do not match payload schemas');
check(COMMAND_CATALOG.length === EXTENSION_ACTIONS.length, 'command catalog length does not match extension actions');
check(LOCAL_COMMAND_CATALOG.length === Object.keys(LOCAL_COMMAND_METADATA).length, 'local command catalog length does not match local metadata');

for (const action of DEBUGGER_SERIALIZED_ACTIONS) {
  check(EXTENSION_ACTIONS.includes(action), `debugger serialized action is not an extension action: ${action}`);
}

const dispatchBlock = functionBlock(backgroundText, 'dispatch');
check(dispatchBlock.includes('switch (action)'), 'extension background dispatch must switch on registry actions');
for (const action of EXTENSION_ACTIONS) {
  check(dispatchBlock.includes(`case '${action}':`), `extension background dispatch is missing registry action: ${action}`);
}

const cliMainBlock = functionBlock(cliText, 'main');
for (const command of CLI_COMMANDS) {
  check(cliMainBlock.includes(`cmd === '${command}'`), `CLI main() is missing registry command implementation: ${command}`);
}

for (const tool of MCP_TOOLS) {
  check(mcpText.includes(`'${tool}'`), `MCP server is missing registry tool implementation: ${tool}`);
}

const catalogCliCommands = new Set();
const catalogMcpTools = new Set();

function addCatalogReferences(entry, label) {
  for (const command of entry.cli || []) {
    check(!catalogCliCommands.has(command), `${label} duplicates CLI command reference: ${command}`);
    catalogCliCommands.add(command);
  }
  for (const tool of entry.mcp || []) {
    check(!catalogMcpTools.has(tool), `${label} duplicates MCP tool reference: ${tool}`);
    catalogMcpTools.add(tool);
  }
}

for (const action of EXTENSION_ACTIONS) {
  const schema = COMMAND_PAYLOAD_SCHEMAS[action];
  const metadata = COMMAND_METADATA[action];
  const catalog = COMMAND_CATALOG.find((entry) => entry.action === action);

  check(Array.isArray(schema), `${action} schema is missing`);
  uniqueValues(schema || [], `${action} payload schema`);
  check(metadata, `${action} metadata is missing`);
  check(catalog, `${action} catalog entry is missing`);
  if (!metadata || !catalog) continue;

  check(metadata.action === action, `${action} metadata action mismatch`);
  check(catalog === metadata, `${action} catalog should reference metadata entry`);
  check(sameArray(metadata.allowedKeys, schema), `${action} metadata allowedKeys drift`);
  check(metadata.riskTier === commandRiskTier(action), `${action} risk tier drift`);
  check(metadata.defaultTimeoutMs === commandDefaultTimeoutMs(action), `${action} timeout drift`);
  check(Number.isFinite(metadata.defaultTimeoutMs) && metadata.defaultTimeoutMs >= 5_000, `${action} timeout is too small`);
  check(typeof metadata.summary === 'string' && metadata.summary.length >= 12, `${action} summary is missing or too short`);
  check(typeof metadata.category === 'string' && metadata.category.length > 0, `${action} category is missing`);
  check(Array.isArray(metadata.cli), `${action} cli aliases must be an array`);
  check(Array.isArray(metadata.mcp), `${action} MCP tools must be an array`);

  for (const command of metadata.cli) {
    check(CLI_COMMANDS.includes(command), `${action} references unknown CLI command: ${command}`);
  }
  for (const tool of metadata.mcp) {
    check(MCP_TOOLS.includes(tool), `${action} references unknown MCP tool: ${tool}`);
  }

  if (metadata.requiresSensitiveConfirmation) {
    check(metadata.requiresConfirmation, `${action} sensitive confirmation must also require confirmation`);
    check(metadata.allowedKeys.includes('confirmSensitive'), `${action} sensitive action must allow confirmSensitive`);
  } else {
    check(!metadata.allowedKeys.includes('confirmSensitive'), `${action} non-sensitive action must not allow confirmSensitive`);
  }
  if (metadata.requiresConditionalConfirmation) {
    check(!metadata.requiresConfirmation, `${action} conditional confirmation should not force every scoped read to confirm`);
    check(metadata.allowedKeys.includes('confirmed'), `${action} conditional confirmation action must allow confirmed`);
  }
  if (metadata.riskTier === 'private-read') {
    check(metadata.requiresConfirmation, `${action} private-read action must require confirmation`);
  }

  addCatalogReferences(metadata, action);
}

for (const localCommand of LOCAL_COMMAND_CATALOG) {
  check(localCommand.id && LOCAL_COMMAND_METADATA[localCommand.id] === localCommand, `${localCommand.id || 'local command'} local metadata mismatch`);
  check(typeof localCommand.category === 'string' && localCommand.category.length > 0, `${localCommand.id} local category is missing`);
  check(typeof localCommand.riskTier === 'string' && localCommand.riskTier.length > 0, `${localCommand.id} local risk tier is missing`);
  check(typeof localCommand.summary === 'string' && localCommand.summary.length >= 12, `${localCommand.id} local summary is missing or too short`);
  check(Array.isArray(localCommand.cli), `${localCommand.id} local cli aliases must be an array`);
  check(Array.isArray(localCommand.mcp), `${localCommand.id} local MCP tools must be an array`);
  check(typeof localCommand.usesLiveBridge === 'boolean', `${localCommand.id} local live bridge flag must be boolean`);
  check(['yes', 'no', 'optional'].includes(localCommand.liveBridge), `${localCommand.id} local live bridge metadata must be yes/no/optional`);
  check(
    localCommand.defaultTimeoutMs === null
      || (Number.isFinite(localCommand.defaultTimeoutMs) && localCommand.defaultTimeoutMs >= 5_000),
    `${localCommand.id} local timeout must be null or at least 5000ms`,
  );

  for (const command of localCommand.cli) {
    check(CLI_COMMANDS.includes(command), `${localCommand.id} references unknown local CLI command: ${command}`);
  }
  for (const tool of localCommand.mcp) {
    check(MCP_TOOLS.includes(tool), `${localCommand.id} references unknown local MCP tool: ${tool}`);
  }

  addCatalogReferences(localCommand, localCommand.id);
}

for (const command of CLI_COMMANDS) {
  check(catalogCliCommands.has(command), `CLI command is not represented in any catalog metadata: ${command}`);
  check(
    CLI_USAGE_LINES.some((line) => line === `chrome-bridge ${command}` || line.startsWith(`chrome-bridge ${command} `)),
    `CLI command is missing a registry usage signature: ${command}`,
  );
  const groupMatches = CLI_USAGE_GROUPS.filter((group) => group.commands.includes(command));
  check(groupMatches.length === 1, `CLI command must appear in exactly one usage group: ${command}`);
  check(cliUsageLineForCommand(command).startsWith(`chrome-bridge ${command}`), `CLI command usage helper drift: ${command}`);
}
check(cliUsageBlock.includes('CLI_USAGE_LINES'), 'CLI usage() must be derived from registry CLI_USAGE_LINES');
check(cliUsageLineForCommand('open').includes('--allow-external'), 'CLI open usage must document the supported --allow-external flag');
check(cliUsageLineForCommand('doctor').includes('--live-checks'), 'CLI doctor usage must document explicit live checks');
for (const [action, command] of [
  ['windows', 'windows'],
  ['tabs', 'tabs'],
  ['group', 'group'],
  ['ensureTab', 'ensure-tab'],
  ['adoptTab', 'adopt-tab'],
  ['open', 'open'],
  ['closeGroup', 'close-group'],
]) {
  const usageLine = cliUsageLineForCommand(command);
  const block = cliCommandBlock(command);
  check(COMMAND_PAYLOAD_SCHEMAS[action].includes('groupTitle'), `${action} schema must allow groupTitle for scoped group overrides`);
  check(COMMAND_PAYLOAD_SCHEMAS[action].includes('groupColor'), `${action} schema must allow groupColor for scoped group overrides`);
  check(usageLine.includes('--group-title <title>'), `${command} usage must document --group-title`);
  check(usageLine.includes('--group-color <color>'), `${command} usage must document --group-color`);
  check(block.includes('...groupScopePayload(args)'), `${command} CLI command must pass group scope overrides to ${action}`);
}
for (const tool of MCP_TOOLS) {
  check(catalogMcpTools.has(tool), `MCP tool is not represented in any catalog metadata: ${tool}`);
}

for (const id of ['session-summary', 'debug-bundle', 'command-catalog', 'runtime-smoke']) {
  check(Boolean(LOCAL_COMMAND_METADATA[id]), `local command metadata is missing ${id}`);
}

expectPayload('findElements', { nearText: 'Billing address', limit: 5 }, true, 'findElements nearText payload');
expectPayload('findElements', { nearText: 42 }, false, 'findElements invalid nearText payload');
expectPayload('tabs', { includeAll: true }, false, 'tabs includeAll missing confirmation payload');
expectPayload('tabs', { includeAll: true, confirmed: true }, true, 'tabs includeAll confirmed payload');
expectPayload('windows', { includeAll: true }, false, 'windows includeAll missing confirmation payload');
expectPayload('windows', { includeAll: true, confirmed: true }, true, 'windows includeAll confirmed payload');
expectPayload('observe', { limit: 300, maxTextChars: 1_000 }, true, 'observe numeric bounds payload');
expectPayload('observe', { limit: 0 }, false, 'observe invalid limit payload');
expectPayload('findElements', { maxTextChars: 10 }, false, 'findElements invalid maxTextChars payload');
expectPayload('setWorkspace', { policyMode: 'strict', confirmed: true }, true, 'setWorkspace strict payload');
expectPayload('setWorkspace', { policyMode: 'permissive', confirmed: true }, false, 'setWorkspace invalid policy payload');
expectPayload('setWorkspace', { groupColor: 'cyan', confirmed: true }, true, 'setWorkspace valid group color payload');
expectPayload('setWorkspace', { groupColor: 'violet', confirmed: true }, false, 'setWorkspace invalid group color payload');
expectPayload('reloadExtension', {}, false, 'reloadExtension missing confirmation payload');
expectPayload('reloadExtension', { confirmed: true }, true, 'reloadExtension confirmed payload');
expectPayload('adoptTab', { tabId: 123, confirmed: true }, true, 'adoptTab tab payload');
expectPayload('adoptTab', { tabId: 0, confirmed: true }, true, 'adoptTab zero tab id payload');
expectPayload('adoptTab', { tabId: -1, confirmed: true }, false, 'adoptTab negative tab id payload');
expectPayload('adoptTab', { tabId: 1.5, confirmed: true }, false, 'adoptTab fractional tab id payload');
expectPayload('adoptTab', { tabId: 123, confirmed: true, allowExternal: true }, false, 'adoptTab allowExternal rejection');
expectPayload('open', {}, false, 'open missing url payload');
expectPayload('waitForSelector', {}, false, 'waitForSelector missing selector payload');
expectPayload('waitForSelector', { selector: 'main', timeoutMs: 0 }, true, 'waitForSelector zero timeout payload');
expectPayload('waitForSelector', { selector: 'main', timeoutMs: -1 }, false, 'waitForSelector negative timeout payload');
expectPayload('goBack', { timeoutMs: 300_000 }, true, 'goBack timeout payload');
expectPayload('goForward', { timeoutMs: 300_001 }, false, 'goForward invalid timeout payload');
expectPayload('reloadTab', { timeoutMs: -1 }, false, 'reloadTab invalid timeout payload');
expectPayload('extractPage', { kind: 'tables', maxItems: 5 }, true, 'extractPage kind payload');
expectPayload('extractPage', { kind: 'everything' }, false, 'extractPage invalid kind payload');
expectPayload('extractPage', { maxItems: 501 }, false, 'extractPage invalid maxItems payload');
expectPayload('snapshot', { maxChars: 200_000 }, true, 'snapshot maxChars payload');
expectPayload('text', { maxChars: 999 }, false, 'text invalid maxChars payload');
expectPayload('html', { maxChars: 500_000 }, true, 'html maxChars payload');
expectPayload('html', { maxChars: 500_001 }, false, 'html invalid maxChars payload');
expectPayload('printPdf', { scale: 2 }, true, 'printPdf scale payload');
expectPayload('printPdf', { scale: 99 }, false, 'printPdf invalid scale payload');
expectPayload('open', { url: 'https://example.com' }, true, 'open https payload');
expectPayload('ensureTab', { url: 'about:blank' }, true, 'ensureTab about:blank payload');
expectPayload('open', { url: 'javascript:alert(1)' }, false, 'open javascript URL rejection');
expectPayload('ensureTab', { url: 'data:text/html,<script>alert(1)</script>' }, false, 'ensureTab data URL rejection');
expectPayload('fetchUrl', { url: 'file:///etc/passwd', confirmed: true }, false, 'fetchUrl file URL rejection');
expectPayload('cookiesList', { url: 'chrome://settings', confirmed: true }, false, 'cookiesList chrome URL rejection');
expectPayload('click', { selector: 'button' }, false, 'click missing confirmation payload');
expectPayload('click', { selector: 'button', confirmed: true }, true, 'click confirmed payload');
expectPayload('uploadFile', { selector: 'input[type=file]', files: ['/tmp/a.txt'], confirmed: true }, true, 'uploadFile files payload');
expectPayload('uploadFile', { selector: 'input[type=file]', files: [123], confirmed: true }, false, 'uploadFile invalid files payload');
expectPayload('uploadFile', { selector: 'input[type=file]', confirmed: true }, false, 'uploadFile missing files payload');
expectPayload('fillForm', { fields: { '#name': 'Ada', '#count': 1, '#enabled': true }, dryRun: true }, true, 'fillForm primitive fields payload');
expectPayload('fillForm', { fields: { '#name': 'Ada' }, dryRun: true }, true, 'fillForm dry-run without confirmation payload');
expectPayload('fillForm', { fields: { '#name': 'Ada' }, dryRun: false }, false, 'fillForm apply missing confirmation payload');
expectPayload('fillForm', { fields: { '#name': 'Ada' }, dryRun: false, confirmed: true }, true, 'fillForm apply confirmed payload');
expectPayload('fillForm', { fields: { '#name': { nested: true } }, dryRun: true }, false, 'fillForm invalid nested fields payload');
expectPayload('fillForm', { dryRun: true }, false, 'fillForm missing fields payload');
expectPayload('fetchUrl', { url: 'https://example.com' }, false, 'fetchUrl missing confirmation payload');
expectPayload('fetchUrl', { url: 'https://example.com', headers: { 'x-test': 'ok' }, confirmed: true }, true, 'fetchUrl string headers payload');
expectPayload('fetchUrl', { url: 'https://example.com', headers: { 'x-test': 123 }, confirmed: true }, false, 'fetchUrl invalid headers payload');
expectPayload('fetchUrl', { url: 'https://example.com', method: 'POST', confirmed: true }, true, 'fetchUrl allowed method payload');
expectPayload('fetchUrl', { url: 'https://example.com', method: 'TRACE', confirmed: true }, false, 'fetchUrl invalid method payload');
expectPayload('fetchUrl', { url: 'https://example.com', credentials: 'omit', confirmed: true }, true, 'fetchUrl credentials payload');
expectPayload('fetchUrl', { url: 'https://example.com', credentials: 'same-origin', confirmed: true }, false, 'fetchUrl invalid credentials payload');
expectPayload('fetchUrl', { url: 'https://example.com', credentials: 'include', confirmed: true }, false, 'fetchUrl missing sensitive confirmation payload');
expectPayload('fetchUrl', { url: 'https://example.com', credentials: 'include', confirmed: true, confirmSensitive: true }, true, 'fetchUrl sensitive confirmed payload');
expectPayload('fetchUrl', { url: 'https://example.com', maxChars: 1, confirmed: true }, false, 'fetchUrl invalid maxChars payload');
expectPayload('traceStart', { maxEvents: 50, confirmed: true }, true, 'traceStart maxEvents payload');
expectPayload('traceStart', { maxEvents: 1, confirmed: true }, false, 'traceStart invalid maxEvents payload');
expectPayload('traceSummary', {}, true, 'traceSummary read payload');
expectPayload('traceSummary', { allowExternal: true }, true, 'traceSummary allowExternal payload');
expectPayload('traceEvents', { limit: 2_000 }, true, 'traceEvents limit payload');
expectPayload('traceStop', { limit: 2_001 }, false, 'traceStop invalid limit payload');
expectPayload('historySearch', { limit: 200, confirmed: true }, true, 'historySearch limit payload');
expectPayload('historySearch', { startTime: 0, endTime: 1, confirmed: true }, true, 'historySearch time filter payload');
expectPayload('historySearch', { startTime: -1, confirmed: true }, false, 'historySearch invalid startTime payload');
expectPayload('historySearch', { endTime: -1, confirmed: true }, false, 'historySearch invalid endTime payload');
expectPayload('bookmarksSearch', { limit: 201, confirmed: true }, false, 'bookmarksSearch invalid limit payload');
expectPayload('cookiesList', { url: 'https://example.com', limit: 500, confirmed: true }, true, 'cookiesList limit payload');
expectPayload('cookiesList', { url: 'https://example.com', limit: 501, confirmed: true }, false, 'cookiesList invalid limit payload');
expectPayload('cookiesList', { confirmed: true }, false, 'cookiesList whole jar missing sensitive confirmation payload');
expectPayload('cookiesList', { confirmed: true, confirmSensitive: true }, true, 'cookiesList whole jar sensitive confirmed payload');
expectPayload('storageSnapshot', { maxValueChars: 50, confirmed: true }, true, 'storageSnapshot maxValueChars payload');
expectPayload('storageSnapshot', { maxValueChars: 49, confirmed: true }, false, 'storageSnapshot invalid maxValueChars payload');
expectPayload('storageSnapshot', { includeValues: true, confirmed: true }, false, 'storageSnapshot missing sensitive confirmation payload');
expectPayload('storageSnapshot', { includeValues: true, confirmed: true, confirmSensitive: true }, true, 'storageSnapshot sensitive confirmed payload');
expectPayload('askUser', { question: 'Continue?', choices: ['Yes', { value: 'no', label: 'No' }] }, true, 'askUser choices payload');
expectPayload('askUser', { question: 'Continue?', choices: [123] }, false, 'askUser invalid choice payload');
expectPayload('askUser', { question: 'Continue?', choices: Array.from({ length: 9 }, (_, index) => `Choice ${index}`) }, false, 'askUser too many choices payload');
expectPayload('askUser', { question: 'Continue?', timeoutMs: 5_000 }, true, 'askUser timeoutMs payload');
expectPayload('askUser', { question: 'Continue?', timeoutMs: 4_999 }, false, 'askUser invalid timeoutMs payload');
expectPayload('askUser', {}, false, 'askUser missing question payload');
expectPayload('clickAt', { x: 0, y: 0, confirmed: true }, true, 'clickAt zero coordinates payload');
expectPayload('clickAt', { y: 5, confirmed: true }, false, 'clickAt missing x payload');
expectPayload('click', { confirmed: true }, false, 'click missing selector payload');
expectPayload('download', { selector: '#export' }, false, 'download missing confirmation payload');
expectPayload('download', { selector: '#export', confirmed: true }, true, 'download confirmed payload');
expectPayload('download', { selector: '#export', confirmed: true, downloadTimeoutMs: 1_000 }, true, 'download minimum timeout payload');
expectPayload('download', { selector: '#export', confirmed: true, downloadTimeoutMs: 999 }, false, 'download invalid timeout payload');
expectPayload('setViewport', { width: 1280, height: 720 }, false, 'setViewport missing confirmation payload');
expectPayload('setViewport', { width: 1280, height: 720, confirmed: true }, true, 'setViewport confirmed payload');
expectPayload('setViewport', { width: 199, height: 720, confirmed: true }, false, 'setViewport invalid width payload');
expectPayload('emulateNetwork', { networkProfile: 'slow-4g' }, false, 'emulateNetwork missing confirmation payload');
expectPayload('emulateNetwork', { networkProfile: 'slow-4g', confirmed: true }, true, 'emulateNetwork profile payload');
expectPayload('emulateNetwork', { networkProfile: 'custom', confirmed: true }, false, 'emulateNetwork custom missing bounds payload');
expectPayload('emulateNetwork', { networkProfile: 'custom', confirmed: true, latencyMs: 900, downloadKbps: 4096, uploadKbps: 2048 }, true, 'emulateNetwork custom payload');
expectPayload('clearEmulation', {}, false, 'clearEmulation missing confirmation payload');
expectPayload('clearEmulation', { confirmed: true }, true, 'clearEmulation confirmed payload');
expectPayload('type', { selector: '#name', text: '', confirmed: true }, true, 'type empty text payload');
expectPayload('type', { selector: '#name', confirmed: true }, false, 'type missing text payload');
expectPayload('press', { confirmed: true }, false, 'press missing key payload');
expectPayload('select', { confirmed: true }, false, 'select missing selector payload');
expectPayload('select', { selector: '#country', confirmed: true }, false, 'select missing target option payload');
expectPayload('select', { selector: '#country', index: 0, confirmed: true }, true, 'select zero index payload');
expectPayload('select', { selector: '#country', index: -1, confirmed: true }, false, 'select negative index payload');
expectPayload('select', { selector: '#country', index: 1.5, confirmed: true }, false, 'select fractional index payload');
expectPayload('listSelectOptions', {}, false, 'select-options missing selector payload');
expectPayload('click', { selector: 'button', confirmed: true, unknown: true }, false, 'unknown payload key rejection');

const historyUsageLine = cliUsageLineForCommand('history');
const historyCliBlock = cliCommandBlock('history');
check(historyUsageLine.includes('--start-time <ms>'), 'history CLI usage must document --start-time');
check(historyUsageLine.includes('--end-time <ms>'), 'history CLI usage must document --end-time');
check(historyCliBlock.includes("startTime: parseNumberRangeArg(args['start-time']"), 'history CLI command must parse --start-time');
check(historyCliBlock.includes("endTime: parseNumberRangeArg(args['end-time']"), 'history CLI command must parse --end-time');

const catalogPath = path.join(rootDir, 'docs/COMMAND-CATALOG.md');
const catalogText = await fs.readFile(catalogPath, 'utf8');
const catalogJson = commandCatalog();
check(catalogJson.cliCommands?.length === CLI_COMMANDS.length, 'command catalog must expose top-level CLI command names');
check(catalogJson.mcpTools?.length === MCP_TOOLS.length, 'command catalog must expose top-level MCP tool names');
check(catalogJson.counts?.cliCommands === CLI_COMMANDS.length, 'command catalog must expose CLI command count');
check(catalogJson.counts?.mcpTools === MCP_TOOLS.length, 'command catalog must expose MCP tool count');
check(catalogText === commandCatalogMarkdown(), 'docs/COMMAND-CATALOG.md is not generated from the current registry');
check(
  commandCatalogMarkdown().includes('| Action | Category | Risk | Default Timeout | CLI | MCP | Confirm | Direct Payload Keys | Summary |'),
  'generated command catalog action table must include default timeout and direct payload keys',
);
check(
  commandCatalogMarkdown().includes('| ID | Category | Risk | Default Timeout | CLI | MCP | Live Bridge | Summary |'),
  'generated command catalog local table must include default timeout',
);
check(
  commandCatalogMarkdown().includes('## CLI Usage Signatures'),
  'generated command catalog must include registry-owned CLI usage signatures',
);
check(
  commandCatalogMarkdown().includes('## Debugger-Serialized Actions'),
  'generated command catalog must include debugger-serialized action metadata',
);
check(
  commandCatalogMarkdown().includes('tabId, allowExternal'),
  'generated command catalog must expose direct payload key metadata',
);
check(
  commandCatalogMarkdown().includes('| windows | scope | read | 10000 ms | windows | chrome_bridge_windows | conditional |'),
  'generated command catalog must expose conditional confirmation metadata',
);
check(
  commandCatalogMarkdown().includes('| doctor | diagnostic | read | 10000 ms | doctor | chrome_bridge_doctor | optional |'),
  'generated command catalog must expose optional live bridge metadata for doctor',
);
check(serverText.includes('BRIDGE_VERSION'), 'Native Host must report the bridge version');
check(serverText.includes('startSocketServer'), 'Native Host must own the Unix Socket listener');
check(serverText.includes("request?.type === 'command'"), 'Native Host must dispatch command requests to Native Messaging');
check(serverText.includes('sendNativeMessage'), 'Native Host must relay commands through Native Messaging');
check(cliText.includes('timeoutMs ?? commandDefaultTimeoutMs(action)'), 'CLI command wrapper must default to registry action timeout');
check(cliText.includes('function normalizeHttpMethod(value)'), 'CLI must normalize and validate request --method');
check(functionBlock(cliText, 'doctor').includes("Boolean(args['live-checks'])"), 'CLI doctor must keep live checks behind --live-checks');
check(functionBlock(cliText, 'doctor').includes('Pass --live-checks'), 'CLI doctor offline mode must explain how to opt into live checks');
check(functionBlock(cliText, 'doctor').includes('runtime-smoke --coverage-plan'), 'CLI doctor offline mode must recommend the offline runtime smoke coverage plan');
check(functionBlock(cliText, 'doctor').includes('expectedBridgeVersion'), 'CLI doctor live checks must report expected bridge version');
check(functionBlock(cliText, 'doctor').includes('bridgeCurrent'), 'CLI doctor live checks must report whether the Native Messaging Host version is current');
check(cliText.includes("if (cmd === 'mcp-config')"), 'CLI mcp-config command must be implemented');
check(cliText.includes('function mcpConfigText'), 'CLI mcp-config must centralize MCP client snippet generation');
check(cliText.includes('Claude Code') && cliText.includes('Cursor') && cliText.includes('Hermes Agent'), 'CLI mcp-config must cover major MCP clients');
check(cliText.includes('function tomlString(value)'), 'CLI codex-config must escape TOML strings');
check(cliText.includes('command = ${tomlString(process.execPath)}'), 'CLI codex-config must use the current Node executable');
check(!cliText.includes('/opt/homebrew/bin/node'), 'CLI codex-config must not hardcode a Homebrew Node path');
check(cliText.includes("if (!args.confirm) throw new Error('reload-extension requires --confirm')"), 'CLI reload-extension must require --confirm');
check(CLI_USAGE_LINES.includes('chrome-bridge runtime-smoke [--keep-tab] [--coverage-plan] [--summary-only] [--out <file>]'), 'runtime-smoke CLI usage must expose offline coverage-plan mode and summary output');
check(packageJson.scripts?.['runtime-smoke:plan'] === 'node ./bin/chrome-bridge.mjs runtime-smoke --coverage-plan', 'package scripts must expose offline runtime smoke coverage plan');
check(packageJson.scripts?.['check:runtime-smoke-plan'] === 'node ./scripts/checks/release/check-runtime-smoke-plan.mjs', 'package scripts must expose runtime smoke plan contract check');
check(packageJson.scripts?.['check:roadmap'] === 'node ./scripts/checks/release/check-roadmap-coverage.mjs', 'package scripts must expose roadmap coverage contract check');
check(packageJson.scripts?.['check:cli-local-tools'] === 'node ./scripts/checks/cli/check-cli-local-tools.mjs', 'package scripts must expose CLI local tools contract check');
check(packageJson.scripts?.['check:mcp-runtime-smoke'] === 'node ./scripts/checks/mcp/check-mcp-runtime-smoke.mjs', 'package scripts must expose MCP runtime smoke contract check');
check(packageJson.scripts?.['check:mcp-local-tools'] === 'node ./scripts/checks/mcp/check-mcp-local-tools.mjs', 'package scripts must expose MCP local tools contract check');
check(packageJson.scripts?.['check:tab-group-persistence'] === 'node ./scripts/checks/extension/check-tab-group-persistence.mjs', 'package scripts must expose tab-group persistence behavior check');
check(packageJson.scripts?.['check:diagnostics'] === 'node ./scripts/checks/features/check-diagnostics.mjs', 'package scripts must expose diagnostics contract check');
check(packageJson.scripts?.['check:ubs-fixes'] === 'node ./scripts/checks/features/check-ubs-fixes.mjs', 'package scripts must expose UBS fix plan contract check');
check(packageJson.scripts?.['check:roadmap-next-slice'] === 'node ./scripts/checks/features/check-roadmap-next-slice.mjs', 'package scripts must expose next roadmap slice contract check');
check(packageJson.scripts?.['check:examples-gallery'] === 'node ./scripts/checks/features/check-examples-gallery.mjs', 'package scripts must expose examples gallery contract check');
check(packageJson.scripts?.['check:download-manager'] === 'node ./scripts/checks/extension/check-download-manager.mjs', 'package scripts must expose download-manager contract check');
check(packageJson.scripts?.['check:emulation'] === 'node ./scripts/checks/extension/check-emulation.mjs', 'package scripts must expose emulation contract check');
check(packageJson.scripts?.['check:network-export'] === 'node ./scripts/checks/features/check-network-export.mjs', 'package scripts must expose network-export contract check');
check(packageJson.scripts?.['check:client-docs'] === 'node ./scripts/docs/check-client-docs.mjs', 'package scripts must expose client docs contract check');
check(packageJson.scripts?.['check:client-config-examples'] === 'node ./scripts/docs/check-client-config-examples.mjs', 'package scripts must expose client config examples contract check');
check(packageJson.scripts?.['check:alias-package'] === 'node ./scripts/package/check-alias-package.mjs', 'package scripts must expose alias package contract check');
check(packageJson.scripts?.['check:act-preview'] === 'node ./scripts/checks/features/check-act-preview.mjs', 'package scripts must expose act-preview contract check');
check(packageJson.scripts?.['check:act-apply'] === 'node ./scripts/checks/features/check-act-apply.mjs', 'package scripts must expose act-apply contract check');
check(packageJson.scripts?.['check:lighthouse-plan'] === 'node ./scripts/checks/features/check-lighthouse-plan.mjs', 'package scripts must expose lighthouse-plan contract check');
check(packageJson.scripts?.['check:extension-package'] === 'node ./scripts/package/check-extension-package.mjs', 'package scripts must expose extension package contract check');
check(packageJson.scripts?.['extension:zip'] === 'node ./scripts/package/build-extension-zip.mjs', 'package scripts must expose extension zip packaging');
check(packageJson.files?.includes('examples/'), 'package files must include examples directory');
check(readmeText.includes('docs/EXAMPLES.md'), 'README must link examples gallery');
check(readmeText.includes('docs/COMPATIBILITY.md'), 'README must link MCP client compatibility guide');
check(readmeText.includes('docs/DISTRIBUTION.md'), 'README must link distribution and GitHub SEO guide');
check(readmeText.includes('docs/INSTALL.md'), 'README must link install fast paths');
check(readmeText.includes('docs/REGISTRY-SUBMISSIONS.md'), 'README must link registry submission guide');
check(readmeText.includes('docs/PRIVACY-POLICY.md'), 'README must link the privacy policy');
check(packageContentsCheckerText.includes('examples/fixtures/article-news.html'), 'package contents checker must require examples fixtures');
check(packageContentsCheckerText.includes('examples/mcp-clients/cursor.mcp.json'), 'package contents checker must require checked-in MCP client config examples');
check(packageContentsCheckerText.includes('shared/act-preview.mjs'), 'package contents checker must require act-preview shared helper');
check(packageContentsCheckerText.includes('shared/act-preview-state.mjs'), 'package contents checker must require act-preview state helper');
check(packageContentsCheckerText.includes('shared/lighthouse-plan.mjs'), 'package contents checker must require lighthouse-plan shared helper');
check(packageContentsCheckerText.includes('shared/network-export.mjs'), 'package contents checker must require network-export shared helper');
check(packageContentsCheckerText.includes('extension/download-actions.js'), 'package contents checker must require download-actions extension helper');
check(packageContentsCheckerText.includes('extension/emulation-actions.js'), 'package contents checker must require emulation-actions extension helper');
check(packageContentsCheckerText.includes('scripts/checks/features/check-lighthouse-plan.mjs'), 'package contents checker must require lighthouse-plan checker');
check(packageContentsCheckerText.includes('scripts/checks/extension/check-download-manager.mjs'), 'package contents checker must require download-manager checker');
check(packageContentsCheckerText.includes('scripts/checks/extension/check-emulation.mjs'), 'package contents checker must require emulation checker');
check(packageContentsCheckerText.includes('scripts/checks/features/check-network-export.mjs'), 'package contents checker must require network-export checker');
check(packageContentsCheckerText.includes('docs/INSTALL.md'), 'package contents checker must require the install guide');
check(packageContentsCheckerText.includes('docs/REGISTRY-SUBMISSIONS.md'), 'package contents checker must require the registry submissions guide');
check(packageContentsCheckerText.includes('docs/PRIVACY-POLICY.md'), 'package contents checker must require the privacy policy');
check(packageContentsCheckerText.includes('scripts/package/build-extension-zip.mjs'), 'package contents checker must require extension zip packaging');
check(packageContentsCheckerText.includes('scripts/docs/check-client-docs.mjs'), 'package contents checker must require client docs checker');
check(packageContentsCheckerText.includes('scripts/package/check-extension-package.mjs'), 'package contents checker must require extension package checker');
check(packageContentsCheckerText.includes('scripts/package/check-alias-package.mjs'), 'package contents checker must require alias package checker');
check(packageJson.scripts?.check?.includes('npm run check:runtime-smoke-plan'), 'npm run check must include runtime smoke plan contract check');
check(packageJson.scripts?.check?.includes('npm run check:roadmap'), 'npm run check must include roadmap coverage contract check');
check(packageJson.scripts?.check?.includes('npm run check:cli-local-tools'), 'npm run check must include CLI local tools contract check');
check(packageJson.scripts?.check?.includes('npm run check:mcp-runtime-smoke'), 'npm run check must include MCP runtime smoke contract check');
check(packageJson.scripts?.check?.includes('npm run check:mcp-local-tools'), 'npm run check must include MCP local tools contract check');
check(packageJson.scripts?.check?.includes('npm run check:tab-group-persistence'), 'npm run check must include tab-group persistence behavior check');
check(packageJson.scripts?.check?.includes('npm run check:examples-gallery'), 'npm run check must include examples gallery contract check');
check(packageJson.scripts?.check?.includes('npm run check:download-manager'), 'npm run check must include download-manager contract check');
check(packageJson.scripts?.check?.includes('npm run check:emulation'), 'npm run check must include emulation contract check');
check(packageJson.scripts?.check?.includes('npm run check:network-export'), 'npm run check must include network-export contract check');
check(packageJson.scripts?.check?.includes('npm run check:client-docs'), 'npm run check must include client docs contract check');
check(packageJson.scripts?.check?.includes('npm run check:client-config-examples'), 'npm run check must include client config examples contract check');
check(packageJson.scripts?.check?.includes('npm run check:alias-package'), 'npm run check must include alias package contract check');
check(packageJson.scripts?.check?.includes('npm run check:act-preview'), 'npm run check must include act-preview contract check');
check(packageJson.scripts?.check?.includes('npm run check:act-apply'), 'npm run check must include act-apply contract check');
check(packageJson.scripts?.check?.includes('npm run check:lighthouse-plan'), 'npm run check must include lighthouse-plan contract check');
check(packageJson.scripts?.check?.includes('npm run check:extension-package'), 'npm run check must include extension package contract check');
check(packageJson.scripts?.['check:runtime-smoke-plan'] && packageText.includes('check:runtime-smoke-plan'), 'package metadata must keep runtime smoke plan checker discoverable');
check(packageJson.scripts?.['check:roadmap'] && packageText.includes('check:roadmap'), 'package metadata must keep roadmap coverage checker discoverable');
check(packageJson.scripts?.['check:cli-local-tools'] && packageText.includes('check:cli-local-tools'), 'package metadata must keep CLI local tools checker discoverable');
check(packageJson.scripts?.['check:mcp-runtime-smoke'] && packageText.includes('check:mcp-runtime-smoke'), 'package metadata must keep MCP runtime smoke checker discoverable');
check(packageJson.scripts?.['check:mcp-local-tools'] && packageText.includes('check:mcp-local-tools'), 'package metadata must keep MCP local tools checker discoverable');
check(packageJson.scripts?.['check:tab-group-persistence'] && packageText.includes('check:tab-group-persistence'), 'package metadata must keep tab-group persistence checker discoverable');
check(packageJson.scripts?.['check:lighthouse-plan'] && packageText.includes('check:lighthouse-plan'), 'package metadata must keep lighthouse-plan checker discoverable');
check(packageJson.scripts?.['check:download-manager'] && packageText.includes('check:download-manager'), 'package metadata must keep download-manager checker discoverable');
check(packageJson.scripts?.['check:emulation'] && packageText.includes('check:emulation'), 'package metadata must keep emulation checker discoverable');
check(packageJson.scripts?.['check:network-export'] && packageText.includes('check:network-export'), 'package metadata must keep network-export checker discoverable');
check(packageJson.scripts?.['check:client-docs'] && packageText.includes('check:client-docs'), 'package metadata must keep client docs checker discoverable');
check(packageJson.scripts?.['check:extension-package'] && packageText.includes('check:extension-package'), 'package metadata must keep extension package checker discoverable');
check(packageJson.scripts?.['extension:zip'] && packageText.includes('extension:zip'), 'package metadata must keep extension zip packaging discoverable');
check(packageJson.scripts?.['check:alias-package'] && packageText.includes('check:alias-package'), 'package metadata must keep alias package checker discoverable');
check(readmeText.includes('npm run runtime-smoke:plan') && readmeText.includes('runtime-smoke --coverage-plan'), 'README must document offline runtime smoke coverage plan');
check(readmeText.includes('npm run check:roadmap'), 'README must document roadmap coverage contract check');
check(readmeText.includes('deferredLiveVerification'), 'README must document the check:roadmap deferred live verification gate output');
check(readmeText.includes('finalVerificationComplete'), 'README must document runtime smoke final completion marker');
check(readmeText.includes('npm run check:cli-local-tools'), 'README must document CLI local tools contract check');
check(readmeText.includes('npm run check:mcp-runtime-smoke'), 'README must document MCP runtime smoke contract check');
check(readmeText.includes('npm run check:mcp-local-tools'), 'README must document MCP local tools contract check');
check(readmeText.includes('CLI group scope payload forwarding'), 'README must document CLI group scope payload forwarding checks');
check(readmeText.includes('MCP group scope payload forwarding'), 'README must document MCP group scope payload forwarding checks');
check(readmeText.includes('npm run check:tab-group-persistence'), 'README must document tab-group persistence behavior check');
check(readmeText.includes('stale-extension/stale-bridge'), 'README must document stale-extension and stale-bridge verifier metadata');
check(readmeText.includes('structured JSON output'), 'README must document structured JSON verifier output');
check(readmeText.includes('CLI-exit preservation'), 'README must document CLI-exit preservation verifier evidence');
check(readmeText.includes('node ./bin/chrome-bridge.mjs reload-extension --confirm'), 'README must document exact live extension reload command');
check(readmeText.includes('node ./bin/chrome-bridge.mjs doctor --live-checks'), 'README must document exact live doctor command');
check(readmeText.includes('packaged registry check'), 'README must document package-layout registry verification');
check(readmeSmokeSummary.includes('existing-tab adoption'), 'README smoke summary must mention existing-tab adoption coverage');
check(readmeSmokeSummary.includes('dialog handling'), 'README smoke summary must mention dialog handling coverage');
check(readmeSmokeSummary.includes('file input upload'), 'README smoke summary must mention file input upload coverage');
check(readmeSmokeSummary.includes('savedClosedGroupChipPrevention'), 'README smoke summary must mention savedClosedGroupChipPrevention cleanup metadata');
check(publishingText.includes('npm run runtime-smoke:plan'), 'publishing checklist must use the canonical offline runtime smoke plan script');
check(publishingText.includes('npm run check:roadmap'), 'publishing checklist must include roadmap coverage contract check');
check(publishingText.includes('deferredLiveVerification'), 'publishing docs must document the check:roadmap deferred live verification gate output');
check(publishingText.includes('finalVerificationComplete'), 'publishing docs must document runtime smoke final completion marker');
check(publishingText.includes('npm run check:cli-local-tools'), 'publishing checklist must include CLI local tools contract check');
check(publishingText.includes('npm run check:mcp-runtime-smoke'), 'publishing checklist must include MCP runtime smoke contract check');
check(publishingText.includes('npm run check:mcp-local-tools'), 'publishing checklist must include MCP local tools contract check');
check(publishingText.includes('CLI group scope payload forwarding'), 'publishing docs must mention CLI group scope payload forwarding checks');
check(publishingText.includes('MCP group scope payload forwarding'), 'publishing docs must mention MCP group scope payload forwarding checks');
check(publishingText.includes('npm run check:tab-group-persistence'), 'publishing checklist must include tab-group persistence behavior check');
check(publishingText.includes('packaged registry check'), 'publishing docs must mention package-layout registry verification');
check(roadmapText.includes('npm run runtime-smoke:plan'), 'deferred runtime roadmap must use the canonical offline runtime smoke plan script');
check(packageContentsCheckerText.includes("'scripts/checks/release/check-runtime-smoke-plan.mjs'"), 'package contents must include runtime smoke plan checker');
check(packageContentsCheckerText.includes("'scripts/checks/release/check-roadmap-coverage.mjs'"), 'package contents must include roadmap coverage checker');
check(packageContentsCheckerText.includes("'scripts/checks/cli/check-cli-local-tools.mjs'"), 'package contents must include CLI local tools checker');
check(packageContentsCheckerText.includes("'scripts/checks/mcp/check-mcp-runtime-smoke.mjs'"), 'package contents must include MCP runtime smoke checker');
check(packageContentsCheckerText.includes("'scripts/checks/mcp/check-mcp-local-tools.mjs'"), 'package contents must include MCP local tools checker');
check(packageContentsCheckerText.includes("'scripts/checks/extension/check-tab-group-persistence.mjs'"), 'package contents must include tab-group persistence checker');
check(packageContentsCheckerText.includes("'scripts/checks/features/check-lighthouse-plan.mjs'"), 'package contents must include lighthouse-plan checker');
check(packageContentsCheckerText.includes("'scripts/checks/extension/check-download-manager.mjs'"), 'package contents must include download-manager checker');
check(packageContentsCheckerText.includes("'scripts/checks/extension/check-emulation.mjs'"), 'package contents must include emulation checker');
check(packageContentsCheckerText.includes("'scripts/checks/features/check-network-export.mjs'"), 'package contents must include network-export checker');
check(packageContentsCheckerText.includes("'scripts/docs/check-client-docs.mjs'"), 'package contents must include client docs checker');
check(packageContentsCheckerText.includes("'scripts/package/check-extension-package.mjs'"), 'package contents must include extension package checker');
check(packageContentsCheckerText.includes("'scripts/package/check-alias-package.mjs'"), 'package contents must include alias package checker');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes("runCli(['doctor'])"), 'CLI local tools checker must call doctor offline');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes("runCli(['extension-path'])"), 'CLI local tools checker must call extension-path');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes("runCli(['mcp-config'])"), 'CLI local tools checker must call mcp-config');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes("runCli(['codex-config'])"), 'CLI local tools checker must call codex-config');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes("runCli(['command-catalog'])"), 'CLI local tools checker must call command-catalog');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes('catalogJson.counts?.mcpTools'), 'CLI local tools checker must assert command-catalog counts');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes('sessionSummaryStaleBridgeRecommendation'), 'CLI local tools checker must assert stale-bridge session-summary recommendation');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes('groupScopePayloadChecks'), 'CLI local tools checker must assert group scope payload forwarding');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes('withFakeCommandBridge'), 'CLI local tools checker must use a fake command bridge for payload forwarding checks');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes('inventoryIncludeAllChecks'), 'CLI local tools checker must assert includeAll confirmation behavior');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes('privateSensitiveChecks'), 'CLI local tools checker must assert private sensitive confirmation behavior');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes('unsafeUrlMethodChecks'), 'CLI local tools checker must assert unsafe URL and method rejection behavior');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/cli/check-cli-local-tools.mjs'), 'utf8').catch(() => '')).includes('selectTargetChecks'), 'CLI local tools checker must assert select target validation behavior');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/release/check-runtime-smoke-plan.mjs'), 'utf8')).includes('stale-extension'), 'runtime smoke plan checker must cover stale-extension skip verification metadata');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-runtime-smoke.mjs'), 'utf8').catch(() => '')).includes('chrome_bridge_runtime_smoke'), 'MCP runtime smoke checker must call the MCP runtime smoke tool');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-runtime-smoke.mjs'), 'utf8').catch(() => '')).includes('cliExitError'), 'MCP runtime smoke checker must assert CLI exit metadata preservation');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-runtime-smoke.mjs'), 'utf8').catch(() => '')).includes('finalCommands'), 'MCP runtime smoke checker must assert deferred live verification command metadata');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-runtime-smoke.mjs'), 'utf8').catch(() => '')).includes('nextCommand'), 'MCP runtime smoke checker must assert deferred live verification next command metadata');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/release/check-runtime-smoke-plan.mjs'), 'utf8').catch(() => '')).includes('finalMcpCalls'), 'runtime smoke plan checker must assert deferred live verification MCP call metadata');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/release/check-runtime-smoke-plan.mjs'), 'utf8').catch(() => '')).includes('successCriteriaBridgeVersion'), 'runtime smoke plan checker must expose bridge-version success criteria');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/release/check-runtime-smoke-plan.mjs'), 'utf8').catch(() => '')).includes('staleBridgeCliExitPreserved'), 'runtime smoke plan checker must expose stale bridge CLI exit preservation in verifier output');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/release/check-runtime-smoke-plan.mjs'), 'utf8').catch(() => '')).includes('staleBridgeStructuredOutput'), 'runtime smoke plan checker must expose stale bridge structured-output preservation in verifier output');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-runtime-smoke.mjs'), 'utf8').catch(() => '')).includes('finalMcpCalls'), 'MCP runtime smoke checker must assert deferred live verification MCP call metadata');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-runtime-smoke.mjs'), 'utf8').catch(() => '')).includes('successCriteriaBridgeVersion'), 'MCP runtime smoke checker must expose bridge-version success criteria');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-runtime-smoke.mjs'), 'utf8').catch(() => '')).includes('staleBridgeCliExitPreserved'), 'MCP runtime smoke checker must expose stale bridge CLI exit preservation in verifier output');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-runtime-smoke.mjs'), 'utf8').catch(() => '')).includes('staleBridgeStructuredOutput'), 'MCP runtime smoke checker must expose stale bridge structured-output preservation in verifier output');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('chrome_bridge_doctor'), 'MCP local tools checker must call the MCP doctor tool');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('chrome_bridge_extension_path'), 'MCP local tools checker must call the MCP extension-path tool');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('chrome_bridge_codex_config'), 'MCP local tools checker must call the MCP codex-config tool');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('doctorLiveBridgeCurrent'), 'MCP local tools checker must assert live doctor bridge-version metadata');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('liveChecks === false'), 'MCP local tools checker must assert doctor stays offline by default');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('sessionSummaryStaleBridgeRecommendation'), 'MCP local tools checker must assert stale-bridge session-summary recommendation');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('MCP_TOOLS'), 'MCP local tools checker must compare live MCP listTools output with registry MCP_TOOLS');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('unexpected MCP tool'), 'MCP local tools checker must fail on extra unregistered MCP tools');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('catalogParsed?.mcpTools'), 'MCP local tools checker must verify command catalog MCP tool list');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('catalogParsed?.cliCommands'), 'MCP local tools checker must verify command catalog CLI command list');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('groupScopePayloadChecks'), 'MCP local tools checker must assert group scope payload forwarding');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('withFakeCommandBridge'), 'MCP local tools checker must use a fake command bridge for payload forwarding checks');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('inventoryIncludeAllChecks'), 'MCP local tools checker must assert includeAll confirmation behavior');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('privateSensitiveChecks'), 'MCP local tools checker must assert private sensitive confirmation behavior');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('unsafeUrlMethodChecks'), 'MCP local tools checker must assert unsafe URL and method rejection behavior');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/mcp/check-mcp-local-tools.mjs'), 'utf8').catch(() => '')).includes('selectTargetChecks'), 'MCP local tools checker must assert select target validation behavior');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/extension/check-tab-group-persistence.mjs'), 'utf8').catch(() => '')).includes('createFakeChrome'), 'tab-group persistence checker must use fake Chrome APIs');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/extension/check-tab-group-persistence.mjs'), 'utf8').catch(() => '')).includes('savedGroupPersistence'), 'tab-group persistence checker must assert removal persistence metadata');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/extension/check-tab-group-persistence.mjs'), 'utf8').catch(() => '')).includes('savedClosedGroupChips'), 'tab-group persistence checker must simulate saved closed group chips');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/extension/check-tab-group-persistence.mjs'), 'utf8').catch(() => '')).includes('sessionGroupIdWriteChecks'), 'tab-group persistence checker must behaviorally assert session group id writes');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/extension/check-tab-group-persistence.mjs'), 'utf8').catch(() => '')).includes('eventCallbackChecks'), 'tab-group persistence checker must verify listener event callbacks for future managed groups');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/extension/check-tab-group-persistence.mjs'), 'utf8').catch(() => '')).includes('zeroIdChecks'), 'tab-group persistence checker must verify zero-valued Chrome tab/group IDs');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/extension/check-tab-group-persistence.mjs'), 'utf8').catch(() => '')).includes('freshSessionGroupChecks'), 'tab-group persistence checker must verify fresh session groups stay ephemeral before close');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/release/check-roadmap-coverage.mjs'), 'utf8').catch(() => '')).includes('check-tab-group-persistence.mjs'), 'roadmap coverage must include the tab-group persistence behavior checker');
check((await fs.readFile(path.join(rootDir, 'scripts/checks/release/check-roadmap-coverage.mjs'), 'utf8').catch(() => '')).includes('deferredLiveVerification'), 'roadmap coverage output must expose a machine-readable deferred live verification gate');
check(readmeText.includes('fake saved closed group chips'), 'README must document fake saved closed group chip prevention coverage');
check(publishingText.includes('fake saved closed group chips'), 'publishing docs must document fake saved closed group chip prevention coverage');
check(readmeText.includes('listener event callbacks') && readmeText.includes('future managed groups'), 'README must document listener event callback coverage for future managed groups');
check(publishingText.includes('listener event callbacks') && publishingText.includes('future managed groups'), 'publishing docs must document listener event callback coverage for future managed groups');
check(readmeText.includes('freshly created bridge session groups'), 'README must document fresh bridge-created session group coverage');
check(publishingText.includes('fresh bridge-created session groups'), 'publishing docs must document fresh bridge-created session group coverage');
check(architectureText.includes('session-scoped bridge-created group IDs') && architectureText.includes('Chrome session storage'), 'architecture docs must document session-scoped managed group ids');
check(extensionDocsText.includes('session-scoped bridge-created group IDs') && extensionDocsText.includes('Chrome session storage'), 'extension setup docs must document session-scoped managed group ids');
if (isRepositoryCheckout || pullRequestTemplateText) {
  check(pullRequestTemplateText.includes('npm run check:runtime-smoke-plan'), 'pull request template must include offline runtime smoke plan check');
  check(pullRequestTemplateText.includes('npm run check:roadmap'), 'pull request template must include roadmap coverage check');
  check(pullRequestTemplateText.includes('npm run check:cli-local-tools'), 'pull request template must include CLI local tools contract check');
  check(pullRequestTemplateText.includes('npm run check:mcp-runtime-smoke'), 'pull request template must include MCP runtime smoke contract check');
  check(pullRequestTemplateText.includes('npm run check:mcp-local-tools'), 'pull request template must include MCP local tools contract check');
  check(pullRequestTemplateText.includes('npm run check:tab-group-persistence'), 'pull request template must include tab-group persistence behavior check');
  check(pullRequestTemplateText.includes('npm run check:privacy'), 'pull request template must include privacy scan check');
  check(pullRequestTemplateText.includes('npm run check:audit'), 'pull request template must include canonical audit check script');
  check(pullRequestTemplateText.includes('npm run runtime-smoke'), 'pull request template must use the canonical runtime-smoke script');
  check(!pullRequestTemplateText.includes('node ./bin/chrome-bridge.mjs runtime-smoke'), 'pull request template must not use raw node runtime-smoke command');
  check(pullRequestTemplateText.includes('verification.status: "passed"'), 'pull request template must document live runtime smoke success criteria');
  check(pullRequestTemplateText.includes('verification.nextCommand') && pullRequestTemplateText.includes('verification.nextAction'), 'pull request template must document runtime smoke recovery hints');
  check(pullRequestTemplateText.includes('top-level `nextCommand` / `nextAction`'), 'pull request template must document top-level runtime smoke recovery hints');
  check(pullRequestTemplateText.includes('reload-extension --confirm'), 'pull request template must include live extension reload before runtime smoke');
  check(pullRequestTemplateText.includes('doctor --live-checks'), 'pull request template must include live doctor check before runtime smoke');
}
check(contributingText.includes('npm run check:runtime-smoke-plan'), 'contributing guide must include offline runtime smoke plan check');
check(contributingText.includes('npm run check:roadmap'), 'contributing guide must include roadmap coverage check');
check(contributingText.includes('npm run check:cli-local-tools'), 'contributing guide must include CLI local tools contract check');
check(contributingText.includes('npm run check:mcp-runtime-smoke'), 'contributing guide must include MCP runtime smoke contract check');
check(contributingText.includes('npm run check:mcp-local-tools'), 'contributing guide must include MCP local tools contract check');
check(contributingText.includes('npm run check:tab-group-persistence'), 'contributing guide must include tab-group persistence behavior check');
check(contributingText.includes('npm run check:privacy'), 'contributing guide must include privacy scan check');
check(contributingText.includes('npm run check:audit'), 'contributing guide must include canonical audit check script');
check(contributingText.includes('verification.status: "passed"'), 'contributing guide must document live runtime smoke success criteria');
check(contributingText.includes('verification.nextCommand') && contributingText.includes('verification.nextAction'), 'contributing guide must document runtime smoke recovery hints');
check(contributingText.includes('top-level `nextCommand` / `nextAction`'), 'contributing guide must document top-level runtime smoke recovery hints');
check(contributingText.includes('reload-extension --confirm'), 'contributing guide must include live extension reload before runtime smoke');
check(contributingText.includes('doctor --live-checks'), 'contributing guide must include live doctor check before runtime smoke');
check(publishingText.includes('node ./bin/chrome-bridge.mjs reload-extension --confirm'), 'publishing checklist must include exact live extension reload command');
check(publishingText.includes('node ./bin/chrome-bridge.mjs doctor --live-checks'), 'publishing checklist must include exact live doctor command');
if (isRepositoryCheckout || codexChromeBridgeSkillText) {
  check(codexChromeBridgeSkillText.includes('runtime-smoke --coverage-plan'), 'bundled Codex chrome-bridge skill must recommend offline runtime smoke plan before live smoke');
  check(codexChromeBridgeSkillText.includes('npm run check:mcp-runtime-smoke'), 'bundled Codex chrome-bridge skill must mention MCP runtime-smoke contract check');
  check(codexChromeBridgeSkillText.includes('npm run check:tab-group-persistence'), 'bundled Codex chrome-bridge skill must mention tab-group persistence behavior check');
  check(codexChromeBridgeSkillText.includes('npm run check:privacy'), 'bundled Codex chrome-bridge skill must mention privacy scan check');
  check(codexChromeBridgeSkillText.includes('reload-extension --confirm'), 'bundled Codex chrome-bridge skill must include the live upgrade reload step');
  check(codexChromeBridgeSkillText.includes('doctor --live-checks'), 'bundled Codex chrome-bridge skill must include the live doctor upgrade check');
  check(codexChromeBridgeSkillText.includes('verification.status: "passed"'), 'bundled Codex chrome-bridge skill must document live runtime smoke success criteria');
  check(codexChromeBridgeSkillText.includes('verification.nextCommand') && codexChromeBridgeSkillText.includes('verification.nextAction'), 'bundled Codex chrome-bridge skill must document runtime smoke recovery hints');
  check(codexChromeBridgeSkillText.includes('top-level `nextCommand` / `nextAction`'), 'bundled Codex chrome-bridge skill must document top-level runtime smoke recovery hints');
  check(codexChromeBridgeSkillText.includes('deferredLiveVerification'), 'bundled Codex chrome-bridge skill must document check:roadmap deferred live gate output');
  check(codexChromeBridgeSkillText.includes('finalVerificationComplete'), 'bundled Codex chrome-bridge skill must document runtime smoke final completion marker');
}
check(llmsText.includes('runtime-smoke:plan'), 'llms metadata must mention offline runtime smoke plan');
check(llmsText.includes('check:tab-group-persistence'), 'llms metadata must mention tab-group persistence behavior check');
check(llmsText.includes('check:privacy'), 'llms metadata must mention privacy scan check');
check(llmsText.includes('reload-extension --confirm'), 'llms metadata must mention live extension reload before runtime smoke');
check(llmsText.includes('doctor --live-checks'), 'llms metadata must mention live doctor check before runtime smoke');
check(llmsText.includes('verification.status: "passed"'), 'llms metadata must mention live runtime smoke success criteria');
check(llmsText.includes('verification.nextCommand') && llmsText.includes('verification.nextAction'), 'llms metadata must mention runtime smoke recovery hints');
check(llmsText.includes('top-level `nextCommand` / `nextAction`'), 'llms metadata must mention top-level runtime smoke recovery hints');
check(llmsText.includes('deferredLiveVerification'), 'llms metadata must mention check:roadmap deferred live gate output');
check(llmsText.includes('finalVerificationComplete'), 'llms metadata must mention runtime smoke final completion marker');
check(mcpText.includes('timeoutMs ?? commandDefaultTimeoutMs(action)'), 'MCP bridgeCommand wrapper must default to registry action timeout');
check(mcpText.includes('CHROME_BRIDGE_MCP_TOOL_PROFILE'), 'MCP server must support compact tool profiles for IDE client compatibility');
check(mcpText.includes('chrome_bridge_cookies_list') && mcpText.includes('MCP_TOOL_PROFILES'), 'MCP tool profiles must make sensitive/private tools intentionally profile-gated');
check(mcpText.includes("server.prompt(\n  'chrome_bridge_read_first'"), 'MCP server must register the read-first prompt');
check(mcpText.includes("server.resource(\n  'current-profile'"), 'MCP server must register the current-profile resource');
check(mcpText.includes('chrome-bridge://profiles/current'), 'MCP server must expose the current-profile resource URI');
check(mcpText.includes('chrome_bridge_tool_advisor'), 'MCP server must register the tool advisor tool');
check(cliText.includes("if (cmd === 'advise')"), 'CLI must implement the advise command');
check(cliText.includes('buildToolAdvisor(toolAdvisorInput(args))'), 'CLI advise command must use the shared tool advisor');
check(LOCAL_COMMAND_METADATA.doctor?.mcp?.includes('chrome_bridge_doctor'), 'registry local doctor command must expose an MCP tool');
check(LOCAL_COMMAND_METADATA['extension-path']?.mcp?.includes('chrome_bridge_extension_path'), 'registry local extension-path command must expose an MCP tool');
check(LOCAL_COMMAND_METADATA['mcp-config']?.mcp?.includes('chrome_bridge_mcp_config'), 'registry local mcp-config command must expose an MCP tool');
check(LOCAL_COMMAND_METADATA['codex-config']?.mcp?.includes('chrome_bridge_codex_config'), 'registry local codex-config command must expose an MCP tool');
check(MCP_TOOLS.includes('chrome_bridge_doctor'), 'MCP tool list must include chrome_bridge_doctor');
check(MCP_TOOLS.includes('chrome_bridge_extension_path'), 'MCP tool list must include chrome_bridge_extension_path');
check(MCP_TOOLS.includes('chrome_bridge_mcp_config'), 'MCP tool list must include chrome_bridge_mcp_config');
check(MCP_TOOLS.includes('chrome_bridge_codex_config'), 'MCP tool list must include chrome_bridge_codex_config');
check(mcpText.includes('chrome_bridge_doctor'), 'MCP server must register chrome_bridge_doctor');
check(mcpText.includes('chrome_bridge_extension_path'), 'MCP server must register chrome_bridge_extension_path');
check(mcpText.includes('chrome_bridge_mcp_config'), 'MCP server must register chrome_bridge_mcp_config');
check(mcpText.includes('chrome_bridge_codex_config'), 'MCP server must register chrome_bridge_codex_config');
check(mcpText.includes("localCliText('extension-path')"), 'MCP extension-path tool must use the local CLI command');
check(mcpText.includes("localCliText('mcp-config'"), 'MCP mcp-config tool must use the local CLI command');
check(mcpText.includes("localCliText('codex-config')"), 'MCP codex-config tool must use the local CLI command');
check(mcpText.includes('liveChecks: z.boolean().optional()'), 'MCP doctor tool must expose optional liveChecks');
check(functionBlock(mcpText, 'localDoctor').includes("if (args.liveChecks) cliArgs.push('--live-checks')"), 'MCP doctor helper must keep live checks behind liveChecks=true');
check(mcpText.includes('chrome_bridge_reload_extension') && mcpText.includes('confirmed: z.boolean()'), 'MCP reload extension tool must require confirmed=true');
check(mcpDocsText.includes('chrome_bridge_doctor') && mcpDocsText.includes('liveChecks: true'), 'MCP docs must include doctor liveChecks in the live verification sequence');
check(mcpText.includes('TAB_GROUP_COLORS') && mcpText.includes('groupColor: z.enum(TAB_GROUP_COLORS).optional()'), 'MCP workspace groupColor schema must use the shared tab group color enum');
check(mcpText.includes('const chromeIdSchema = z.number().int().nonnegative()'), 'MCP tools must define a non-negative integer Chrome id schema');
check(!mcpText.includes('tabId: z.number().optional()'), 'MCP tools must not accept unconstrained numeric tabId values');
check(mcpText.includes('const selectIndexSchema = z.number().int().nonnegative()'), 'MCP select tool must define a non-negative integer option index schema');
check(!mcpToolBlock('chrome_bridge_select').includes('index: z.number().optional()'), 'MCP select tool must not accept unconstrained numeric option indexes');
check(mcpText.includes('function requireSelectTarget'), 'MCP select tool must validate an explicit option target before bridge dispatch');
check(mcpToolBlock('chrome_bridge_select').includes('requireSelectTarget(args)'), 'MCP select handler must call the option target guard');
for (const toolName of [
  'chrome_bridge_windows',
  'chrome_bridge_tabs',
  'chrome_bridge_group',
  'chrome_bridge_ensure_tab',
  'chrome_bridge_adopt_tab',
  'chrome_bridge_open',
  'chrome_bridge_close_group',
]) {
  const block = mcpToolBlock(toolName);
  check(block.includes('groupTitle: z.string().optional()'), `${toolName} MCP schema must expose groupTitle`);
  check(block.includes('groupColor: z.enum(TAB_GROUP_COLORS).optional()'), `${toolName} MCP schema must expose shared groupColor enum`);
}
check(mcpText.includes('coveragePlan: z.boolean().optional()'), 'MCP runtime smoke tool must expose coveragePlan option');
check(mcpText.includes("if (args.coveragePlan) cliArgs.push('--coverage-plan')"), 'MCP runtime smoke helper must forward coveragePlan to CLI');
check(mcpText.includes('extension v${BRIDGE_VERSION}'), 'MCP runtime smoke tool description must derive the required extension version from BRIDGE_VERSION');
check(!mcpText.includes('extension v0.4.0'), 'MCP runtime smoke tool description must not hardcode stale extension versions');
check(mcpText.includes('function parseLocalCliJson'), 'MCP local CLI helpers must centralize JSON stdout parsing');
const mcpRuntimeSmokeBlock = functionBlock(mcpText, 'localRuntimeSmoke');
check(mcpRuntimeSmokeBlock.includes('parseLocalCliJson(result.stdout)'), 'MCP runtime smoke helper must parse successful CLI JSON through the shared parser');
check(mcpRuntimeSmokeBlock.includes('parseLocalCliJson(error?.stdout)'), 'MCP runtime smoke helper must parse failed CLI JSON stdout before wrapping errors');
check(mcpRuntimeSmokeBlock.includes('cliExitError'), 'MCP runtime smoke helper must preserve CLI exit errors without dropping parsed smoke metadata');
check(mcpText.includes('verification.status="not-run"') && mcpText.includes('verification.status="passed"'), 'MCP runtime smoke tool description must document verification status semantics');
check(mcpDocsText.includes('verification.status: "not-run"') && mcpDocsText.includes('verification.status: "passed"'), 'MCP docs must document runtime smoke verification status semantics');
check(mcpText.includes('z.enum(HTTP_METHODS)'), 'MCP request method schema must use the shared HTTP method allowlist');
check(functionBlock(cliText, 'summaryRecommendations').includes('health?.bridge?.version || health?.extension?.info?.version'), 'CLI session summary recommendations must inspect Native Messaging Host version');
check(functionBlock(cliText, 'summaryRecommendations').includes('Restart the Native Messaging Host'), 'CLI session summary recommendations must suggest restarting a stale Native Messaging Host');
check(functionBlock(mcpText, 'summaryRecommendations').includes('health?.bridge?.version || health?.extension?.info?.version'), 'MCP session summary recommendations must inspect Native Messaging Host version');
check(functionBlock(mcpText, 'summaryRecommendations').includes('Restart the Native Messaging Host'), 'MCP session summary recommendations must suggest restarting a stale Native Messaging Host');
check(cliText.includes('includeSnapshot') && cliText.includes('includeScreenshot'), 'CLI debug bundle page artifacts must be explicit opt-in');
check(mcpText.includes('includeSnapshot: z.boolean().optional()') && mcpText.includes('includeScreenshot: z.boolean().optional()'), 'MCP debug bundle page artifacts must be explicit opt-in');
check(cliText.includes('function redactDebugBundleValue(value)') && mcpText.includes('function redactDebugBundleValue(value)'), 'debug bundle JSON artifacts must pass through a redaction helper');
check(cliText.includes("args['include-trace-events']") && mcpText.includes('includeTraceEvents: z.boolean().optional()'), 'debug bundle full trace events must be explicit opt-in');
check(COMMAND_METADATA.traceSummary?.summary?.includes('metadata'), 'registry must expose a traceSummary metadata-only action');
const cliDebugBundleBlock = functionBlock(cliText, 'debugBundle');
const mcpDebugBundleBlock = functionBlock(mcpText, 'debugBundle');
const runtimeSmokeBlock = functionBlock(cliText, 'runtimeSmoke');
const runtimeSmokeLiveVerificationBlock = functionBlock(cliText, 'runtimeSmokeLiveVerification');
const runtimeSmokeCoveragePlanBlock = functionBlock(cliText, 'runtimeSmokeCoveragePlan');
const runtimeSmokeCoverageBlock = functionBlock(cliText, 'runtimeSmokeCoverage');
const runtimeSmokeRequiredCoverageBlock = /const RUNTIME_SMOKE_REQUIRED_COVERAGE = Object\.freeze\(\[[\s\S]*?\]\);/.exec(cliText)?.[0] || '';
const pageExecuteBlock = functionBlock(pageExecutionText, 'execute');
const collectObserveBlock = functionBlock(pageScriptsText, 'collectObserve');
const collectExtractBlock = functionBlock(pageScriptsText, 'collectExtract');
const collectSnapshotBlock = functionBlock(pageScriptsText, 'collectSnapshot');
const fillFormInPageBlock = functionBlock(pageScriptsText, 'fillFormInPage');
const listSelectOptionsBlock = functionBlock(pageScriptsText, 'listSelectOptionsInPage');
check(pageExecuteBlock.includes('frame?.error'), 'page execution wrapper must throw injected frame errors instead of returning undefined');
check(collectObserveBlock.includes('stableSelectorForInjected'), 'observe injected script must use a local stable selector helper');
check(collectExtractBlock.includes('stableSelectorForInjected'), 'extract injected script must use a local stable selector helper');
check(collectSnapshotBlock.includes('stableSelectorForInjected'), 'snapshot injected script must use a local stable selector helper');
check(fillFormInPageBlock.includes('formFieldValueStateInjected') && collectExtractBlock.includes('formFieldValueStateInjected'), 'injected form helpers must not depend on module-scope formFieldValueState');
check(
  cliDebugBundleBlock.includes("command('traceSummary'")
    && cliDebugBundleBlock.includes('if (includeTraceEvents)')
    && cliDebugBundleBlock.includes("command('traceEvents'"),
  'CLI debug bundle must use traceSummary by default and reserve traceEvents for the explicit includeTraceEvents branch',
);
check(
  mcpDebugBundleBlock.includes("bridgeCommand('traceSummary'")
    && mcpDebugBundleBlock.includes('if (includeTraceEvents)')
    && mcpDebugBundleBlock.includes("bridgeCommand('traceEvents'"),
  'MCP debug bundle must use traceSummary by default and reserve traceEvents for the explicit includeTraceEvents branch',
);
check(cliText.includes("addJson('session-summary.json', redactDebugBundleValue(summary))"), 'CLI debug bundle session summary must be redacted');
check(mcpText.includes("addJson('session-summary.json', redactDebugBundleValue(summary))"), 'MCP debug bundle session summary must be redacted');
check(!LOCAL_COMMAND_METADATA['debug-bundle'].summary.includes('screenshot'), 'debug-bundle catalog summary must not imply screenshot capture by default');
for (const smokeStep of [
  'adopt existing smoke tab',
  'workspace includes smoke tab',
  'set strict smoke workspace',
  'strict policy rejects outside tab even with allowExternal',
  'session summary covers strict policy',
  'debug bundle default redaction',
  'cleanup close outside smoke group',
  'cleanup close smoke tab',
  'clear strict smoke workspace',
]) {
  check(runtimeSmokeBlock.includes(smokeStep), `runtime-smoke must cover deferred roadmap step: ${smokeStep}`);
}
check(runtimeSmokeBlock.includes("debugBundle({") && runtimeSmokeBlock.includes('readJsonFile'), 'runtime-smoke must inspect debug-bundle files without enabling page artifacts');
check(runtimeSmokeBlock.includes('assertTabCleanupMitigation'), 'runtime-smoke must assert tab cleanup mitigation metadata');
check(runtimeSmokeBlock.includes('savedGroupPersistence'), 'runtime-smoke must assert saved tab-group persistence metadata');
check(runtimeSmokeBlock.includes('savedClosedGroupChipPrevention'), 'runtime-smoke must assert saved closed group chip prevention metadata');
check(runtimeSmokeBlock.includes('RUNTIME_SMOKE_REQUIRED_COVERAGE'), 'runtime-smoke must declare required coverage names');
check(runtimeSmokeBlock.indexOf("args['coverage-plan']") >= 0, 'runtime-smoke must support offline coverage-plan mode');
check(
  runtimeSmokeBlock.indexOf("args['coverage-plan']") < runtimeSmokeBlock.indexOf("bridgeFetch('/health')"),
  'runtime-smoke coverage-plan mode must return before live bridge health checks',
);
check(runtimeSmokeCoveragePlanBlock.includes("status: 'not-run'"), 'runtime-smoke coverage-plan output must mark live verification as not-run');
check(runtimeSmokeCoveragePlanBlock.includes('liveVerificationRequired: true'), 'runtime-smoke coverage-plan output must explicitly require final live verification');
check(runtimeSmokeCoveragePlanBlock.includes('nextCommand') && runtimeSmokeCoveragePlanBlock.includes('nextAction'), 'runtime-smoke coverage-plan verification metadata must include next live recovery step');
check(runtimeSmokeCoveragePlanBlock.includes('coverageOk: true'), 'runtime-smoke coverage-plan output must document coverage.ok success criteria');
check(runtimeSmokeLiveVerificationBlock.includes("'passed'") && runtimeSmokeLiveVerificationBlock.includes("'failed'") && runtimeSmokeLiveVerificationBlock.includes('status: effectiveStatus'), 'runtime-smoke live output must include explicit passed/failed verification states');
check(runtimeSmokeLiveVerificationBlock.includes('finalCommands') && runtimeSmokeLiveVerificationBlock.includes('finalMcpCalls'), 'runtime-smoke live verification metadata must include final live CLI/MCP sequences');
check(runtimeSmokeLiveVerificationBlock.includes('nextCommand') && runtimeSmokeLiveVerificationBlock.includes('nextAction'), 'runtime-smoke live verification metadata must include contextual next recovery step');
check(runtimeSmokeLiveVerificationBlock.includes('bridgeVersion'), 'runtime-smoke live verification metadata must include bridge version');
check(runtimeSmokeBlock.includes("runtimeSmokeLiveVerification({ status: 'skipped'"), 'runtime-smoke stale-extension output must include explicit skipped verification state');
check(runtimeSmokeBlock.includes('Restart the Native Messaging Host first'), 'runtime-smoke must skip before fixture work when live Native Messaging Host version is stale');
check(runtimeSmokeBlock.includes('const verification = runtimeSmokeLiveVerification({') && runtimeSmokeBlock.includes('verification,'), 'runtime-smoke final output must include machine-readable live verification metadata');
check(runtimeSmokeBlock.includes('nextCommand: verification.nextCommand') && runtimeSmokeBlock.includes('nextAction: verification.nextAction'), 'runtime-smoke outputs must mirror recovery hints at the top level');
check(runtimeSmokeBlock.includes('let fatalError = null') && runtimeSmokeBlock.includes("name: 'runtime smoke fatal error'"), 'runtime-smoke must convert required-step exceptions into structured failed JSON');
check(runtimeSmokeBlock.includes("runtimeSmokeLiveVerification({ status: 'skipped'"), 'runtime-smoke version mismatch skip must include verification metadata');
for (const coverageStep of [
  'adopt existing smoke tab',
  'tabs scoped includes smoke tab',
  'observe nth-of-type selector fallback',
  'viewport screenshot',
  'selector screenshot',
  'wait for type side-effect',
  'wait for press side-effect',
  'wait for select side-effect',
  'handle dialog prompt',
  'upload file input',
  'wait for click side-effect',
  'wait for coordinate click side-effect',
  'trace events',
  'storage keys',
  'cookies metadata by url',
  'extension-context request',
  'history search scoped to fixture url',
  'safety: cookies whole jar requires confirmSensitive',
  'safety: storage values require confirmSensitive',
  'safety: credentialed request requires confirmSensitive',
]) {
  check(runtimeSmokeRequiredCoverageBlock.includes(`'${coverageStep}'`), `runtime-smoke required coverage must include ${coverageStep}`);
}
check(runtimeSmokeBlock.includes('Anonymous fallback target'), 'runtime-smoke fixture must include an anonymous selector fallback target');
check(runtimeSmokeBlock.includes('nth-of-type'), 'runtime-smoke must assert nth-of-type selector fallback behavior');
check(runtimeSmokeBlock.includes("await run('activate smoke tab before dialog'") && runtimeSmokeBlock.indexOf("activate smoke tab before dialog") < runtimeSmokeBlock.indexOf("click dialog trigger"), 'runtime-smoke must activate the smoke tab before opening a dialog');
check(runtimeSmokeBlock.includes('result.id !== tabId || !result.active') && !runtimeSmokeBlock.includes('result.tab?.id !== tabId || !result.tab?.active'), 'runtime-smoke must assert activateTab top-level tabInfo shape');
check(runtimeSmokeBlock.indexOf("await run('trace start'") >= 0 && runtimeSmokeBlock.indexOf("await run('trace start'") < runtimeSmokeBlock.indexOf("click dialog trigger"), 'runtime-smoke must attach debugger before opening a JavaScript dialog');
check(runtimeSmokeBlock.includes("const dialogTarget = await run('wait for dialog target'") && runtimeSmokeBlock.includes("await run('click dialog trigger', () => command('clickAt'") && runtimeSmokeBlock.includes('trusted: true'), 'runtime-smoke dialog trigger must use trusted coordinate input');
check(runtimeSmokeBlock.includes('const coverage = runtimeSmokeCoverage(steps)'), 'runtime-smoke must compute machine-readable coverage from completed steps');
check(runtimeSmokeBlock.includes('const ok = failures.length === 0 && coverage.ok') && runtimeSmokeBlock.includes('ok,'), 'runtime-smoke ok must fail when required coverage is missing');
check(runtimeSmokeCoverageBlock.includes('requiredCount') && runtimeSmokeCoverageBlock.includes('coveredCount') && runtimeSmokeCoverageBlock.includes('missingCount'), 'runtime-smoke coverage must include machine-readable coverage counts');
check(runtimeSmokeBlock.includes('coverage,'), 'runtime-smoke result must include machine-readable coverage');
check(debuggerSessionText.includes('const debuggerLocks = new Map()'), 'extension must maintain per-tab debugger locks');
check(functionBlock(debuggerSessionText, 'withTabLock').includes('debuggerLocks.set(tabId, next)'), 'withTabLock must serialize debugger work per tab');
check(functionBlock(debuggerSessionText, 'withDebugger').includes('return withTabLock(tabId'), 'withDebugger must run under the per-tab debugger lock');
check((debuggerSessionText.match(/chrome\.debugger\.sendCommand/g) || []).length === 1, 'extension must send debugger commands only through sendDebuggerCommand');
check((debuggerSessionText.match(/chrome\.debugger\.detach/g) || []).length === 1, 'extension must detach debugger only through detachDebugger');
check(functionBlock(debuggerSessionText, 'startTraceForTab').includes('withTabLock(tab.id'), 'traceStart debugger action must use the serialized debugger wrapper');
check(functionBlock(debuggerSessionText, 'stopTraceForTab').includes('withTabLock(tab.id'), 'traceStop debugger action must use the serialized debugger wrapper');
check(functionBlock(debuggerSessionText, 'startTraceForTab').includes("'Page.enable'"), 'traceStart must pre-enable the Page domain for dialog handling');
check(!functionBlock(pageInteractionsText, 'handleDialog').includes("'Page.enable'"), 'handleDialog must not call Page.enable after a modal dialog is already open');

const debuggerActionFunctions = {
  screenshot: 'screenshot',
  printPdf: 'printPdf',
  setViewport: 'setViewport',
  emulateNetwork: 'emulateNetwork',
  clearEmulation: 'clearEmulation',
  clickAt: 'clickAt',
  hover: 'hover',
  dragDrop: 'dragDrop',
  type: 'typeInto',
  press: 'pressKey',
  handleDialog: 'handleDialog',
  uploadFile: 'uploadFile',
  traceStart: 'traceStart',
  traceStop: 'traceStop',
};

for (const action of DEBUGGER_SERIALIZED_ACTIONS) {
  const source = ['screenshot', 'printPdf'].includes(action)
    ? pageArtifactsText
    : (['setViewport', 'emulateNetwork', 'clearEmulation'].includes(action)
      ? emulationActionsText
    : (['clickAt', 'hover', 'dragDrop', 'type', 'press', 'handleDialog', 'uploadFile'].includes(action)
      ? pageInteractionsText
      : (['traceStart', 'traceStop'].includes(action) ? traceActionsText : backgroundText)));
  const block = functionBlock(source, debuggerActionFunctions[action]);
  check(block, `${action} debugger action function is missing`);
  if (action === 'traceStart') {
    check(block.includes('startTraceForTab('), `${action} debugger action must use the serialized debugger wrapper`);
  } else if (action === 'traceStop') {
    check(block.includes('stopTraceForTab('), `${action} debugger action must use the serialized debugger wrapper`);
  } else {
    check(block.includes('withDebugger('), `${action} debugger action must use the serialized debugger wrapper`);
  }
}
check(mcpText.includes('const navigationUrlSchema'), 'MCP must define navigationUrlSchema for http/https/about:blank');
check(mcpText.includes('const webUrlSchema'), 'MCP must define webUrlSchema for http/https-only URL tools');
check(!mcpText.includes('z.string().url()'), 'MCP must not use broad z.string().url() because it accepts unsafe URL schemes');
check(!cliText.includes("confirmSensitive: Boolean(args['confirm-sensitive'])"), 'CLI must not emit confirmSensitive=false by default');
check(pageScriptsText.includes('function formFieldValueState(field'), 'form helpers must report value state without exposing values');
check(!pageScriptsText.includes('value: field.value'), 'extract form fields must not expose current field values');
check(!pageScriptsText.includes('selectedIndex: field'), 'extract form fields must not expose current select indexes');
check(!pageScriptsText.includes('before,'), 'fill-form preview must not expose current field values');
check(!pageScriptsText.includes('after: nextValue'), 'fill-form preview must not echo planned field values');
check(!listSelectOptionsBlock.includes('selectedIndex'), 'select-options must not expose current selected index without confirmation');
check(!listSelectOptionsBlock.includes('value: select.value'), 'select-options must not expose current selected value without confirmation');
check(!listSelectOptionsBlock.includes('selected: option.selected'), 'select-options must not expose current selected option without confirmation');
check(functionBlock(navigationActionsText, 'listTabs').includes("requireConfirmed(payload, 'tabs includeAll')"), 'extension tabs includeAll must require confirmation');
check(functionBlock(navigationActionsText, 'listWindows').includes("requireConfirmed(payload, 'windows includeAll')"), 'extension windows includeAll must require confirmation');
check(functionBlock(runtimeActionsText, 'reloadExtension').includes("requireConfirmed(payload, 'reloadExtension')"), 'extension reloadExtension must require confirmation');
check(backgroundText.includes("from './browser-data.js';"), 'extension background must import private browser-data handlers from extension/browser-data.js');
for (const helperName of ['historySearch', 'bookmarksSearch', 'flattenBookmarks', 'cookiesList', 'fetchUrl']) {
  check(!functionBlock(backgroundText, helperName), `extension background must not own browser-data internals: ${helperName}`);
}
check(browserDataText.includes('export async function historySearch'), 'extension browser data module must export historySearch');
check(browserDataText.includes('export async function bookmarksSearch'), 'extension browser data module must export bookmarksSearch');
check(browserDataText.includes('export async function cookiesList'), 'extension browser data module must export cookiesList');
check(browserDataText.includes('export async function fetchUrl'), 'extension browser data module must export fetchUrl');
check(functionBlock(browserDataText, 'historySearch').includes("requireConfirmed(payload, 'historySearch')"), 'extension browser data history must require confirmation');
check(functionBlock(browserDataText, 'cookiesList').includes("requireSensitiveConfirmed(payload, 'cookiesList without url/domain/name')"), 'extension browser data cookies whole-jar reads must require sensitive confirmation');
check(functionBlock(browserDataText, 'fetchUrl').includes("requireSensitiveConfirmed(payload, 'fetchUrl credentials=include')"), 'extension browser data credentialed requests must require sensitive confirmation');
check(runtimeActionsText.includes("import { requireConfirmed } from './safety-gates.js';"), 'extension runtime actions must import safety gates from extension/safety-gates.js');
check(!backgroundText.includes('function requireConfirmed'), 'extension background must not own confirmation gate internals');
check(!backgroundText.includes('function requireSensitiveConfirmed'), 'extension background must not own confirmation gate internals');
check(functionBlock(safetyGatesText, 'requireConfirmed').includes('confirmed=true'), 'safety gates module must enforce mutation confirmation');
check(functionBlock(safetyGatesText, 'requireSensitiveConfirmed').includes('confirmSensitive=true'), 'safety gates module must enforce sensitive confirmation');
check(backgroundText.includes("from './runtime-actions.js';"), 'extension background must import runtime actions from extension/runtime-actions.js');
check(!functionBlock(backgroundText, 'reloadExtension'), 'extension background must not own runtime action internals: reloadExtension');
check(runtimeActionsText.includes('export function reloadExtension'), 'extension runtime actions module must export reloadExtension');
check(functionBlock(runtimeActionsText, 'reloadExtension').includes('chrome.runtime.reload()'), 'extension runtime actions module must own runtime reload call');
check(backgroundText.includes("from './debugger-session.js';"), 'extension background must import debugger session helpers from extension/debugger-session.js');
check(!backgroundText.includes('traceSessions'), 'extension background must not own debugger trace session state');
check(!backgroundText.includes('debuggerLocks'), 'extension background must not own debugger lock state');
check(!backgroundText.includes('function withDebugger'), 'extension background must not own debugger lifecycle internals');
check(!backgroundText.includes('function sendDebuggerCommand'), 'extension background must not own debugger command internals');
check(!backgroundText.includes('function recordDebuggerEvent'), 'extension background must not own debugger event internals');
check(functionBlock(debuggerSessionText, 'withDebugger').includes('chrome.debugger.attach'), 'extension debugger session module must own debugger attach lifecycle');
check(functionBlock(debuggerSessionText, 'sendDebuggerCommand').includes('chrome.debugger.sendCommand'), 'extension debugger session module must own debugger commands');
check(functionBlock(debuggerSessionText, 'recordDebuggerEvent').includes('Network.responseReceived'), 'extension debugger session module must record trace debugger events');
check(debuggerSessionText.includes('traceSessions') && debuggerSessionText.includes('MAX_TRACE_EVENTS'), 'extension debugger session module must own trace session buffering');
check(pageInteractionsText.includes("import { keyEventPayload } from './keyboard-events.js';"), 'extension page interactions must import trusted key event mapping from extension/keyboard-events.js');
check(!backgroundText.includes('function keyEventPayload'), 'extension background must not own trusted key event mapping internals');
check(!backgroundText.includes('function keyCodeFor'), 'extension background must not own trusted key code mapping internals');
check(!backgroundText.includes('function virtualKeyCodeFor'), 'extension background must not own trusted virtual-key mapping internals');
check(functionBlock(keyboardEventsText, 'keyEventPayload').includes('windowsVirtualKeyCode'), 'extension keyboard event module must serialize debugger key events');
check(functionBlock(keyboardEventsText, 'keyCodeFor').includes('ArrowUp'), 'extension keyboard event module must map named key codes');
check(functionBlock(keyboardEventsText, 'virtualKeyCodeFor').includes('ArrowUp'), 'extension keyboard event module must map virtual key codes');
check(backgroundText.includes("from './navigation-actions.js';"), 'extension background must import navigation actions from extension/navigation-actions.js');
for (const helperName of ['listTabs', 'listWindows', 'ensureCodexTab', 'adoptTab', 'openTab', 'createGroupedTab', 'groupStatus', 'workspaceStatus', 'setWorkspace', 'clearWorkspace', 'activateTab', 'closeTab', 'closeGroup', 'goBack', 'goForward', 'reloadTab']) {
  check(!functionBlock(backgroundText, helperName), `extension background must not own navigation action internals: ${helperName}`);
}
for (const helperName of ['listTabs', 'listWindows', 'ensureCodexTab', 'adoptTab', 'openTab', 'groupStatus', 'workspaceStatus', 'setWorkspace', 'clearWorkspace', 'activateTab', 'closeTab', 'closeGroup', 'goBack', 'goForward', 'reloadTab']) {
  check(navigationActionsText.includes(`export async function ${helperName}`), `extension navigation actions module must export ${helperName}`);
}
check(functionBlock(navigationActionsText, 'openTab').includes('createGroupedTab(payload)'), 'extension navigation actions module must keep grouped new-tab creation path');
check(functionBlock(navigationActionsText, 'createGroupedTab').includes('withUserFocusPreserved'), 'extension navigation actions module must preserve user focus when creating the first grouped workspace window');
check(functionBlock(navigationActionsText, 'setWorkspace').includes("requireConfirmed(payload, 'setWorkspace')"), 'extension setWorkspace must require confirmation');
check(functionBlock(navigationActionsText, 'activateTab').includes('waitForActivatedTab(tab.id'), 'extension activateTab must wait for Chrome to report the tab as active');
check(functionBlock(navigationActionsText, 'waitForActivatedTab').includes('chrome.tabs.get(tabId)') && functionBlock(navigationActionsText, 'waitForActivatedTab').includes('candidate.active'), 'extension activateTab active-state wait helper must poll Chrome tab state');
check(functionBlock(navigationActionsText, 'closeTab').includes('closeTabsWithGroupPersistenceMitigation([tab])'), 'closeTab must use ungroup-before-close mitigation');
check(functionBlock(navigationActionsText, 'closeGroup').includes('closeTabsWithGroupPersistenceMitigation(tabs)'), 'closeGroup must use ungroup-before-close mitigation');
check(pageInteractionsText.includes("import { tabInfo } from './tab-info.js';") && navigationActionsText.includes("import { groupInfo, tabInfo } from './tab-info.js';"), 'extension tab/group serializers must be imported by active extension modules');
check(!backgroundText.includes('function groupInfo'), 'extension background must not own tab/group serializer internals');
check(!backgroundText.includes('function tabInfo'), 'extension background must not own tab/group serializer internals');
check(functionBlock(tabInfoText, 'groupInfo').includes('collapsed'), 'extension tab info module must serialize tab group metadata');
check(functionBlock(tabInfoText, 'tabInfo').includes('groupInfo(group)') && functionBlock(tabInfoText, 'tabInfo').includes('status'), 'extension tab info module must serialize tab metadata with group info');
check(navigationActionsText.includes("from './tab-loading.js';"), 'extension navigation actions must import tab loading helper from extension/tab-loading.js');
check(!backgroundText.includes('function waitForTabComplete'), 'extension background must not own tab loading internals');
check(!backgroundText.includes('function delay'), 'extension background must not own tab loading delay internals');
check(functionBlock(tabLoadingText, 'waitForTabComplete').includes("tab.status === 'complete'"), 'extension tab loading module must wait for complete tab status');
check(functionBlock(tabLoadingText, 'waitForTabComplete').includes('chrome.tabs.get'), 'extension tab loading module must poll Chrome tab state');
check(backgroundText.includes("from './trace-actions.js';"), 'extension background must import trace actions from extension/trace-actions.js');
for (const helperName of ['traceStart', 'traceEvents', 'traceSummaryCommand', 'traceStop']) {
  check(!functionBlock(backgroundText, helperName), `extension background must not own trace action internals: ${helperName}`);
}
for (const helperName of ['traceStart', 'traceEvents', 'traceSummaryCommand', 'traceStop']) {
  check(traceActionsText.includes(`export async function ${helperName}`), `extension trace actions module must export ${helperName}`);
}
check(functionBlock(traceActionsText, 'traceStart').includes("requireConfirmed(payload, 'traceStart')"), 'extension traceStart must require confirmation');
check(functionBlock(traceActionsText, 'traceStart').includes('startTraceForTab(tab, payload)'), 'extension traceStart must call debugger trace start helper');
check(functionBlock(traceActionsText, 'traceStop').includes('stopTraceForTab(tab, payload)'), 'extension traceStop must call debugger trace stop helper');
check(backgroundText.includes("from './user-prompts.js';"), 'extension background must import user prompt lifecycle helpers from extension/user-prompts.js');
check(!backgroundText.includes('pendingUserPrompts'), 'extension background must not own user prompt state');
check(!backgroundText.includes('function normalizePromptChoices'), 'extension background must not own user prompt choice normalization');
check(!functionBlock(backgroundText, 'createPromptTab'), 'extension background must not own user prompt tab creation');
check(!functionBlock(backgroundText, 'restoreStoredCodexTarget'), 'extension background must not own user prompt target restoration');
check(!functionBlock(backgroundText, 'completeUserPrompt'), 'extension background must not own user prompt completion');
check(userPromptsText.includes('const pendingUserPrompts = new Map()'), 'extension user prompt module must own pending prompt state');
check(userPromptsText.includes('export async function askUser'), 'extension user prompt module must export askUser');
check(userPromptsText.includes('export function completeUserPrompt'), 'extension user prompt module must export completeUserPrompt');
check(userPromptsText.includes('export function userPromptResponse'), 'extension user prompt module must export userPromptResponse for ask page reads');
check(userPromptsText.includes('export function handlePromptTabRemoved'), 'extension user prompt module must export prompt tab removal cleanup');
check(functionBlock(userPromptsText, 'askUser').includes('chrome.runtime.getURL'), 'extension user prompt module must open local ask page URLs');
check(
  functionBlock(userPromptsText, 'askUser').includes('closeTabsWithGroupPersistenceMitigation([tab], { ignoreMissing: true })')
    && functionBlock(userPromptsText, 'completeUserPrompt').includes('closeTabsWithGroupPersistenceMitigation([prompt.tabId], { ignoreMissing: true })'),
  'extension user prompt module must keep ungroup-before-close cleanup mitigation',
);
check(navigationActionsText.includes("from './workspace-tabs.js';") && pageInteractionsText.includes("from './workspace-tabs.js';") && traceActionsText.includes("from './workspace-tabs.js';"), 'extension action modules must import workspace tab helpers from extension/workspace-tabs.js');
for (const helperName of ['storageGet', 'storageSet', 'storageRemove', 'getTargetTab', 'getStoredCodexGroup', 'getCodexGroupTabs', 'ensureCodexGroupForTab', 'assertCodexScopedTab']) {
  check(!functionBlock(backgroundText, helperName), `extension background must not own workspace tab helper internals: ${helperName}`);
}
check(workspaceTabsText.includes('export async function getTargetTab'), 'extension workspace tabs module must export getTargetTab');
check(workspaceTabsText.includes('export async function ensureCodexGroupForTab'), 'extension workspace tabs module must export ensureCodexGroupForTab');
check(functionBlock(workspaceTabsText, 'chromeId').includes("typeof value === 'number'"), 'extension Chrome id helper must not coerce null or empty strings into id 0');
check(functionBlock(workspaceTabsText, 'getTargetTab').includes("policyMode === 'strict'"), 'extension workspace tabs module must enforce strict outside-tab policy');
check(functionBlock(workspaceTabsText, 'getTargetTab').includes('withUserFocusPreserved'), 'extension workspace tabs module must preserve user focus when creating background workspace windows');
check(functionBlock(workspaceTabsText, 'ensureCodexGroupForTab').includes('chrome.tabs.group'), 'extension workspace tabs module must own tab grouping');
check(functionBlock(workspaceTabsText, 'storageSet').includes('chrome.storage.local.set'), 'extension workspace tabs module must own workspace storage writes');
check(backgroundText.includes("import { extensionErrorCode, extensionErrorDetails } from './extension-errors.js';"), 'extension background must import error classification helpers from extension/extension-errors.js');
check(!backgroundText.includes('function extensionErrorCode'), 'extension background must not own extension error helper internals');
check(!backgroundText.includes('function extensionErrorDetails'), 'extension background must not own extension error helper internals');
check(functionBlock(extensionErrorsText, 'extensionErrorCode').includes('TAB_SCOPE_VIOLATION'), 'extension error module must classify tab-scope violations');
check(functionBlock(extensionErrorsText, 'extensionErrorDetails').includes('details.name'), 'extension error module must preserve safe error details');
check(focusContextText.includes('export async function withUserFocusPreserved'), 'extension focus context module must export shared focus preservation helper');
check(functionBlock(focusContextText, 'withUserFocusPreserved').includes('captureUserFocusContext'), 'extension focus context helper must capture current user focus before background work');
check(functionBlock(focusContextText, 'restoreUserFocusContext').includes('chrome.windows.update'), 'extension focus context helper must restore the previously focused window when possible');
check(backgroundText.includes("chrome.runtime.connectNative('com.codex.chrome_bridge')") || backgroundText.includes('chrome.runtime.connectNative(NATIVE_HOST_NAME)'), 'extension background must own the Native Messaging connection');
check(!backgroundText.includes('chrome.offscreen'), 'extension background must not depend on the removed offscreen transport');
check(pageInteractionsText.includes("import { execute } from './page-execution.js';"), 'extension page interactions must import page execution helper from extension/page-execution.js');
check(!functionBlock(backgroundText, 'execute'), 'extension background must not own page execution helper internals');
check(pageExecutionText.includes('export async function execute'), 'extension page execution module must export execute');
check(functionBlock(pageExecutionText, 'execute').includes('chrome.scripting.executeScript'), 'extension page execution module must own chrome.scripting execution');
check(functionBlock(pageExecutionText, 'execute').includes("world: options.world || 'ISOLATED'"), 'extension page execution module must preserve isolated-world default');
check(backgroundText.includes("from './page-artifacts.js';"), 'extension background must import page artifact actions from extension/page-artifacts.js');
for (const helperName of ['screenshot', 'printPdf']) {
  check(!functionBlock(backgroundText, helperName), `extension background must not own page artifact action internals: ${helperName}`);
  check(pageArtifactsText.includes(`export async function ${helperName}`), `extension page artifacts module must export ${helperName}`);
}
check(functionBlock(pageArtifactsText, 'screenshot').includes('chrome.tabs.captureVisibleTab'), 'extension page artifacts module must own viewport screenshot capture');
check(functionBlock(pageArtifactsText, 'screenshot').includes('Page.captureScreenshot'), 'extension page artifacts module must own debugger screenshot capture');
check(functionBlock(pageArtifactsText, 'screenshot').includes('setTimeout'), 'extension page artifacts module must own viewport capture delay');
check(functionBlock(pageArtifactsText, 'screenshot').includes('withUserFocusPreserved'), 'extension page artifacts module must preserve user focus during viewport capture');
check(functionBlock(pageArtifactsText, 'printPdf').includes('Page.printToPDF'), 'extension page artifacts module must own PDF printing');
check(backgroundText.includes("from './emulation-actions.js';"), 'extension background must import emulation actions from extension/emulation-actions.js');
for (const helperName of ['setViewport', 'emulateNetwork', 'clearEmulation']) {
  check(!functionBlock(backgroundText, helperName), `extension background must not own emulation action internals: ${helperName}`);
  check(emulationActionsText.includes(`export async function ${helperName}`), `extension emulation actions module must export ${helperName}`);
}
check(backgroundText.includes("from './page-read-actions.js';"), 'extension background must import page read actions from extension/page-read-actions.js');
for (const helperName of ['waitForSelector', 'observe', 'findElements', 'elementFilters', 'extractPage', 'snapshot', 'pageText', 'pageHTML', 'listSelectOptions', 'storageSnapshot']) {
  check(!functionBlock(backgroundText, helperName), `extension background must not own page read action internals: ${helperName}`);
}
for (const helperName of ['waitForSelector', 'observe', 'findElements', 'extractPage', 'snapshot', 'pageText', 'pageHTML', 'listSelectOptions', 'storageSnapshot']) {
  check(pageReadActionsText.includes(`export async function ${helperName}`), `extension page read actions module must export ${helperName}`);
}
check(functionBlock(pageReadActionsText, 'observe').includes('collectObserve'), 'extension page read actions module must use page observation scripts');
check(functionBlock(pageReadActionsText, 'findElements').includes('elementFilters'), 'extension page read actions module must preserve element filter echo');
check(functionBlock(pageReadActionsText, 'storageSnapshot').includes("requireSensitiveConfirmed(payload, 'storageSnapshot includeValues')"), 'extension page read actions storage snapshot must require sensitive confirmation for values');
check(backgroundText.includes("from './page-interactions.js';"), 'extension background must import page interactions from extension/page-interactions.js');
for (const helperName of ['scroll', 'click', 'clickAt', 'hover', 'dragDrop', 'typeInto', 'pressKey', 'selectOption', 'fillForm', 'handleDialog', 'uploadFile']) {
  check(!functionBlock(backgroundText, helperName), `extension background must not own page interaction internals: ${helperName}`);
}
for (const helperName of ['scroll', 'click', 'clickAt', 'hover', 'dragDrop', 'typeInto', 'pressKey', 'selectOption', 'fillForm', 'handleDialog', 'uploadFile']) {
  check(pageInteractionsText.includes(`export async function ${helperName}`), `extension page interactions module must export ${helperName}`);
}
check(functionBlock(pageInteractionsText, 'click').includes("throw new Error('click requires confirmed=true')"), 'extension click interaction must require confirmation');
check(functionBlock(pageInteractionsText, 'fillForm').includes("if (!dryRun) requireConfirmed(payload, 'fillForm')"), 'extension fillForm must keep dry-run-first confirmation behavior');
check(functionBlock(pageInteractionsText, 'uploadFile').includes("requireConfirmed(payload, 'uploadFile')"), 'extension uploadFile must require confirmation');
check(navigationActionsText.includes("import { closeTabsWithGroupPersistenceMitigation } from './tab-cleanup.js';"), 'extension navigation actions must import tab cleanup helper from extension/tab-cleanup.js');
check(workspaceTabsText.includes("from './tab-group-persistence.js';"), 'extension workspace tabs must import tab-group persistence helpers');
check(tabCleanupText.includes("from './tab-group-persistence.js';"), 'extension tab cleanup must import tab-group persistence helpers');
check(!backgroundText.includes('function tabIdForClose'), 'extension background must not own tab cleanup helper internals');
check(!backgroundText.includes('async function closeTabsWithGroupPersistenceMitigation'), 'extension background must not own tab cleanup helper internals');
check(tabGroupPersistenceText.includes('export async function disableSavedTabGroupIfSupported'), 'extension tab-group persistence module must export disableSavedTabGroupIfSupported');
check(tabGroupPersistenceText.includes('export async function disableSavedTabGroupsForTabs'), 'extension tab-group persistence module must export disableSavedTabGroupsForTabs');
check(tabGroupPersistenceText.includes('export async function enforceManagedTabGroupPersistence'), 'extension tab-group persistence module must export startup managed-group persistence enforcement');
check(tabGroupPersistenceText.includes('export function installTabGroupPersistenceListeners'), 'extension tab-group persistence module must export automatic persistence listeners');
check(functionBlock(tabGroupPersistenceText, 'disableSavedTabGroupIfSupported').includes("'saved'"), 'extension tab-group persistence must detect Chrome saved-group support without assuming it exists');
check(functionBlock(tabGroupPersistenceText, 'disableSavedTabGroupIfSupported').includes('saved: false'), 'extension tab-group persistence must disable saved groups when Chrome exposes that API');
const tabGroupPersistenceSweepBlock = functionBlock(tabGroupPersistenceText, 'enforceManagedTabGroupPersistence');
check(tabGroupPersistenceSweepBlock.includes('chrome.tabGroups.query({})'), 'extension tab-group persistence startup sweep must inspect open groups');
check(tabGroupPersistenceSweepBlock.includes('handleManagedTabGroupChange(group)'), 'extension tab-group persistence startup sweep must guard and mark managed groups unsaved');
check(tabGroupPersistenceText.includes('BRIDGE_MANAGED_TITLE_PREFIXES'), 'extension tab-group persistence must define managed Codex Bridge title prefixes for session groups');
check(functionBlock(tabGroupPersistenceText, 'isManagedCodexGroup').includes('isBridgeManagedTitle(title)'), 'extension tab-group persistence managed-group guard must recognize Codex Bridge session title families');
check(tabGroupPersistenceText.includes('codexManagedGroupTitles'), 'extension tab-group persistence startup sweep must include remembered bridge-created workspace titles');
check(workspaceTabsText.includes('codexManagedGroupTitles'), 'extension workspace grouping must remember bridge-created workspace titles for future sweeps');
check(tabGroupPersistenceText.includes('codexManagedGroupIds'), 'extension tab-group persistence must include session-scoped managed group ids');
check(workspaceTabsText.includes('chrome.storage.session') && workspaceTabsText.includes('codexManagedGroupIds'), 'extension workspace grouping must remember managed group ids in session storage only');
const tabGroupPersistenceListenersBlock = functionBlock(tabGroupPersistenceText, 'installTabGroupPersistenceListeners');
check(tabGroupPersistenceListenersBlock.includes('chrome.tabGroups.onCreated'), 'extension tab-group persistence listeners must watch created Codex groups');
check(tabGroupPersistenceListenersBlock.includes('chrome.tabGroups.onUpdated'), 'extension tab-group persistence listeners must watch updated Codex groups');
check(tabGroupPersistenceListenersBlock.includes('chrome.tabGroups.onRemoved'), 'extension tab-group persistence listeners must watch removed Codex groups');
check(tabGroupPersistenceListenersBlock.includes('chrome.tabs.onUpdated'), 'extension tab-group persistence listeners must watch tab group membership updates');
check(tabGroupPersistenceListenersBlock.includes('chrome.tabs.onRemoved'), 'extension tab-group persistence listeners must watch managed tab removals');
check(tabGroupPersistenceListenersBlock.includes('handleManagedTabGroupChange'), 'extension tab-group persistence listeners must route events through a managed-group guard');
check(functionBlock(tabGroupPersistenceText, 'handleManagedTabGroupChange').includes('disableSavedTabGroupIfSupported(group)'), 'extension tab-group persistence event handler must mark managed groups unsaved');
check(functionBlock(tabGroupPersistenceText, 'handleManagedTabGroupRemoved').includes('forgetManagedGroupTabs(group.id)'), 'extension tab-group persistence removal handler must forget managed group tab membership');
check(functionBlock(tabGroupPersistenceText, 'rememberManagedTabGroupMembership').includes('isManagedCodexGroup(group)'), 'extension tab-group persistence must remember only managed Codex tab groups');
check(backgroundText.includes('enforceManagedTabGroupPersistence,'), 'extension background must import startup managed-group persistence enforcement');
check(
  backgroundText.includes('installTabGroupPersistenceListeners,') && backgroundText.includes("from './tab-group-persistence.js';"),
  'extension background must import tab-group persistence listener installer',
);
check(backgroundText.includes('installTabGroupPersistenceListeners();'), 'extension background must install tab-group persistence listeners during service worker startup');
check(backgroundText.includes('enforceManagedTabGroupPersistence().catch(() => {});'), 'extension background must sweep existing managed groups during service worker startup');
check(functionBlock(workspaceTabsText, 'ensureCodexGroupForTab').includes('disableSavedTabGroupIfSupported(group)'), 'extension workspace grouping must mark Codex groups ephemeral when Chrome supports it');
check(functionBlock(navigationActionsText, 'openTab').includes('chromeId(payload.tabId)'), 'extension open action must treat Chrome tab id 0 as present when checking newTab conflicts');
const tabCloseMitigationBlock = functionBlock(tabCleanupText, 'closeTabsWithGroupPersistenceMitigation');
check(tabCloseMitigationBlock.includes('disableSavedTabGroupsForTabs(tabs)'), 'extension tab cleanup must try saved-group disablement before ungroup-before-close');
check(tabCloseMitigationBlock.includes('savedClosedGroupChipPrevention'), 'extension tab cleanup must report saved closed group chip prevention metadata');
check(tabCloseMitigationBlock.includes('chrome.tabs.ungroup'), 'extension tab cleanup must ungroup grouped bridge tabs before removing them');
check(tabCloseMitigationBlock.includes('chrome.tabs.remove'), 'extension tab cleanup mitigation must own tab removal');
check(
  tabCloseMitigationBlock.indexOf('chrome.tabs.ungroup') < tabCloseMitigationBlock.indexOf('chrome.tabs.remove'),
  'extension tab cleanup must attempt ungroup before remove',
);
check(
  tabCloseMitigationBlock.includes('throw new Error') && tabCloseMitigationBlock.includes('before close'),
  'extension tab cleanup must fail closed if grouped tabs cannot be ungrouped before close',
);
check((backgroundText.match(/chrome\.tabs\.remove/g) || []).length === 0, 'extension background must not remove tabs directly');
check((tabCleanupText.match(/chrome\.tabs\.remove/g) || []).length === 1, 'extension tab cleanup module must remove tabs only through closeTabsWithGroupPersistenceMitigation');
check(
  functionBlock(userPromptsText, 'askUser').includes('closeTabsWithGroupPersistenceMitigation([tab], { ignoreMissing: true })'),
  'askUser prompt race cleanup must use ungroup-before-close mitigation',
);
check(
  functionBlock(userPromptsText, 'completeUserPrompt').includes('closeTabsWithGroupPersistenceMitigation([prompt.tabId], { ignoreMissing: true })'),
  'askUser close-on-answer cleanup must use ungroup-before-close mitigation',
);

if (failures.length) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({
    ok: true,
    version: BRIDGE_VERSION,
    packageVersion: packageJson.version,
    manifestVersion: manifest.version,
    manifestPermissions: (manifest.permissions || []).length,
    actions: EXTENSION_ACTIONS.length,
    localCommands: LOCAL_COMMAND_CATALOG.length,
    cliCommands: CLI_COMMANDS.length,
    mcpTools: MCP_TOOLS.length,
  }, null, 2));
  process.stdout.write('\n');
}
