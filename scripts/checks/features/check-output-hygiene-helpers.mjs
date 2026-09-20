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

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = path.join(rootDir, 'bin/chrome-bridge.mjs');
const failures = [];

const pageText = [
  'Top page',
  'Payout: 900 RUB approved lead',
  'Geo: RU KZ BY',
  'Unrelated raw body that should stay out of helper stdout.',
].join('\n');

const pageHtml = `<!doctype html>
<main>
  <a href="https://example.test/landing">Landing</a>
  <a href="https://docs.google.com/spreadsheets/d/abc/edit">Sheet</a>
  <table>
    <tr><th>Geo</th><th>Payout</th></tr>
    <tr><td>RU</td><td>900 RUB</td></tr>
  </table>
  <p>Unrelated raw HTML body that should stay out of helper stdout.</p>
</main>`;

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
  const longUrl = `https://example.test/${'x'.repeat(1200)}`;
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

    if (parsed.action === 'tabs') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: {
          scope: 'codex-group',
          tabs: [
            { id: 5, title: 'Current CPA dashboard', url: longUrl, active: true, status: 'complete' },
            { id: 6, title: 'Compact docs', url: 'https://example.test/docs', active: false, status: 'complete' },
          ],
        },
      }));
      return;
    }

    if (parsed.action === 'group') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: {
          group: { id: 10, title: 'Codex Bridge', color: 'purple' },
          tabs: [
            { id: 5, title: 'Current CPA dashboard', url: longUrl },
            { id: 6, title: 'Compact docs', url: 'https://example.test/docs' },
          ],
        },
      }));
      return;
    }

    if (parsed.action === 'workspace') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: {
          workspace: { title: 'Codex Bridge' },
          policy: { mode: 'scoped' },
          counts: { tabs: 2 },
          tabs: [
            { id: 5, title: 'Current CPA dashboard', url: longUrl },
            { id: 6, title: 'Compact docs', url: 'https://example.test/docs' },
          ],
        },
      }));
      return;
    }

    if (parsed.action === 'text') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: {
          tab: { id: parsed.payload.tabId ?? 5, url: 'https://example.test/page', title: 'CPA page' },
          text: pageText,
          length: pageText.length,
          truncated: false,
          fullPageDiagnostics: {
            mode: 'full-page-scroll-walk',
            fullPage: true,
            scrollSteps: 2,
          },
        },
      }));
      return;
    }

    if (parsed.action === 'html') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: {
          tab: { id: parsed.payload.tabId ?? 5, url: 'https://example.test/page', title: 'CPA page' },
          url: 'https://example.test/page',
          title: 'CPA page',
          selector: parsed.payload.selector || 'html',
          html: pageHtml,
          length: pageHtml.length,
          truncated: false,
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

async function checkArtifactHelpers(tmpDir) {
  const artifactDir = path.join(tmpDir, 'artifacts');
  const envelope = await formatReadOutput({
    action: 'text',
    result: {
      tab: { id: 101, url: 'https://example.test/artifact', title: 'Artifact source' },
      text: pageText,
      length: pageText.length,
      truncated: false,
    },
    options: { artifactDir, summaryOnly: true },
    now: '2026-06-08T00:00:00.000Z',
  });

  const env = inheritedEnv();
  const last = await runCli(['last-artifact', '--artifact-dir', artifactDir], env);
  check(last.ok, `last-artifact failed: ${last.stderr || last.stdout}`);
  check(last.parsed?.artifactPath === envelope.artifactPath, 'last-artifact must return the latest indexed artifact path');
  check(last.parsed?.action === 'text', 'last-artifact must return action metadata');

  const read = await runCli([
    'read-artifact',
    '--path',
    envelope.artifactPath,
    '--head',
    '2',
    '--grep',
    'Payout',
  ], env);
  check(read.ok, `read-artifact failed: ${read.stderr || read.stdout}`);
  check(read.parsed?.head?.length <= 2, 'read-artifact --head must cap returned lines');
  check(read.parsed?.matches?.some((match) => match.text.includes('Payout')), 'read-artifact --grep must return matching snippets');
  check(!read.stdout.includes('Unrelated raw body'), 'read-artifact stdout must not include the full artifact body');
}

async function checkBridgeHelpers(tmpDir) {
  await withFakeBridge(async ({ socketPath, receivedCommands }) => {
    const artifactDir = path.join(tmpDir, 'bridge-artifacts');
    const env = inheritedEnv({ CHROME_BRIDGE_SOCKET: socketPath });

    const tabs = await runCli(['tabs', '--json', '--summary-only'], env);
    check(tabs.ok, `tabs --summary-only failed: ${tabs.stderr || tabs.stdout}`);
    check(tabs.parsed?.summaryOnly === true, 'tabs --summary-only must report summaryOnly=true');
    check(tabs.parsed?.counts?.tabs === 2, 'tabs --summary-only must expose tab count');
    check(!tabs.stdout.includes('x'.repeat(200)), 'tabs --summary-only must truncate long URLs');

    const status = await runCli(['status', '--token-budget'], env);
    check(status.ok, `status --token-budget failed: ${status.stderr || status.stdout}`);
    check(status.parsed?.tokenBudget?.mode === 'cheap-first', 'status --token-budget must expose cheap-first mode');
    check(status.parsed?.counts?.tabs === 2, 'status --token-budget must summarize tab counts');
    check(status.parsed?.recommendations?.some((item) => item.includes('tabs --summary-only')), 'status --token-budget must recommend cheap helper flow');
    check(!status.stdout.includes('x'.repeat(200)), 'status --token-budget must not include full long URLs');

    const grep = await runCli([
      'grep-page',
      '--tab',
      '5',
      '--pattern',
      'Payout|Geo',
      '--artifact-dir',
      artifactDir,
    ], env);
    check(grep.ok, `grep-page failed: ${grep.stderr || grep.stdout}`);
    check(grep.parsed?.matches?.length === 2, 'grep-page must return matching snippets only');
    check(grep.parsed?.artifactPath, 'grep-page must write raw text artifact');
    check(!grep.stdout.includes('Unrelated raw body'), 'grep-page stdout must not include unmatched raw text');

    const links = await runCli([
      'links',
      '--tab',
      '5',
      '--selector',
      'main',
      '--artifact-dir',
      artifactDir,
    ], env);
    check(links.ok, `links failed: ${links.stderr || links.stdout}`);
    check(links.parsed?.links?.some((link) => link.href.includes('landing')), 'links must extract anchors');
    check(links.parsed?.links?.some((link) => link.href.includes('spreadsheets')), 'links must include Google Sheet anchors');
    check(!links.stdout.includes('<main>') && !links.stdout.includes('Unrelated raw HTML'), 'links stdout must not include raw HTML');

    const tables = await runCli([
      'tables',
      '--tab',
      '5',
      '--selector',
      'main',
      '--artifact-dir',
      artifactDir,
    ], env);
    check(tables.ok, `tables failed: ${tables.stderr || tables.stdout}`);
    check(tables.parsed?.tables?.[0]?.rows?.[1]?.[1] === '900 RUB', 'tables must extract table cell text');
    check(!tables.stdout.includes('<table') && !tables.stdout.includes('Unrelated raw HTML'), 'tables stdout must not include raw HTML');

    const textCommand = receivedCommands.find((command) => command.action === 'text');
    check(textCommand?.payload?.fullPage === true, 'grep-page must default to full-page text coverage');
  });
}

async function checkSurface() {
  const [packageText, registry, cli, outputEnvelope] = await Promise.all([
    fs.readFile(path.join(rootDir, 'package.json'), 'utf8'),
    readRegistrySource(rootDir),
    readCliSource(rootDir),
    fs.readFile(path.join(rootDir, 'shared/output-envelope.mjs'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageText);
  check(packageJson.scripts?.['check:output-hygiene-helpers'] === 'node ./scripts/checks/features/check-output-hygiene-helpers.mjs', 'package.json must expose check:output-hygiene-helpers');
  check(packageJson.scripts?.check?.includes('npm run check:output-hygiene-helpers'), 'npm run check must include check:output-hygiene-helpers');
  for (const command of ['status', 'last-artifact', 'read-artifact', 'grep-page', 'links', 'tables']) {
    check(registry.includes(`'${command}'`), `registry must include ${command} CLI helper`);
    check(cli.includes(`cmd === '${command}'`), `CLI must route ${command}`);
  }
  check(registry.includes('tabs [--json --summary-only]'), 'registry must document tabs --summary-only');
  check(outputEnvelope.includes('recordArtifactIndex'), 'output envelope must record artifact index entries');
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-output-hygiene-check-'));
try {
  await checkArtifactHelpers(tmpDir);
  await checkBridgeHelpers(tmpDir);
  await checkSurface();
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
