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

function currentObserveResult(state) {
  return {
    ok: true,
    url: state.url,
    title: state.title,
    tab: {
      id: state.tabId,
      url: state.url,
      title: state.title,
    },
    elements: state.elements,
  };
}

async function withFakeActBridge(fn) {
  const state = {
    tabId: 5,
    url: 'https://example.test/app',
    title: 'Fixture App',
    elements: [
      {
        index: 0,
        selector: '#login',
        tag: 'a',
        role: 'link',
        action: 'navigate',
        risk: 'safe_nav',
        label: 'Log in',
        text: 'Log in',
        nearbyText: 'Account access',
        placeholder: null,
        name: null,
        type: null,
        href: '/login',
        disabled: false,
        score: 85,
        rect: { x: 10, y: 10, width: 80, height: 20 },
      },
      {
        index: 1,
        selector: '#search',
        tag: 'input',
        role: 'textbox',
        action: 'type',
        risk: 'form_input',
        label: 'Search',
        text: '',
        nearbyText: 'Search the catalog',
        placeholder: 'Search products',
        name: 'q',
        type: 'search',
        href: null,
        disabled: false,
        score: 90,
        rect: { x: 20, y: 20, width: 200, height: 32 },
      },
    ],
  };

  const counts = {
    observe: 0,
    click: 0,
    type: 0,
  };

  const server = createFakeNativeBridge(async (req, res) => {
    if (req.url === '/command') {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      if (parsed.action === 'observe') {
        counts.observe += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: currentObserveResult(state) }));
        return;
      }
      if (parsed.action === 'click') {
        counts.click += 1;
        if (parsed.payload?.selector === '#login') {
          state.url = 'https://example.test/login';
          state.title = 'Login';
          state.elements = [];
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          result: {
            ok: true,
            tab: { id: state.tabId, url: state.url, title: state.title },
            selector: parsed.payload?.selector,
          },
        }));
        return;
      }
      if (parsed.action === 'type') {
        counts.type += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          result: {
            ok: true,
            tab: { id: state.tabId, url: state.url, title: state.title },
            selector: parsed.payload?.selector,
            text: parsed.payload?.text,
          },
        }));
        return;
      }
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `unexpected action ${parsed.action}` }));
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
      counts,
      state,
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
  const client = new Client({ name: 'chrome-bridge-act-apply-check', version: '0.1.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-act-apply-check-'));

await withFakeActBridge(async ({ socketPath, counts, state }) => {
  const env = {
    CHROME_BRIDGE_SOCKET: socketPath,
    CHROME_BRIDGE_ACT_PREVIEW_STATE_DIR: stateDir,
  };

  const previewResult = await runCli(['act-preview', '--intent', 'click login'], env);
  check(previewResult.ok, 'CLI act-preview must succeed before act-apply');
  const previewJson = parseJson(previewResult.stdout, 'CLI act-preview for act-apply');
  const previewId = previewJson?.recommended?.id;
  check(typeof previewId === 'string' && previewId.startsWith('actp-'), 'CLI act-preview must persist a preview id');

  const applyWithoutConfirm = await runCli(['act-apply', '--preview-id', previewId], env);
  check(!applyWithoutConfirm.ok, 'CLI act-apply must require --confirm');

  const applyResult = await runCli(['act-apply', '--preview-id', previewId, '--confirm'], env);
  check(applyResult.ok, 'CLI act-apply must succeed for a fresh preview id');
  const applyJson = parseJson(applyResult.stdout, 'CLI act-apply');
  check(applyJson?.appliedAction?.selector === '#login', 'CLI act-apply must apply the previewed selector');
  check(applyJson?.before?.url === 'https://example.test/app', 'CLI act-apply must report before URL');
  check(applyJson?.after?.url === 'https://example.test/login', 'CLI act-apply must report after URL');
  check(applyJson?.nextRead?.cli === 'chrome-bridge observe', 'CLI act-apply click flow must recommend observe next');
  check(counts.click === 1, 'CLI act-apply must execute exactly one low-level click');
  check(counts.observe >= 3, 'CLI act-preview plus act-apply must use observe for planning and before/after evidence');

  const replayResult = await runCli(['act-apply', '--preview-id', previewId, '--confirm'], env);
  check(!replayResult.ok, 'CLI act-apply must reject replaying a used preview id');

  state.url = 'https://example.test/app';
  state.title = 'Fixture App';
  state.elements = [
    {
      index: 0,
      selector: '#login',
      tag: 'a',
      role: 'link',
      action: 'navigate',
      risk: 'safe_nav',
      label: 'Log in',
      text: 'Log in',
      nearbyText: 'Account access',
      placeholder: null,
      name: null,
      type: null,
      href: '/login',
      disabled: false,
      score: 85,
      rect: { x: 10, y: 10, width: 80, height: 20 },
    },
    {
      index: 1,
      selector: '#search',
      tag: 'input',
      role: 'textbox',
      action: 'type',
      risk: 'form_input',
      label: 'Search',
      text: '',
      nearbyText: 'Search the catalog',
      placeholder: 'Search products',
      name: 'q',
      type: 'search',
      href: null,
      disabled: false,
      score: 90,
      rect: { x: 20, y: 20, width: 200, height: 32 },
    },
  ];

  const stalePreviewResult = await runCli(['act-preview', '--intent', 'click login'], env);
  check(stalePreviewResult.ok, 'CLI act-preview must succeed for stale-preview test');
  const stalePreviewJson = parseJson(stalePreviewResult.stdout, 'CLI act-preview stale test');
  const stalePreviewId = stalePreviewJson?.recommended?.id;
  const stalePath = path.join(stateDir, `${stalePreviewId}.json`);
  const staleRecord = JSON.parse(await fs.readFile(stalePath, 'utf8'));
  staleRecord.expiresAt = '2000-01-01T00:00:00.000Z';
  await fs.writeFile(stalePath, `${JSON.stringify(staleRecord, null, 2)}\n`);
  const staleApplyResult = await runCli(['act-apply', '--preview-id', stalePreviewId, '--confirm'], env);
  check(!staleApplyResult.ok, 'CLI act-apply must reject expired preview ids');

  const navigationPreviewResult = await runCli(['act-preview', '--intent', 'click login'], env);
  check(navigationPreviewResult.ok, 'CLI act-preview must succeed for navigation-stale test');
  const navigationPreviewJson = parseJson(navigationPreviewResult.stdout, 'CLI act-preview navigation stale');
  const navigationPreviewId = navigationPreviewJson?.recommended?.id;
  state.url = 'https://example.test/elsewhere';
  state.title = 'Elsewhere';
  const staleByNavigation = await runCli(['act-apply', '--preview-id', navigationPreviewId, '--confirm'], env);
  check(!staleByNavigation.ok, 'CLI act-apply must reject stale preview ids after navigation');
});

await withFakeActBridge(async ({ socketPath }) => {
  const env = {
    CHROME_BRIDGE_SOCKET: socketPath,
    CHROME_BRIDGE_ACT_PREVIEW_STATE_DIR: stateDir,
  };
  const mcpParsed = await withMcpClient(env, async (client) => {
    const preview = await client.callTool({
      name: 'chrome_bridge_act_preview',
      arguments: {
        intent: 'click login',
      },
    });
    const previewText = preview?.content?.find((item) => item?.type === 'text')?.text || '';
    const previewJson = parseJson(previewText, 'MCP act-preview');
    const apply = await client.callTool({
      name: 'chrome_bridge_act_apply',
      arguments: {
        previewId: previewJson?.recommended?.id,
        confirmed: true,
      },
    });
    const applyText = apply?.content?.find((item) => item?.type === 'text')?.text || '';
    return parseJson(applyText, 'MCP act-apply');
  });
  check(mcpParsed?.appliedAction?.selector === '#login', 'MCP act-apply must apply the previewed selector');
});

const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
check(packageJson.scripts?.['check:act-apply'] === 'node ./scripts/checks/features/check-act-apply.mjs', 'package.json must expose check:act-apply');
check(packageJson.scripts?.check?.includes('npm run check:act-apply'), 'npm run check must include check:act-apply');

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  cliCases: 5,
  mcpCases: 1,
}, null, 2)}\n`);
