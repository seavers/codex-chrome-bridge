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

function createEventChannel() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    emit(payload) {
      for (const listener of [...listeners]) listener(payload);
    },
    size() {
      return listeners.size;
    },
  };
}

function makeDownloadItem(overrides = {}) {
  return {
    id: 101,
    tabId: 7,
    filename: '/tmp/report.csv',
    mime: 'text/csv',
    fileSize: 12,
    bytesReceived: 12,
    totalBytes: 12,
    state: 'complete',
    exists: true,
    danger: 'safe',
    startTime: '2026-06-12T12:00:00.000Z',
    endTime: '2026-06-12T12:00:00.500Z',
    ...overrides,
  };
}

function createExtensionChrome(options = {}) {
  const created = createEventChannel();
  const changed = createEventChannel();
  const tabs = new Map([[7, {
    id: 7,
    windowId: 1,
    index: 0,
    active: true,
    title: 'Fixture Download Page',
    url: 'https://example.test/export',
    status: 'complete',
  }]]);
  const items = new Map();
  const canceled = [];
  const erased = [];

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
    scripting: {
      async executeScript({ args }) {
        const [{ selector }] = args;
        if (options.clickError || selector === '#missing') {
          return [{ error: { message: options.clickError || `No element matches selector: ${selector}` } }];
        }
        if (typeof options.onClick === 'function') {
          options.onClick({ created, changed, items });
        }
        return [{ result: { clicked: selector, url: 'https://example.test/export', title: 'Fixture Download Page' } }];
      },
    },
    downloads: {
      onCreated: created,
      onChanged: changed,
      async search({ id }) {
        return items.has(id) ? [{ ...items.get(id) }] : [];
      },
      async cancel(id) {
        canceled.push(id);
      },
      async erase(query) {
        erased.push(query?.id);
      },
    },
  };

  return { chrome, items, canceled, erased, created, changed };
}

async function importDownloadAction() {
  const moduleUrl = pathToFileURL(path.join(rootDir, 'extension/download-actions.js')).href;
  return import(moduleUrl);
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
  const client = new Client({ name: 'chrome-bridge-download-manager-check', version: '0.1.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function withFakeDownloadBridge(fn) {
  const calls = [];
  const payload = {
    ok: true,
    selector: '#export',
    localPath: '/tmp/report.csv',
    fileName: 'report.csv',
    extension: 'csv',
    privacy: {
      rawUrl: false,
      finalUrl: false,
      fileContents: false,
    },
  };

  const server = createFakeNativeBridge(async (req, res) => {
    if (req.url === '/command') {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      calls.push(parsed);
      if (parsed.action !== 'download') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `unexpected action ${parsed.action}` }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: payload }));
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        bridge: { version: '0.4.1' },
        extension: { connected: true, info: { version: '0.4.1' } },
      }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { path: socketPath } = server.address();
    await fn({
      socketPath: socketPath,
      calls,
      payload,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const { download } = await importDownloadAction();

{
  globalThis.chrome = createExtensionChrome().chrome;
  await download({ selector: '#export', tabId: 7, allowExternal: true }).then(
    () => check(false, 'download must require confirmed=true'),
    (error) => check(String(error?.message || error).includes('download requires confirmed=true'), 'download must reject missing confirmation'),
  );
}

{
  globalThis.chrome = createExtensionChrome().chrome;
  await download({ confirmed: true, tabId: 7, allowExternal: true }).then(
    () => check(false, 'download must require selector'),
    (error) => check(String(error?.message || error).includes('download requires selector'), 'download must reject missing selector'),
  );
}

{
  const fixture = createExtensionChrome({
    onClick({ created, changed, items }) {
      const item = makeDownloadItem();
      items.set(item.id, item);
      setTimeout(() => {
        created.emit(item);
        changed.emit({ id: item.id, state: { current: 'complete' } });
      }, 0);
    },
  });
  globalThis.chrome = fixture.chrome;
  const result = await download({
    confirmed: true,
    selector: '#export',
    tabId: 7,
    allowExternal: true,
    downloadTimeoutMs: 5_000,
  });
  check(result.localPath === '/tmp/report.csv', 'download must return the local file path');
  check(result.fileName === 'report.csv', 'download must derive the file name');
  check(result.extension === 'csv', 'download must derive the file extension');
  check(result.privacy?.rawUrl === false && result.privacy?.fileContents === false, 'download must keep raw URL and file contents out of the contract');
  check(!Object.prototype.hasOwnProperty.call(result, 'url'), 'download result must not expose raw download URL');
  check(fixture.created.size() === 0 && fixture.changed.size() === 0, 'download listeners must be removed after success');
}

{
  const fixture = createExtensionChrome({
    onClick({ created, items }) {
      const first = makeDownloadItem({ id: 201, filename: '/tmp/first.csv' });
      const second = makeDownloadItem({ id: 202, filename: '/tmp/second.csv' });
      items.set(first.id, first);
      items.set(second.id, second);
      setTimeout(() => {
        created.emit(first);
        created.emit(second);
      }, 0);
    },
  });
  globalThis.chrome = fixture.chrome;
  await download({
    confirmed: true,
    selector: '#export',
    tabId: 7,
    allowExternal: true,
    downloadTimeoutMs: 5_000,
  }).then(
    () => check(false, 'download must reject multi-download flows'),
    (error) => {
      check(String(error?.message || error).includes('more than one file'), 'download must explain multi-download rejection');
      check(fixture.canceled.includes(202), 'download must cancel extra downloads');
      check(fixture.erased.includes(202), 'download must erase extra downloads from history when possible');
    },
  );
}

{
  globalThis.chrome = createExtensionChrome().chrome;
  await download({
    confirmed: true,
    selector: '#export',
    tabId: 7,
    allowExternal: true,
    downloadTimeoutMs: 1_000,
  }).then(
    () => check(false, 'download must time out when no file appears'),
    (error) => check(String(error?.message || error).includes('did not complete within'), 'download must fail with a bounded timeout'),
  );
}

{
  const fixture = createExtensionChrome({ clickError: 'No element matches selector: #missing' });
  globalThis.chrome = fixture.chrome;
  const startedAt = Date.now();
  await download({
    confirmed: true,
    selector: '#missing',
    tabId: 7,
    allowExternal: true,
    downloadTimeoutMs: 5_000,
  }).then(
    () => check(false, 'download must fail if the selector click cannot run'),
    (error) => {
      check(String(error?.message || error).includes('No element matches selector'), 'download must surface selector click failures');
      check(Date.now() - startedAt < 500, 'download click failures must short-circuit without waiting for the full timeout');
      check(fixture.created.size() === 0 && fixture.changed.size() === 0, 'download listeners must be removed after click failure');
    },
  );
}

await withFakeDownloadBridge(async ({ socketPath, calls, payload }) => {
  const env = { CHROME_BRIDGE_SOCKET: socketPath };

  const missingConfirm = await runCli(['download', '--selector', '#export'], env);
  check(!missingConfirm.ok, 'CLI download must require --confirm');

  const cliResult = await runCli(['download', '--selector', '#export', '--confirm', '--download-timeout-ms', '4321'], env);
  check(cliResult.ok, 'CLI download must succeed against the fake bridge');
  const cliJson = parseJson(cliResult.stdout, 'CLI download');
  check(cliJson?.localPath === payload.localPath, 'CLI download must print the bridge result');
  check(calls[0]?.payload?.selector === '#export', 'CLI download must forward selector');
  check(calls[0]?.payload?.confirmed === true, 'CLI download must forward confirmation');
  check(calls[0]?.payload?.downloadTimeoutMs === 4321, 'CLI download must forward bounded timeout');

  await withMcpClient(env, async (client) => {
    const tools = await client.listTools();
    check(tools.tools.some((tool) => tool.name === 'chrome_bridge_download'), 'MCP must advertise chrome_bridge_download');

    try {
      const invalid = await client.callTool({
        name: 'chrome_bridge_download',
        arguments: {
          selector: '#export',
        },
      });
      check(invalid?.isError === true, 'MCP download must reject missing confirmation');
    } catch (error) {
      const message = String(error?.message || error);
      check(/confirmed|invalid arguments/i.test(message), 'MCP download must reject missing confirmation');
    }

    const result = await client.callTool({
      name: 'chrome_bridge_download',
      arguments: {
        selector: '#export',
        confirmed: true,
        downloadTimeoutMs: 2222,
      },
    });
    const text = result.content?.[0]?.text || '';
    const json = parseJson(text, 'MCP download');
    check(json?.fileName === 'report.csv', 'MCP download must return download metadata');
    const lastCall = calls.at(-1);
    check(lastCall?.payload?.downloadTimeoutMs === 2222, 'MCP download must forward timeout');
    check(lastCall?.payload?.selector === '#export', 'MCP download must forward selector');
  });
});

if (failures.length) {
  process.stderr.write(`${failures.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('check-download-manager: ok\n');
}
