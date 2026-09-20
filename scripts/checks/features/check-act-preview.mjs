#!/usr/bin/env node
import { createFakeNativeBridge } from '../lib/fake-native-bridge.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildActPreviewPlan } from '../../../shared/act-preview.mjs';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = path.join(rootDir, 'bin/chrome-bridge.mjs');
const mcpPath = path.join(rootDir, 'mcp/chrome-bridge-mcp.mjs');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function fixtureObserveResult() {
  return {
    ok: true,
    url: 'https://example.test/app',
    title: 'Fixture App',
    tab: {
      id: 5,
      url: 'https://example.test/app',
      title: 'Fixture App',
    },
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
        selector: '#pricing',
        tag: 'a',
        role: 'link',
        action: 'navigate',
        risk: 'safe_nav',
        label: 'Pricing',
        text: 'Pricing',
        nearbyText: 'Plans and billing',
        placeholder: null,
        name: null,
        type: null,
        href: '/pricing',
        disabled: false,
        score: 82,
        rect: { x: 20, y: 20, width: 80, height: 20 },
      },
      {
        index: 2,
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
        rect: { x: 30, y: 30, width: 200, height: 32 },
      },
      {
        index: 3,
        selector: '#download',
        tag: 'button',
        role: 'button',
        action: 'click',
        risk: 'unknown_interaction',
        label: 'Download report',
        text: 'Download report',
        nearbyText: 'Exports and offline files',
        placeholder: null,
        name: null,
        type: 'button',
        href: null,
        disabled: false,
        score: 88,
        rect: { x: 40, y: 40, width: 140, height: 32 },
      },
      {
        index: 4,
        selector: '#delete',
        tag: 'button',
        role: 'button',
        action: 'click',
        risk: 'likely_mutation',
        label: 'Delete account',
        text: 'Delete account',
        nearbyText: 'Danger zone',
        placeholder: null,
        name: null,
        type: 'button',
        href: null,
        disabled: false,
        score: 70,
        rect: { x: 50, y: 50, width: 140, height: 32 },
      },
    ],
  };
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
      timeout: 10_000,
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

async function withFakeObserveBridge(fn) {
  const observed = fixtureObserveResult();
  let observeCalls = 0;
  const server = createFakeNativeBridge(async (req, res) => {
    if (req.url === '/command') {
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      if (parsed.action !== 'observe') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `unexpected action ${parsed.action}` }));
        return;
      }
      observeCalls += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: observed }));
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
      observed,
      getObserveCalls: () => observeCalls,
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
  const client = new Client({ name: 'chrome-bridge-act-preview-check', version: '0.1.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const directPlan = buildActPreviewPlan({
  intent: 'click login',
  observed: fixtureObserveResult(),
});
check(directPlan.ok === true, 'direct act-preview plan must succeed');
check(directPlan.mode === 'read-only', 'direct act-preview plan must stay read-only');
check(directPlan.recommended?.selector === '#login', 'direct act-preview must recommend the login selector');

const directSearchPlan = buildActPreviewPlan({
  intent: 'search for "wireless mouse"',
  observed: fixtureObserveResult(),
});
check(directSearchPlan.recommended?.selector === '#search', 'direct act-preview must recommend the search field');
check(directSearchPlan.recommended?.exactCommand?.includes('"wireless mouse"'), 'direct act-preview search plan must carry the search text into the exact command');

const directDownloadPlan = buildActPreviewPlan({
  intent: 'download report',
  observed: fixtureObserveResult(),
});
check(directDownloadPlan.recommended?.selector === '#download', 'direct act-preview must recommend the download control');

const readOnlyRiskPlan = buildActPreviewPlan({
  intent: 'delete account',
  observed: fixtureObserveResult(),
  riskTolerance: 'read-only',
});
check(!readOnlyRiskPlan.candidates.some((candidate) => candidate.selector === '#delete'), 'read-only act-preview must filter likely mutation actions');

await withFakeObserveBridge(async ({ socketPath, getObserveCalls }) => {
  const cliLoginResult = await runCli(['act-preview', '--intent', 'click login'], {
    CHROME_BRIDGE_SOCKET: socketPath,
  });
  check(cliLoginResult.ok, 'CLI act-preview must succeed against fake observe bridge');
  const cliLoginJson = parseJson(cliLoginResult.stdout, 'CLI act-preview login');
  check(cliLoginJson?.recommended?.selector === '#login', 'CLI act-preview must recommend login for login intent');
  check(getObserveCalls() === 1, 'CLI act-preview must only issue one observe call');

  const cliPricingResult = await runCli(['act-preview', '--intent', 'open pricing'], {
    CHROME_BRIDGE_SOCKET: socketPath,
  });
  check(cliPricingResult.ok, 'CLI act-preview must succeed for pricing intent');
  const cliPricingJson = parseJson(cliPricingResult.stdout, 'CLI act-preview pricing');
  check(cliPricingJson?.recommended?.selector === '#pricing', 'CLI act-preview must recommend pricing for pricing intent');

  const cliSearchResult = await runCli(['act-preview', '--intent', 'search for "wireless mouse"'], {
    CHROME_BRIDGE_SOCKET: socketPath,
  });
  check(cliSearchResult.ok, 'CLI act-preview must succeed for search intent');
  const cliSearchJson = parseJson(cliSearchResult.stdout, 'CLI act-preview search');
  check(cliSearchJson?.recommended?.selector === '#search', 'CLI act-preview must recommend the search field');
  check(cliSearchJson?.recommended?.exactCommand?.includes('"wireless mouse"'), 'CLI act-preview search recommendation must include the search text');

  const cliDownloadResult = await runCli(['act-preview', '--intent', 'download report'], {
    CHROME_BRIDGE_SOCKET: socketPath,
  });
  check(cliDownloadResult.ok, 'CLI act-preview must succeed for download intent');
  const cliDownloadJson = parseJson(cliDownloadResult.stdout, 'CLI act-preview download');
  check(cliDownloadJson?.recommended?.selector === '#download', 'CLI act-preview must recommend the download control');

  const mcpParsed = await withMcpClient({ CHROME_BRIDGE_SOCKET: socketPath }, async (client) => {
    const result = await client.callTool({
      name: 'chrome_bridge_act_preview',
      arguments: {
        intent: 'click login',
      },
    });
    const text = result?.content?.find((item) => item?.type === 'text')?.text || '';
    return parseJson(text, 'MCP act-preview');
  });
  check(mcpParsed?.recommended?.selector === '#login', 'MCP act-preview must recommend login for login intent');
});

const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
check(packageJson.scripts?.['check:act-preview'] === 'node ./scripts/checks/features/check-act-preview.mjs', 'package.json must expose check:act-preview');
check(packageJson.scripts?.check?.includes('npm run check:act-preview'), 'npm run check must include check:act-preview');

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  directCases: 4,
  cliCases: 4,
  mcpCases: 1,
}, null, 2)}\n`);
