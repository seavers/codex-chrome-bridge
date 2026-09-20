#!/usr/bin/env node
import { createFakeNativeBridge } from '../lib/fake-native-bridge.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = path.join(rootDir, 'bin/chrome-bridge.mjs');
const mcpPath = path.join(rootDir, 'mcp/chrome-bridge-mcp.mjs');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    failures.push(`${label} did not return JSON: ${error?.message || error}`);
    return null;
  }
}

function createFakeChrome() {
  const commands = [];
  const tabs = new Map([[7, {
    id: 7,
    windowId: 1,
    index: 0,
    active: true,
    title: 'Fixture Tab',
    url: 'https://example.test/app',
    status: 'complete',
  }]]);
  const chrome = {
    storage: {
      local: {
        async get() {
          return {};
        },
      },
    },
    tabs: {
      async get(tabId) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`Unknown tab ${tabId}`);
        return { ...tab };
      },
    },
    debugger: {
      async attach() {},
      async detach() {},
      async sendCommand(target, method, params = {}) {
        commands.push({ tabId: target?.tabId, method, params });
        return {};
      },
    },
  };
  return { chrome, commands };
}

async function importEmulationActions() {
  return import(pathToFileURL(path.join(rootDir, 'extension/emulation-actions.js')).href);
}

async function runCli(args, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: rootDir,
      env: {
        ...process.env,
        ...env,
      },
      timeout: 15_000,
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

async function withMcpClient(env, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpPath],
    env: {
      ...process.env,
      ...env,
    },
  });
  const client = new Client({ name: 'chrome-bridge-emulation-check', version: '0.1.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function withFakeBridge(fn) {
  const receivedCommands = [];
  const server = createFakeNativeBridge(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        bridge: { version: '0.4.1' },
        extension: { connected: true, info: { version: '0.4.1' } },
      }));
      return;
    }
    if (req.url !== '/command' || req.method !== 'POST') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unexpected path' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    receivedCommands.push(parsed);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      result: {
        action: parsed.action,
        payload: parsed.payload,
      },
    }));
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
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const { setViewport, emulateNetwork, clearEmulation } = await importEmulationActions();

{
  globalThis.chrome = createFakeChrome().chrome;
  await setViewport({ tabId: 7, width: 1280, height: 720, allowExternal: true }).then(
    () => check(false, 'setViewport must require confirmed=true'),
    (error) => check(String(error?.message || error).includes('confirmed=true'), 'setViewport must reject missing confirmation'),
  );
}

{
  const fixture = createFakeChrome();
  globalThis.chrome = fixture.chrome;
  const result = await setViewport({
    tabId: 7,
    allowExternal: true,
    confirmed: true,
    width: 1280,
    height: 720,
    deviceScaleFactor: 2,
    mobile: true,
  });
  check(result.viewport?.width === 1280 && result.viewport?.mobile === true, 'setViewport must echo applied viewport settings');
  check(result.reset?.cli?.includes('clear-emulation --confirm --tab 7'), 'setViewport must return a reset hint');
  check(fixture.commands.some((entry) => entry.method === 'Emulation.setDeviceMetricsOverride' && entry.params.width === 1280 && entry.params.mobile === true), 'setViewport must call Emulation.setDeviceMetricsOverride');
  check(fixture.commands.some((entry) => entry.method === 'Emulation.setTouchEmulationEnabled' && entry.params.enabled === true), 'setViewport must enable touch emulation for mobile mode');
}

{
  const fixture = createFakeChrome();
  globalThis.chrome = fixture.chrome;
  const result = await emulateNetwork({
    tabId: 7,
    allowExternal: true,
    confirmed: true,
    networkProfile: 'slow-4g',
  });
  check(result.network?.profile === 'slow-4g', 'emulateNetwork must echo the applied profile');
  const command = fixture.commands.find((entry) => entry.method === 'Network.emulateNetworkConditions');
  check(command?.params?.offline === false, 'emulateNetwork must apply online conditions for slow-4g');
  check(command?.params?.downloadThroughput > 0 && command?.params?.uploadThroughput > 0, 'emulateNetwork must convert profile throughput to bytes/sec');
}

{
  const fixture = createFakeChrome();
  globalThis.chrome = fixture.chrome;
  const result = await emulateNetwork({
    tabId: 7,
    allowExternal: true,
    confirmed: true,
    networkProfile: 'custom',
    latencyMs: 1500,
    downloadKbps: 2048,
    uploadKbps: 1024,
  });
  check(result.network?.latencyMs === 1500, 'emulateNetwork custom mode must echo bounded latency');
  const command = fixture.commands.find((entry) => entry.method === 'Network.emulateNetworkConditions');
  check(command?.params?.latency === 1500, 'emulateNetwork custom mode must forward latency');
}

{
  const fixture = createFakeChrome();
  globalThis.chrome = fixture.chrome;
  const result = await clearEmulation({
    tabId: 7,
    allowExternal: true,
    confirmed: true,
  });
  check(Array.isArray(result.cleared) && result.cleared.includes('viewport') && result.cleared.includes('network'), 'clearEmulation must report cleared scopes');
  check(fixture.commands.some((entry) => entry.method === 'Emulation.clearDeviceMetricsOverride'), 'clearEmulation must clear viewport overrides');
  check(fixture.commands.some((entry) => entry.method === 'Network.emulateNetworkConditions' && entry.params.downloadThroughput === -1 && entry.params.uploadThroughput === -1), 'clearEmulation must clear network throttling');
}

await withFakeBridge(async ({ socketPath, receivedCommands }) => {
  const env = { CHROME_BRIDGE_SOCKET: socketPath };

  const missingConfirm = await runCli(['set-viewport', '--width', '1280', '--height', '720'], env);
  check(!missingConfirm.ok, 'CLI set-viewport must require --confirm');

  const cliViewport = await runCli(['set-viewport', '--width', '1280', '--height', '720', '--mobile', '--device-scale-factor', '2', '--confirm'], env);
  check(cliViewport.ok, 'CLI set-viewport must succeed');
  const cliViewportJson = parseJson(cliViewport.stdout, 'CLI set-viewport');
  check(cliViewportJson?.payload?.width === 1280 && cliViewportJson?.payload?.mobile === true, 'CLI set-viewport must forward viewport payload');

  const cliNetwork = await runCli(['emulate-network', '--profile', 'custom', '--latency-ms', '900', '--download-kbps', '4096', '--upload-kbps', '2048', '--confirm'], env);
  check(cliNetwork.ok, 'CLI emulate-network must succeed');
  const cliNetworkJson = parseJson(cliNetwork.stdout, 'CLI emulate-network');
  check(cliNetworkJson?.payload?.networkProfile === 'custom', 'CLI emulate-network must forward network profile');
  check(cliNetworkJson?.payload?.latencyMs === 900, 'CLI emulate-network must forward custom latency');

  const clearResult = await runCli(['clear-emulation', '--confirm'], env);
  check(clearResult.ok, 'CLI clear-emulation must succeed');
  const clearJson = parseJson(clearResult.stdout, 'CLI clear-emulation');
  check(clearJson?.action === 'clearEmulation', 'CLI clear-emulation must dispatch clearEmulation');

  check(receivedCommands.some((entry) => entry.action === 'setViewport'), 'CLI must dispatch setViewport');
  check(receivedCommands.some((entry) => entry.action === 'emulateNetwork'), 'CLI must dispatch emulateNetwork');
  check(receivedCommands.some((entry) => entry.action === 'clearEmulation'), 'CLI must dispatch clearEmulation');

  await withMcpClient(env, async (client) => {
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));
    check(names.has('chrome_bridge_set_viewport'), 'MCP must advertise chrome_bridge_set_viewport');
    check(names.has('chrome_bridge_emulate_network'), 'MCP must advertise chrome_bridge_emulate_network');
    check(names.has('chrome_bridge_clear_emulation'), 'MCP must advertise chrome_bridge_clear_emulation');

    const viewportResult = await client.callTool({
      name: 'chrome_bridge_set_viewport',
      arguments: {
        width: 1440,
        height: 900,
        confirmed: true,
      },
    });
    const viewportText = viewportResult.content?.[0]?.text || '';
    const viewportJson = parseJson(viewportText, 'MCP set viewport');
    check(viewportJson?.payload?.width === 1440, 'MCP set viewport must forward width');

    const networkResult = await client.callTool({
      name: 'chrome_bridge_emulate_network',
      arguments: {
        networkProfile: 'slow-3g',
        confirmed: true,
      },
    });
    const networkText = networkResult.content?.[0]?.text || '';
    const networkJson = parseJson(networkText, 'MCP emulate network');
    check(networkJson?.payload?.networkProfile === 'slow-3g', 'MCP emulate network must forward the selected profile');

    const clearToolResult = await client.callTool({
      name: 'chrome_bridge_clear_emulation',
      arguments: {
        confirmed: true,
      },
    });
    const clearText = clearToolResult.content?.[0]?.text || '';
    const clearToolJson = parseJson(clearText, 'MCP clear emulation');
    check(clearToolJson?.action === 'clearEmulation', 'MCP clear emulation must dispatch clearEmulation');
  });
});

if (failures.length) {
  process.stderr.write(`${failures.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('check-emulation: ok\n');
}
