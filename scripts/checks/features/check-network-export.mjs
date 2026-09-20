#!/usr/bin/env node
import { createFakeNativeBridge } from '../lib/fake-native-bridge.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildNetworkExport, NETWORK_EXPORT_OUTPUT_CONTRACT_VERSION } from '../../../shared/network-export.mjs';
import { validateCommandPayload } from '../../../shared/command-registry.mjs';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = path.join(rootDir, 'bin/chrome-bridge.mjs');
const mcpPath = path.join(rootDir, 'mcp/chrome-bridge-mcp.mjs');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${label} did not return JSON: ${error?.message || error}`);
    return null;
  }
}

async function runCli(args, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: rootDir,
      env: { ...process.env, ...env },
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout || '',
      stderr: error?.stderr || '',
      error: String(error?.message || error),
    };
  }
}

function fixtureTrace() {
  return {
    active: true,
    tab: {
      id: 44,
      url: 'https://app.example.test/dashboard?session=supersecret',
      title: 'Dashboard',
    },
    events: [
      {
        kind: 'network.request',
        requestId: '1',
        method: 'GET',
        url: 'https://app.example.test/api/report?token=abc123&view=summary',
        resourceType: 'Fetch',
        initiatorType: 'script',
        capturedAt: '2026-06-12T12:00:00.000Z',
      },
      {
        kind: 'network.response',
        requestId: '1',
        url: 'https://app.example.test/api/report?token=abc123&view=summary',
        status: 500,
        statusText: 'Server Error',
        mimeType: 'application/json',
        resourceType: 'Fetch',
        fromDiskCache: false,
        fromServiceWorker: false,
        capturedAt: '2026-06-12T12:00:01.000Z',
      },
      {
        kind: 'network.request',
        requestId: '2',
        method: 'GET',
        url: 'https://cdn.thirdparty.test/widget.js?cache=1',
        resourceType: 'Script',
        initiatorType: 'parser',
        capturedAt: '2026-06-12T12:00:02.000Z',
      },
      {
        kind: 'network.response',
        requestId: '2',
        url: 'https://cdn.thirdparty.test/widget.js?cache=1',
        status: 200,
        statusText: 'OK',
        mimeType: 'text/javascript',
        resourceType: 'Script',
        fromDiskCache: true,
        fromServiceWorker: false,
        capturedAt: '2026-06-12T12:00:03.000Z',
      },
      {
        kind: 'network.failed',
        requestId: '3',
        resourceType: 'Image',
        errorText: 'net::ERR_NAME_NOT_RESOLVED',
        canceled: false,
        capturedAt: '2026-06-12T12:00:04.000Z',
      },
    ],
  };
}

function checkResultShape(result, label) {
  check(result?.ok === true, `${label} must report ok=true`);
  check(result?.action === 'network-export', `${label} must report action=network-export`);
  check(result?.outputContract === NETWORK_EXPORT_OUTPUT_CONTRACT_VERSION, `${label} must expose the network-export output contract`);
  check(typeof result?.summaryPath === 'string', `${label} must expose summaryPath`);
  check(typeof result?.requestsPath === 'string', `${label} must expose requestsPath`);
  check(result?.requestCount === 3, `${label} must summarize request count`);
  check(result?.failedCount === 2, `${label} must summarize failed request count`);
  check(result?.thirdPartyRequestCount === 1, `${label} must summarize third-party requests`);
  check(result?.statusCounts?.['500'] === 1, `${label} must summarize status counts`);
  check(result?.resourceTypes?.Fetch === 1, `${label} must summarize resource types`);
  check(Number(result?.redaction?.queryValueRedactions || 0) >= 1, `${label} must count query-value redactions`);
  check(result?.redaction?.rawUrlsInStdout === false, `${label} must keep raw URLs out of stdout`);
  check(result?.failures?.some((entry) => String(entry.url || '').includes('[redacted]')), `${label} must redact sensitive query values in failure summaries`);
}

async function withFakeBridge(fn) {
  const receivedCommands = [];
  const trace = fixtureTrace();
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
      res.end(JSON.stringify({ ok: false, code: 'INVALID_PAYLOAD', error: String(error?.message || error) }));
      return;
    }
    if (parsed.action === 'traceEvents') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: trace }));
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
    await fn({
      socketPath: socketPath,
      receivedCommands,
      trace,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withMcpClient(env, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpPath],
    env: {
      ...process.env,
      ...env,
    },
  });
  const client = new Client({ name: 'chrome-bridge-network-export-check', version: '0.1.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-network-export-check-'));
try {
  const direct = await buildNetworkExport(fixtureTrace(), {
    artifactDir: tempDir,
    harOut: path.join(tempDir, 'trace.har.json'),
  });
  checkResultShape(direct, 'Direct helper');
  check(Boolean(await fs.readFile(direct.summaryPath, 'utf8').catch(() => null)), 'Direct helper must write summary artifact');
  check(Boolean(await fs.readFile(direct.requestsPath, 'utf8').catch(() => null)), 'Direct helper must write requests jsonl artifact');
  check(Boolean(await fs.readFile(direct.harPath, 'utf8').catch(() => null)), 'Direct helper must write HAR-like artifact when requested');

  let sensitiveRejected = false;
  try {
    await buildNetworkExport(fixtureTrace(), {
      artifactDir: tempDir,
      includeHeaders: true,
    });
  } catch (error) {
    sensitiveRejected = String(error?.message || error).includes('--confirm-sensitive');
  }
  check(sensitiveRejected, 'Direct helper must require confirmSensitive for includeHeaders/includeBodies');

  await withFakeBridge(async ({ socketPath, receivedCommands }) => {
    const cliResult = await runCli([
      'network-export',
      '--artifact-dir',
      tempDir,
      '--out',
      path.join(tempDir, 'cli-summary.json'),
      '--requests-out',
      path.join(tempDir, 'cli-requests.jsonl'),
      '--har-out',
      path.join(tempDir, 'cli-har.json'),
      '--limit',
      '50',
    ], { CHROME_BRIDGE_SOCKET: socketPath });
    check(cliResult.ok, `CLI network-export must succeed: ${cliResult.stderr || cliResult.error || cliResult.stdout}`);
    const cliJson = parseJson(cliResult.stdout, 'CLI network-export');
    checkResultShape(cliJson, 'CLI network-export');
    check(receivedCommands.some((entry) => entry.action === 'traceEvents' && entry.payload?.limit === 50), 'CLI network-export must call traceEvents with the requested limit');
    check(!cliResult.stdout.includes('abc123'), 'CLI network-export stdout must not include raw token-like query values');

    const sensitiveCli = await runCli([
      'network-export',
      '--artifact-dir',
      tempDir,
      '--include-headers',
    ], { CHROME_BRIDGE_SOCKET: socketPath });
    check(!sensitiveCli.ok, 'CLI network-export must reject include-headers without confirm-sensitive');
  });

  await withMcpClient({ CHROME_BRIDGE_SOCKET: '/tmp/chrome-bridge-unavailable.sock' }, async (client) => {
    const tools = await client.listTools();
    check(tools.tools.some((tool) => tool.name === 'chrome_bridge_network_export'), 'MCP listTools must include chrome_bridge_network_export');
  });

  await withFakeBridge(async ({ socketPath }) => {
    await withMcpClient({ CHROME_BRIDGE_SOCKET: socketPath }, async (client) => {
      const result = await client.callTool({
        name: 'chrome_bridge_network_export',
        arguments: {
          artifactDir: tempDir,
          out: path.join(tempDir, 'mcp-summary.json'),
          requestsOut: path.join(tempDir, 'mcp-requests.jsonl'),
          limit: 25,
        },
      });
      const text = result.content?.find((entry) => entry.type === 'text')?.text || '';
      const json = parseJson(text, 'MCP network-export');
      checkResultShape(json, 'MCP network-export');
    });
  });
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`check-network-export failed (${failures.length} issue(s)):\n`);
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write('check-network-export: ok\n');
