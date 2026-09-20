#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function exists(relativePath) {
  return fs.access(path.join(rootDir, relativePath)).then(() => true, () => false);
}

async function read(relativePath) {
  return fs.readFile(path.join(rootDir, relativePath), 'utf8').catch(() => '');
}

const packageText = await read('package.json');
const packageJson = packageText ? JSON.parse(packageText) : {};
const scripts = packageJson.scripts || {};
const packageFiles = packageJson.files || [];
const readmeText = await read('README.md');
const planText = await read('PROPOSED_CODE_FILE_REORGANIZATION_PLAN.md');

const stableEntrypoints = [
  'bin/chrome-bridge.mjs',
  'mcp/chrome-bridge-mcp.mjs',
  'native/host.mjs',
  'extension/manifest.json',
  'extension/background.js',
  'extension/ask.html',
  'extension/ask.js',
];

for (const entrypoint of stableEntrypoints) {
  check(await exists(entrypoint), `stable entrypoint is missing: ${entrypoint}`);
}

check(packageJson.bin?.['chrome-bridge'] === './bin/chrome-bridge.mjs', 'chrome-bridge bin path must remain stable');
check(packageJson.bin?.['chrome-bridge-mcp'] === './mcp/chrome-bridge-mcp.mjs', 'chrome-bridge-mcp bin path must remain stable');
check(packageFiles.includes('scripts/'), 'published package must still include scripts/');
check(packageFiles.includes('extension/'), 'published package must still include extension/');
check(scripts['check:reorganization-boundaries'] === 'node ./scripts/checks/release/check-reorganization-boundaries.mjs', 'package.json must expose check:reorganization-boundaries at the release checker path');
check(scripts.check?.includes('node --check ./scripts/checks/release/check-reorganization-boundaries.mjs'), 'npm run check must syntax-check the reorganization checker');
check(scripts.check?.includes('npm run check:reorganization-boundaries'), 'npm run check must run check:reorganization-boundaries');
check(readmeText.includes('check:reorganization-boundaries'), 'README verification docs must mention check:reorganization-boundaries');
check(planText.includes('Recommended First Implementation PR'), 'reorganization plan must be present');

const expectedScriptPaths = [
  ['extension:zip', 'node ./scripts/package/build-extension-zip.mjs'],
  ['docs:commands', 'node ./scripts/docs/generate-command-catalog.mjs'],
  ['check:docs', 'node ./scripts/docs/check-docs-coverage.mjs'],
  ['check:registry', 'node ./scripts/checks/contracts/check-command-registry.mjs'],
  ['check:bridge-contract', 'node ./scripts/checks/contracts/check-bridge-contract.mjs'],
  ['check:runtime-smoke-plan', 'node ./scripts/checks/release/check-runtime-smoke-plan.mjs'],
  ['check:cli-local-tools', 'node ./scripts/checks/cli/check-cli-local-tools.mjs'],
  ['check:mcp-local-tools', 'node ./scripts/checks/mcp/check-mcp-local-tools.mjs'],
  ['check:tab-group-persistence', 'node ./scripts/checks/extension/check-tab-group-persistence.mjs'],
  ['check:act-preview', 'node ./scripts/checks/features/check-act-preview.mjs'],
  ['check:streamable-http-plan', 'node ./scripts/checks/docs/check-streamable-http-plan.mjs'],
  ['check:privacy', 'node ./scripts/checks/release/check-privacy-scan.mjs'],
  ['check:pack', 'node ./scripts/package/check-package-contents.mjs'],
];

for (const [scriptName, expectedCommand] of expectedScriptPaths) {
  check(scripts[scriptName] === expectedCommand, `${scriptName} must point to ${expectedCommand}`);
  const scriptPath = expectedCommand.replace(/^node \.\//, '');
  check(await exists(scriptPath), `script target is missing: ${scriptPath}`);
}

const forbiddenFlatScripts = [
  'scripts/build-extension-zip.mjs',
  'scripts/check-command-registry.mjs',
  'scripts/check-docs-coverage.mjs',
  'scripts/check-cli-local-tools.mjs',
  'scripts/check-mcp-local-tools.mjs',
  'scripts/check-tab-group-persistence.mjs',
  'scripts/check-act-preview.mjs',
  'scripts/check-streamable-http-plan.mjs',
  'scripts/check-privacy-scan.mjs',
];

for (const oldPath of forbiddenFlatScripts) {
  check(!(await exists(oldPath)), `script should move out of flat scripts/: ${oldPath}`);
}

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
