#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  readRunState,
  runStatePath,
} from '../../../shared/run-tabs.mjs';
import { validateCommandPayload } from '../../../shared/command-registry.mjs';
import { readRegistrySource } from '../lib/registry-source.mjs';
import { fetchUrl } from '../../../extension/browser-data.js';

import { readCliSource } from '../lib/cli-source.mjs';

import { readMcpSource } from '../lib/mcp-source.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function readProjectFile(filePath) {
  return fs.readFile(path.join(rootDir, filePath), 'utf8');
}

async function checkSourceSurface() {
  const [
    packageText,
    registryText,
    cliText,
    mcpText,
    browserDataText,
    nativeHostText,
    runTabsText,
    askText,
  ] = await Promise.all([
    readProjectFile('package.json'),
    readRegistrySource(rootDir),
    readCliSource(rootDir),
    readMcpSource(rootDir),
    readProjectFile('extension/browser-data.js'),
    readProjectFile('native/host.mjs'),
    readProjectFile('shared/run-tabs.mjs'),
    readProjectFile('extension/ask.js'),
  ]);
  const packageJson = JSON.parse(packageText);

  check(packageJson.scripts?.['check:ubs-fixes'] === 'node ./scripts/checks/features/check-ubs-fixes.mjs', 'package.json must expose check:ubs-fixes');
  check(packageJson.scripts?.check?.includes('node --check ./scripts/checks/features/check-ubs-fixes.mjs'), 'npm run check must syntax-check check-ubs-fixes');
  check(packageJson.scripts?.check?.includes('npm run check:ubs-fixes'), 'npm run check must include check:ubs-fixes');

  check(registryText.includes("fetchUrl: ['url', 'method', 'headers', 'body', 'credentials', 'maxChars', 'requestTimeoutMs', 'confirmed', 'confirmSensitive']"), 'fetchUrl payload schema must allow requestTimeoutMs');
  check(registryText.includes("ensureNumberRange(normalizedPayload, 'requestTimeoutMs', action"), 'registry must bound fetchUrl requestTimeoutMs');
  let acceptsRequestTimeoutMs = false;
  try {
    validateCommandPayload('fetchUrl', {
      url: 'https://example.com',
      confirmed: true,
      requestTimeoutMs: 1_000,
    });
    acceptsRequestTimeoutMs = true;
  } catch {
    acceptsRequestTimeoutMs = false;
  }
  check(acceptsRequestTimeoutMs, 'validateCommandPayload must accept bounded fetchUrl requestTimeoutMs');

  check(cliText.includes('nativeBridgeCommand'), 'CLI bridge commands must use Native Messaging');
  check(cliText.includes('requestTimeoutMs: parseNumberRangeArg(args'), 'CLI request command must forward requestTimeoutMs');
  check(mcpText.includes('nativeBridgeCommand'), 'MCP bridge commands must use Native Messaging');
  check(mcpText.includes('requestTimeoutMs: z.number().min(1000).max(60000).optional()'), 'MCP request tool must expose bounded requestTimeoutMs');
  check(browserDataText.includes('AbortController') && browserDataText.includes('signal:'), 'extension fetchUrl must pass an AbortSignal to fetch');
  check(browserDataText.includes('FETCH_URL_TIMEOUT'), 'extension fetchUrl aborts must expose stable FETCH_URL_TIMEOUT code');

  check(nativeHostText.includes('startSocketServer'), 'Native Messaging Host must own the Unix Socket listener');
  check(nativeHostText.includes('sendNativeMessage'), 'Native Messaging Host must relay commands through Native Messaging');
  check(runTabsText.includes("from './safe-record.mjs'"), 'run-tabs must import safe record helper');
  check(runTabsText.includes('stripUnsafeObjectKeys(meta'), 'run-tabs must sanitize persisted tab metadata');
  check(runTabsText.includes('.corrupt.') && runTabsText.includes('parseError'), 'run-tabs must quarantine malformed JSON state files');

  check(askText.includes('function requiredElement'), 'ask prompt page must define requiredElement');
  check(askText.includes("requiredElement('#question')"), 'ask prompt page must use requiredElement for required controls');
}

async function checkSafeRecordHelper() {
  let module;
  try {
    module = await import(pathToFileURL(path.join(rootDir, 'shared/safe-record.mjs')).href);
  } catch (error) {
    check(false, `safe-record helper must be importable: ${String(error?.message || error)}`);
    return;
  }

  const input = JSON.parse('{"ok":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true}}');
  const clean = module.stripUnsafeObjectKeys(input);
  check(clean.ok === 1, 'safe-record helper must preserve safe own keys');
  check(!Object.prototype.hasOwnProperty.call(clean, '__proto__'), 'safe-record helper must remove __proto__');
  check(!Object.prototype.hasOwnProperty.call(clean, 'constructor'), 'safe-record helper must remove constructor');
  check(!Object.prototype.hasOwnProperty.call(clean, 'prototype'), 'safe-record helper must remove prototype');
  check({}.polluted === undefined, 'safe-record helper must not pollute Object.prototype');
}

async function checkCorruptRunStateRecovery() {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-ubs-corrupt-state-'));
  try {
    const runId = 'ubs-corrupt-state';
    const filePath = runStatePath({ runId, stateDir });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{not valid json');

    let state = null;
    try {
      state = await readRunState({ runId, stateDir });
    } catch (error) {
      check(false, `readRunState must recover from malformed JSON: ${String(error?.message || error)}`);
      return;
    }

    check(state?.runId === runId, 'corrupt run-state recovery must preserve runId');
    check(Array.isArray(state?.ownedTabIds) && state.ownedTabIds.length === 0, 'corrupt run-state recovery must return empty ownedTabIds');
    check(state?.parseError?.corruptPath, 'corrupt run-state recovery must expose corruptPath metadata');
    const entries = await fs.readdir(stateDir);
    check(entries.some((entry) => entry.includes('.corrupt.')), 'corrupt run-state recovery must preserve bad file as .corrupt artifact');
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

async function checkFetchUrlAbortSignal() {
  const originalFetch = globalThis.fetch;
  let capturedOptions = null;
  try {
    globalThis.fetch = async (_url, options = {}) => {
      capturedOptions = options;
      return new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    };

    const result = await fetchUrl({
      url: 'https://example.com',
      confirmed: true,
      requestTimeoutMs: 1_000,
    });
    check(result.ok === true, 'fetchUrl fake response must succeed');
    check(capturedOptions?.signal instanceof AbortSignal, 'fetchUrl must pass AbortSignal to fetch');
    check(capturedOptions?.signal?.aborted === false, 'fetchUrl AbortSignal must not be pre-aborted');
  } catch (error) {
    check(false, `fetchUrl AbortSignal check failed: ${String(error?.message || error)}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await checkSourceSurface();
await checkSafeRecordHelper();
await checkCorruptRunStateRecovery();
await checkFetchUrlAbortSignal();

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
