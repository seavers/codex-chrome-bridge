#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function read(relativePath) {
  return fs.readFile(path.join(rootDir, relativePath), 'utf8').catch(() => '');
}

async function exists(relativePath) {
  return fs.access(path.join(rootDir, relativePath)).then(() => true, () => false);
}

const packageText = await read('package.json');
const packageJson = packageText ? JSON.parse(packageText) : {};
const wrapperText = await read('bin/chrome-bridge.mjs');
const mainText = await read('bin/cli/main.mjs');
const cliSourceHelperText = await read('scripts/checks/lib/cli-source.mjs');

const requiredFiles = [
  'bin/chrome-bridge.mjs',
  'bin/cli/main.mjs',
  'scripts/checks/lib/cli-source.mjs',
  'scripts/checks/cli/check-cli-module-boundaries.mjs',
];

for (const requiredFile of requiredFiles) {
  check(await exists(requiredFile), `CLI module file is missing: ${requiredFile}`);
  check(
    packageJson.scripts?.check?.includes(`node --check ./${requiredFile}`),
    `npm run check must syntax-check ${requiredFile}`,
  );
}

check(packageJson.bin?.['chrome-bridge'] === './bin/chrome-bridge.mjs', 'chrome-bridge bin path must remain stable');
check(packageJson.scripts?.['check:cli-modules'] === 'node ./scripts/checks/cli/check-cli-module-boundaries.mjs', 'package.json must expose check:cli-modules');
check(packageJson.scripts?.check?.includes('npm run check:cli-modules'), 'npm run check must run check:cli-modules');
check(wrapperText.startsWith('#!/usr/bin/env node'), 'bin/chrome-bridge.mjs must keep its executable shebang');
check(wrapperText.includes("import { main } from './cli/main.mjs';"), 'bin/chrome-bridge.mjs must import main from ./cli/main.mjs');
check(wrapperText.includes('main().catch'), 'bin/chrome-bridge.mjs must keep top-level error handling');
check((wrapperText.match(/\n/g) || []).length <= 12, 'bin/chrome-bridge.mjs wrapper must stay tiny');
check(!wrapperText.includes("cmd === '"), 'bin/chrome-bridge.mjs wrapper must not contain command dispatch internals');
check(mainText.includes('export async function main()'), 'bin/cli/main.mjs must export the CLI main function');
check(mainText.includes('function parseArgs') && mainText.includes("cmd === 'health'"), 'bin/cli/main.mjs must own CLI parsing and command dispatch');
check(cliSourceHelperText.includes('readCliSource') && cliSourceHelperText.includes('bin/cli/main.mjs'), 'CLI source helper must aggregate wrapper and implementation files');

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
