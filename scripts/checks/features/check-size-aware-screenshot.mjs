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
      // Non-JSON failures are reported below.
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
  const pngBytes = Buffer.from('fake-png-size-guard');
  const dataUrl = `data:image/png;base64,${pngBytes.toString('base64')}`;
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

    if (parsed.action === 'screenshot') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: {
          tab: { id: parsed.payload.tabId ?? 91, url: 'https://example.test/tall', title: 'Tall page' },
          dataUrl,
          fullPage: false,
          requestedFullPage: Boolean(parsed.payload.fullPage),
          capturedAt: '2026-06-08T00:00:00.000Z',
          sizeGuard: {
            triggered: true,
            fallback: 'viewport',
            reason: 'estimated-pixels-exceeded',
            maxPixels: parsed.payload.maxPixels,
            estimatedPixels: 123456789,
            captureMode: 'viewport',
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

async function checkEnvelopeSizeGuard(tmpDir) {
  const pngBytes = Buffer.from('fake-png-size-guard-direct');
  const envelope = await formatReadOutput({
    action: 'screenshot',
    result: {
      tab: { id: 92, url: 'https://example.test/tall', title: 'Tall page' },
      dataUrl: `data:image/png;base64,${pngBytes.toString('base64')}`,
      fullPage: false,
      requestedFullPage: true,
      sizeGuard: {
        triggered: true,
        fallback: 'viewport',
        reason: 'estimated-pixels-exceeded',
        maxPixels: 50_000_000,
        estimatedPixels: 120_000_000,
        captureMode: 'viewport',
      },
    },
    options: { out: path.join(tmpDir, 'guarded.png') },
    now: '2026-06-08T00:00:00.000Z',
  });

  check(envelope.diagnostics?.sizeGuard?.triggered === true, 'screenshot envelope must preserve sizeGuard diagnostics');
  check(envelope.diagnostics?.sizeGuard?.fallback === 'viewport', 'screenshot envelope must expose sizeGuard fallback');
  check(envelope.diagnostics?.sizeGuard?.estimatedPixels === 120_000_000, 'screenshot envelope must expose estimated pixel count');
  check(!Object.prototype.hasOwnProperty.call(envelope, 'dataUrl'), 'screenshot envelope must still omit dataUrl');
}

async function checkCliSizeAwareScreenshot(tmpDir) {
  await withFakeBridge(async ({ socketPath, receivedCommands }) => {
    const out = path.join(tmpDir, 'screenshot.png');
    const result = await runCli([
      'screenshot',
      '--tab',
      '91',
      '--out',
      out,
      '--full-page',
      '--max-pixels',
      '50000000',
      '--fallback',
      'viewport',
      '--timeout-ms',
      '4444',
    ], inheritedEnv({ CHROME_BRIDGE_SOCKET: socketPath }));

    check(result.ok, `size-aware screenshot CLI failed: ${result.stderr || result.stdout}`);
    const received = receivedCommands.find((command) => command.action === 'screenshot');
    check(received?.timeoutMs === 4444, 'screenshot CLI must forward --timeout-ms as bridge command timeout');
    check(received?.payload?.fullPage === true, 'screenshot CLI must preserve fullPage request');
    check(received?.payload?.maxPixels === 50_000_000, 'screenshot CLI must forward maxPixels');
    check(received?.payload?.fallback === 'viewport', 'screenshot CLI must forward fallback');
    check(result.parsed?.diagnostics?.sizeGuard?.triggered === true, 'screenshot CLI envelope must expose sizeGuard diagnostics');
    check(result.parsed?.diagnostics?.sizeGuard?.fallback === 'viewport', 'screenshot CLI envelope must expose viewport fallback');
    check(result.parsed?.fullPage === false, 'screenshot CLI envelope must report actual fullPage=false after viewport fallback');
    check(await fs.readFile(out).then((buffer) => buffer.length > 0), 'screenshot CLI must still write a bounded PNG artifact');
  });
}

async function checkSurface() {
  const [packageText, registry, cli, mcp, pageArtifacts] = await Promise.all([
    fs.readFile(path.join(rootDir, 'package.json'), 'utf8'),
    readRegistrySource(rootDir),
    readCliSource(rootDir),
    readMcpSource(rootDir),
    fs.readFile(path.join(rootDir, 'extension/page-artifacts.js'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageText);
  check(packageJson.scripts?.['check:size-aware-screenshot'] === 'node ./scripts/checks/features/check-size-aware-screenshot.mjs', 'package.json must expose check:size-aware-screenshot');
  check(packageJson.scripts?.check?.includes('npm run check:size-aware-screenshot'), 'npm run check must include check:size-aware-screenshot');
  check(registry.includes("screenshot: [...base, 'fullPage', 'selector', 'elementRef', 'maxPixels', 'fallback']"), 'screenshot payload schema must allow selector/ref targeting, maxPixels, and fallback');
  check(registry.includes('--max-pixels <n>') && registry.includes('--fallback viewport'), 'CLI usage registry must document size-aware screenshot flags');
  check(cli.includes("args['max-pixels']") && cli.includes("args['timeout-ms']"), 'CLI must parse size-aware screenshot flags');
  check(mcp.includes('maxPixels: z.number().int().min(1)') && mcp.includes("fallback: z.enum(['viewport', 'error']).optional()"), 'MCP screenshot schema must expose size-aware fields');
  check(pageArtifacts.includes('Page.getLayoutMetrics'), 'extension screenshot path must estimate page metrics before full-page capture');
  check(pageArtifacts.includes('estimatedPixels') && pageArtifacts.includes('maxPixels'), 'extension screenshot path must return pixel estimate diagnostics');
  check(pageArtifacts.includes("fallback === 'viewport'"), 'extension screenshot path must support viewport fallback');
  check(pageArtifacts.includes("from './focus-context.js'"), 'extension screenshot path must import shared focus preservation helpers');
  check(pageArtifacts.includes('withUserFocusPreserved'), 'extension screenshot path must preserve the user focus around viewport capture');
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-size-aware-screenshot-check-'));
try {
  await checkEnvelopeSizeGuard(tmpDir);
  await checkCliSizeAwareScreenshot(tmpDir);
  await checkSurface();
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
