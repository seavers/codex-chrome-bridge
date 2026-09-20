#!/usr/bin/env node
import { createFakeNativeBridge } from '../lib/fake-native-bridge.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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
  const privateNeedle = 'https://private.example.test/secret-path';
  const secretConsoleText = 'SECRET_CONSOLE_TEXT';
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

    if (parsed.action === 'diagnostics') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: {
          tab: {
            id: parsed.payload.tabId ?? 77,
            url: 'https://example.test/app',
            title: 'Diagnostics fixture',
            status: 'complete',
          },
          generatedAt: '2026-06-12T00:00:00.000Z',
          privacy: {
            rawConsoleText: false,
            rawNetworkUrls: false,
            requestBodies: false,
            responseBodies: false,
          },
          trace: {
            active: true,
            eventCount: 4,
            maxEvents: 500,
            eventSummary: {
              console: {
                count: 1,
                byLevel: { error: 1 },
              },
              network: {
                requestCount: 1,
                responseCount: 1,
                failedCount: 1,
                thirdPartyRequestCount: 28,
                statusCounts: { 500: 1 },
                resourceTypes: { Fetch: 1 },
              },
            },
          },
          performance: {
            navigation: {
              type: 'navigate',
              domContentLoadedMs: 3210,
              loadEventMs: 4654,
              responseEndMs: 123,
              transferSize: 4096,
            },
            longTasks: {
              count: 2,
              totalDurationMs: 480,
              maxDurationMs: 290,
            },
            resources: {
              count: 184,
              transferSize: 8192,
              decodedBodySize: 16384,
              renderBlockingCandidateCount: 3,
              thirdPartyRequestCount: 28,
              byType: {
                script: { count: 1, transferSize: 4096, decodedBodySize: 8192 },
                img: { count: 1, transferSize: 4096, decodedBodySize: 8192 },
              },
            },
          },
          lighthouse: {
            handoff: 'Run Lighthouse manually from Chrome DevTools or with npx lighthouse against the selected tab URL.',
            commandTemplate: 'npx lighthouse <url> --view',
          },
          omitted: {
            rawTraceEvents: true,
            rawResourceUrls: true,
            privateNeedle,
            secretConsoleText,
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
      privateNeedle,
      secretConsoleText,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function checkCliDiagnostics(tmpDir) {
  await withFakeBridge(async ({
    socketPath,
    receivedCommands,
    privateNeedle,
    secretConsoleText,
  }) => {
    const out = path.join(tmpDir, 'diagnostics.json');
    const result = await runCli([
      'diagnostics',
      '--tab',
      '77',
      '--out',
      out,
    ], inheritedEnv({ CHROME_BRIDGE_SOCKET: socketPath }));

    check(result.ok, `diagnostics CLI failed: ${result.stderr || result.stdout}`);
    const received = receivedCommands.find((command) => command.action === 'diagnostics');
    check(received?.payload?.tabId === 77, 'diagnostics CLI must forward tabId');
    check(JSON.stringify(result.parsed).length < 12_000, 'diagnostics CLI stdout must stay token-budget friendly');
    check(result.parsed?.ok === true, 'diagnostics CLI must report ok=true');
    check(result.parsed?.action === 'diagnostics', 'diagnostics CLI must report action=diagnostics');
    check(result.parsed?.artifactPath === out, 'diagnostics CLI must expose artifactPath when --out is used');
    check(result.parsed?.privacy?.rawConsoleText === false, 'diagnostics CLI must disclose raw console text omission');
    check(result.parsed?.privacy?.rawNetworkUrls === false, 'diagnostics CLI must disclose raw network URL omission');
    check(!Object.prototype.hasOwnProperty.call(result.parsed?.trace || {}, 'events'), 'diagnostics CLI must not return raw trace events');
    check(result.parsed?.trace?.eventSummary?.console?.byLevel?.error === 1, 'diagnostics CLI must expose bounded console counts');
    check(result.parsed?.trace?.eventSummary?.network?.statusCounts?.['500'] === 1, 'diagnostics CLI must expose bounded network status counts');
    check(result.parsed?.performance?.navigation?.domContentLoadedMs === 3210, 'diagnostics CLI must expose navigation timing summary');
    check(result.parsed?.performance?.resources?.byType?.script?.count === 1, 'diagnostics CLI must expose resource type summary');
    check(result.parsed?.lighthouse?.commandTemplate?.includes('lighthouse'), 'diagnostics CLI must expose Lighthouse handoff');
    check(Array.isArray(result.parsed?.hints), 'diagnostics CLI must expose heuristic hints');
    check(result.parsed?.hints?.some((hint) => hint.id === 'slow-navigation' && hint.heuristic === true), 'diagnostics CLI must flag slow navigation heuristics');
    check(result.parsed?.hints?.some((hint) => hint.id === 'failed-requests'), 'diagnostics CLI must flag failed request heuristics');
    check(result.parsed?.hints?.some((hint) => hint.id === 'console-errors'), 'diagnostics CLI must flag console error heuristics');
    check(result.parsed?.hints?.some((hint) => hint.id === 'run-lighthouse-next'), 'diagnostics CLI must recommend Lighthouse when heuristics fire');
    check(!result.stdout.includes(privateNeedle), 'diagnostics CLI stdout must not include raw resource URLs');
    check(!result.stdout.includes(secretConsoleText), 'diagnostics CLI stdout must not include raw console text');

    const artifactText = await fs.readFile(out, 'utf8').catch(() => null);
    check(Boolean(artifactText), 'diagnostics --out must write the full local artifact');
    const artifact = artifactText ? JSON.parse(artifactText) : null;
    check(artifact?.omitted?.privateNeedle === privateNeedle, 'diagnostics --out must preserve full local artifact for debugging');
  });
}

async function checkSurface() {
  const [packageText, registry, cli, mcp, background, pageReadActions, pageScripts, debuggerSession] = await Promise.all([
    fs.readFile(path.join(rootDir, 'package.json'), 'utf8'),
    readRegistrySource(rootDir),
    readCliSource(rootDir),
    readMcpSource(rootDir),
    fs.readFile(path.join(rootDir, 'extension/background.js'), 'utf8'),
    fs.readFile(path.join(rootDir, 'extension/page-read-actions.js'), 'utf8'),
    readPageScriptsSource(rootDir),
    fs.readFile(path.join(rootDir, 'extension/debugger-session.js'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageText);

  check(packageJson.scripts?.['check:diagnostics'] === 'node ./scripts/checks/features/check-diagnostics.mjs', 'package.json must expose check:diagnostics');
  check(packageJson.scripts?.check?.includes('npm run check:diagnostics'), 'npm run check must include check:diagnostics');
  check(registry.includes('diagnostics: base'), 'registry must allow diagnostics payload keys');
  check(registry.includes('chrome-bridge diagnostics'), 'registry must document diagnostics CLI usage');
  check(registry.includes('chrome_bridge_diagnostics'), 'registry must document diagnostics MCP tool');
  check(cli.includes("cmd === 'diagnostics'"), 'CLI must route diagnostics');
  check(mcp.includes("'chrome_bridge_diagnostics'"), 'MCP must expose chrome_bridge_diagnostics');
  check(background.includes("case 'diagnostics'"), 'extension background must dispatch diagnostics');
  check(pageReadActions.includes('export async function diagnostics'), 'page read actions must export diagnostics');
  check(pageScripts.includes('export function collectDiagnostics'), 'page scripts must collect diagnostics');
  check(debuggerSession.includes('traceEventSummary'), 'debugger session must summarize trace events without returning raw logs');
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-diagnostics-check-'));
try {
  await checkCliDiagnostics(tmpDir);
  await checkSurface();
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
