#!/usr/bin/env node
import { createFakeNativeBridge } from '../lib/fake-native-bridge.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { formatReadOutput } from '../../../shared/output-envelope.mjs';
import { validateCommandPayload } from '../../../shared/command-registry.mjs';
import { readRegistrySource } from '../lib/registry-source.mjs';

const execFileAsync = promisify(execFile);
import { readCliSource } from '../lib/cli-source.mjs';

import { readMcpSource } from '../lib/mcp-source.mjs';

import { readPageScriptsSource } from '../lib/page-scripts-source.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = path.join(rootDir, 'bin/chrome-bridge.mjs');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function inheritedEnv(extra = {}) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
    ...extra,
  };
}

async function runCli(args, env) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: rootDir,
      env,
      timeout: 20_000,
    });
    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
      parsed: JSON.parse(result.stdout),
    };
  } catch (error) {
    let parsed = null;
    try {
      parsed = JSON.parse(error?.stdout || '');
    } catch {
      // Non-JSON failure output is reported below.
    }
    return {
      ok: false,
      stdout: error?.stdout || '',
      stderr: error?.stderr || '',
      parsed,
      error,
    };
  }
}

async function withFakeBridge(fn) {
  const receivedCommands = [];
  const server = createFakeNativeBridge(async (req, res) => {
    if (req.url !== '/command' || req.method !== 'POST') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unexpected path' }));
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    receivedCommands.push(parsed);

    try {
      validateCommandPayload(parsed.action, parsed.payload || {});
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        code: 'INVALID_PAYLOAD',
        error: String(error?.message || error),
      }));
      return;
    }

    if (parsed.action === 'text') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: {
          tab: { id: parsed.payload.tabId ?? 11, url: 'https://example.test/full-page', title: 'Full page text' },
          text: 'Top section\nLower payout section',
          length: 'Top section\nLower payout section'.length,
          truncated: false,
          fullPageDiagnostics: {
            mode: 'full-page-scroll-walk',
            scrollSteps: 4,
            requiredTextFound: true,
            restoredScroll: true,
          },
        },
      }));
      return;
    }

    if (parsed.action === 'snapshot') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: {
          tab: { id: parsed.payload.tabId ?? 12, url: 'https://example.test/full-page-snapshot', title: 'Full page snapshot' },
          url: 'https://example.test/full-page-snapshot',
          title: 'Full page snapshot',
          headings: [{ level: 'h2', text: 'Lower payout section' }],
          elements: [],
          tables: [],
          jsonLd: [],
          text: 'Top section\nLower payout section',
          textLength: 'Top section\nLower payout section'.length,
          truncated: false,
          fullPageDiagnostics: {
            mode: 'full-page-scroll-walk',
            scrollSteps: 4,
            requiredTextFound: true,
            restoredScroll: true,
          },
        },
      }));
      return;
    }

    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `unexpected action ${parsed.action}` }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { path: socketPath } = server.address();
    return await fn({
      socketPath: socketPath,
      receivedCommands,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function functionBlock(source, name) {
  const start = source.indexOf(`export async function ${name}(`) >= 0
    ? source.indexOf(`export async function ${name}(`)
    : source.indexOf(`export function ${name}(`);
  if (start < 0) return '';
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

const [
  pageScripts,
  registry,
  cli,
  mcp,
] = await Promise.all([
  readPageScriptsSource(rootDir),
  readRegistrySource(rootDir),
  readCliSource(rootDir),
  readMcpSource(rootDir),
]);

const collectTextBlock = functionBlock(pageScripts, 'collectText');
const collectSnapshotBlock = functionBlock(pageScripts, 'collectSnapshot');

check(registry.includes("snapshot: [...maxChars, 'fullPage'"), 'snapshot payload schema must allow fullPage read options');
check(registry.includes("text: [...maxChars, 'fullPage'"), 'text payload schema must allow fullPage read options');
check(registry.includes("'waitForText'") && registry.includes("'waitForPattern'"), 'registry must allow required text/pattern read options');
check(registry.includes("'scrollStepPx'") && registry.includes("'maxScrollSteps'") && registry.includes("'scrollDelayMs'"), 'registry must allow bounded scroll-walk tuning options');
check(cli.includes("args['full-page']") && cli.includes("args['wait-for-text']"), 'CLI must parse full-page text/snapshot flags');
check(mcp.includes('fullPage: z.boolean().optional()') && mcp.includes('waitForText: z.string().optional()'), 'MCP text/snapshot schemas must expose full-page flags');
check(collectTextBlock.includes('full-page-scroll-walk'), 'collectText must implement full-page scroll-walk diagnostics');
check(collectTextBlock.includes('restore') || collectTextBlock.includes('restoredScroll'), 'collectText must restore original scroll state');
check(collectSnapshotBlock.includes('full-page-scroll-walk'), 'collectSnapshot must share full-page text coverage semantics');
check(collectSnapshotBlock.includes('fullPageDiagnostics'), 'collectSnapshot must return fullPageDiagnostics');
check(!collectTextBlock.includes('localStorage') && !collectTextBlock.includes('cookie'), 'collectText full-page mode must not inspect storage or cookies');
check(!collectSnapshotBlock.includes('localStorage') && !collectSnapshotBlock.includes('cookie'), 'collectSnapshot full-page mode must not inspect storage or cookies');

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-full-page-read-check-'));
try {
  await withFakeBridge(async ({ socketPath, receivedCommands }) => {
    const env = inheritedEnv({ CHROME_BRIDGE_SOCKET: socketPath });
    const text = await runCli([
      'text',
      '--full-page',
      '--wait-for-text',
      'Lower payout section',
      '--wait-for-pattern',
      'payout',
      '--scroll-step-px',
      '777',
      '--max-scroll-steps',
      '9',
      '--scroll-delay-ms',
      '5',
      '--summary-only',
      '--out',
      path.join(tmpDir, 'text.txt'),
    ], env);
    check(text.ok, `full-page text CLI failed: ${text.stderr || text.stdout}`);
    const textPayload = receivedCommands.find((command) => command.action === 'text')?.payload || {};
    check(textPayload.fullPage === true, 'full-page text CLI must forward fullPage=true');
    check(textPayload.waitForText === 'Lower payout section', 'full-page text CLI must forward waitForText');
    check(textPayload.waitForPattern === 'payout', 'full-page text CLI must forward waitForPattern');
    check(textPayload.scrollStepPx === 777, 'full-page text CLI must forward scrollStepPx');
    check(textPayload.maxScrollSteps === 9, 'full-page text CLI must forward maxScrollSteps');
    check(textPayload.scrollDelayMs === 5, 'full-page text CLI must forward scrollDelayMs');
    check(text.parsed?.diagnostics?.fullPage?.mode === 'full-page-scroll-walk', 'full-page text envelope must expose fullPage diagnostics');

    const snapshot = await runCli([
      'snapshot',
      '--full-page',
      '--wait-for-text',
      'Lower payout section',
      '--summary-only',
      '--out',
      path.join(tmpDir, 'snapshot.json'),
    ], env);
    check(snapshot.ok, `full-page snapshot CLI failed: ${snapshot.stderr || snapshot.stdout}`);
    const snapshotPayload = receivedCommands.find((command) => command.action === 'snapshot')?.payload || {};
    check(snapshotPayload.fullPage === true, 'full-page snapshot CLI must forward fullPage=true');
    check(snapshotPayload.waitForText === 'Lower payout section', 'full-page snapshot CLI must forward waitForText');
    check(snapshot.parsed?.diagnostics?.fullPage?.mode === 'full-page-scroll-walk', 'full-page snapshot envelope must expose fullPage diagnostics');
  });

  const envelope = await formatReadOutput({
    action: 'text',
    result: {
      tab: { id: 55, url: 'https://example.test/full-page', title: 'Full page' },
      text: 'Top\nLower',
      length: 9,
      truncated: false,
      fullPageDiagnostics: {
        mode: 'full-page-scroll-walk',
        scrollSteps: 2,
      },
    },
    options: {
      out: path.join(tmpDir, 'envelope.txt'),
      summaryOnly: true,
    },
  });
  check(envelope.diagnostics?.fullPage?.scrollSteps === 2, 'output envelope must preserve fullPage diagnostics');
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
