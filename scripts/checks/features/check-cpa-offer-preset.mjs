#!/usr/bin/env node
import { createFakeNativeBridge } from '../lib/fake-native-bridge.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  CPA_OFFER_OUTPUT_CONTRACT_VERSION,
  extractCpaOffer,
} from '../../../shared/cpa-offer-extract.mjs';
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

const sampleText = [
  'Offer #LS-4421: FitLife Trial CPA',
  'Status: active, access granted',
  'Geo: RU, KZ, BY',
  'Payout rules: 900 RUB for approved lead, hold 14 days',
  'Allowed traffic: SEO, contextual ads, teaser networks',
  'Forbidden traffic: brand bidding, cashback, adult, motivated traffic',
  'By agreement: email traffic, social ads',
  'Moderation required before launch',
  'Tracking link: https://trk.leads.su/click?offer=4421',
  'Landing page: https://fitlife.example/landing',
  'Materials: https://cdn.example/materials/banner.zip',
  'Google sheet: https://docs.google.com/spreadsheets/d/abc123/edit',
  'Full raw offer body that should stay out of stdout.',
].join('\n');

const sampleHtml = `<!doctype html>
<html>
  <head><title>FitLife Trial CPA</title></head>
  <body>
    <main>
      <a href="https://trk.leads.su/click?offer=4421">Tracking</a>
      <a href="https://fitlife.example/landing">Landing</a>
      <a href="https://cdn.example/materials/banner.zip">Materials</a>
      <a href="https://docs.google.com/spreadsheets/d/abc123/edit">Sheet</a>
      <p>${sampleText}</p>
    </main>
  </body>
</html>`;

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
          tab: { id: parsed.payload.tabId ?? 71, url: 'https://leads.su/offers/4421', title: 'FitLife Trial CPA' },
          text: sampleText,
          length: sampleText.length,
          truncated: false,
          fullPageDiagnostics: {
            mode: 'full-page-scroll-walk',
            fullPage: true,
            scrollSteps: 3,
            restoredScroll: true,
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
          tab: { id: parsed.payload.tabId ?? 71, url: 'https://leads.su/offers/4421', title: 'FitLife Trial CPA' },
          url: 'https://leads.su/offers/4421',
          title: 'FitLife Trial CPA',
          selector: 'html',
          html: sampleHtml,
          length: sampleHtml.length,
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

async function checkPureExtraction(tmpDir) {
  const rawArtifactPath = path.join(tmpDir, 'raw-text.txt');
  const rawHtmlArtifactPath = path.join(tmpDir, 'raw-html.html');
  const offer = extractCpaOffer({
    text: sampleText,
    html: sampleHtml,
    sourceNetwork: 'leads_su',
    sourceUrl: 'https://leads.su/offers/4421',
    title: 'FitLife Trial CPA',
    rawArtifactPath,
    rawHtmlArtifactPath,
  });

  check(offer.outputContract === CPA_OFFER_OUTPUT_CONTRACT_VERSION, 'pure cpa offer extraction must expose the CPA offer contract version');
  check(offer.sourceNetwork === 'leads_su', 'pure cpa offer extraction must preserve sourceNetwork');
  check(offer.sourceOfferId === '4421', 'pure cpa offer extraction must infer sourceOfferId');
  check(offer.title === 'FitLife Trial CPA', 'pure cpa offer extraction must preserve title');
  check(offer.pageState === 'active', 'pure cpa offer extraction must infer active pageState');
  check(offer.accessStatus === 'granted', 'pure cpa offer extraction must infer accessStatus');
  check(offer.moderationRequired === true, 'pure cpa offer extraction must infer moderationRequired');
  check(offer.geoHints?.includes('RU') && offer.geoHints?.includes('KZ'), 'pure cpa offer extraction must infer geo hints');
  check(offer.trackingLinks?.some((link) => link.href.includes('trk.leads.su')), 'pure cpa offer extraction must classify tracking links');
  check(offer.landingLinks?.some((link) => link.href.includes('fitlife.example')), 'pure cpa offer extraction must classify landing links');
  check(offer.materialLinks?.some((link) => link.href.includes('banner.zip')), 'pure cpa offer extraction must classify material links');
  check(offer.googleSheetLinks?.some((link) => link.href.includes('docs.google.com')), 'pure cpa offer extraction must classify Google Sheet links');
  check(offer.payoutRules?.some((item) => item.includes('900 RUB')), 'pure cpa offer extraction must capture payout rules');
  check(offer.trafficAllow?.some((item) => item.includes('SEO')), 'pure cpa offer extraction must capture allowed traffic');
  check(offer.trafficForbid?.some((item) => item.includes('brand bidding')), 'pure cpa offer extraction must capture forbidden traffic');
  check(offer.trafficByAgreement?.some((item) => item.includes('email traffic')), 'pure cpa offer extraction must capture by-agreement traffic');
  check(offer.rawArtifactPath === rawArtifactPath, 'pure cpa offer extraction must include rawArtifactPath');
  check(offer.rawHtmlArtifactPath === rawHtmlArtifactPath, 'pure cpa offer extraction must include rawHtmlArtifactPath');
  check(!JSON.stringify(offer).includes('Full raw offer body'), 'pure cpa offer extraction must not inline the full raw body');

  const noModerationOffer = extractCpaOffer({
    text: [
      'Offer #LS-4422: FitLife Trial CPA',
      'Status: active, access granted',
      'No moderation required before launch',
    ].join('\n'),
    html: '<html><head><title>FitLife Trial CPA</title></head><body>No moderation required before launch</body></html>',
    sourceNetwork: 'leads_su',
    sourceUrl: 'https://leads.su/offers/4422',
    title: 'FitLife Trial CPA',
  });
  check(noModerationOffer.moderationRequired === false, 'pure cpa offer extraction must not treat "No moderation required" as moderationRequired=true');
}

async function checkCliPreset(tmpDir) {
  await withFakeBridge(async ({ socketPath, receivedCommands }) => {
    const out = path.join(tmpDir, 'offer.json');
    const rawDir = path.join(tmpDir, 'raw');
    const result = await runCli([
      'extract',
      '--preset',
      'cpa-offer',
      '--network',
      'leads_su',
      '--tab',
      '71',
      '--out',
      out,
      '--artifact-dir',
      rawDir,
    ], inheritedEnv({ CHROME_BRIDGE_SOCKET: socketPath }));

    check(result.ok, `cpa-offer CLI preset failed: ${result.stderr || result.stdout}`);
    check(JSON.stringify(result.parsed).length < 12_000, 'cpa-offer CLI stdout JSON must stay under 12k chars');
    check(result.parsed?.ok === true, 'cpa-offer CLI summary must report ok=true');
    check(result.parsed?.preset === 'cpa-offer', 'cpa-offer CLI summary must report preset');
    check(result.parsed?.outputContract === CPA_OFFER_OUTPUT_CONTRACT_VERSION, 'cpa-offer CLI summary must report contract version');
    check(result.parsed?.artifactPath === out, 'cpa-offer CLI summary must expose structured artifact path');
    check(typeof result.parsed?.rawArtifactPath === 'string', 'cpa-offer CLI summary must expose raw text artifact path');
    check(typeof result.parsed?.rawHtmlArtifactPath === 'string', 'cpa-offer CLI summary must expose raw HTML artifact path');
    check(!result.stdout.includes('Full raw offer body'), 'cpa-offer CLI stdout must not inline raw text/html');

    const structured = JSON.parse(await fs.readFile(out, 'utf8'));
    check(structured.outputContract === CPA_OFFER_OUTPUT_CONTRACT_VERSION, 'structured CPA artifact must expose contract version');
    check(structured.sourceNetwork === 'leads_su', 'structured CPA artifact must preserve sourceNetwork');
    check(structured.sourceOfferId === '4421', 'structured CPA artifact must infer sourceOfferId');
    check(structured.trackingLinks?.length === 1, 'structured CPA artifact must include tracking links');
    check(structured.landingLinks?.length === 1, 'structured CPA artifact must include landing links');
    check(structured.materialLinks?.length === 1, 'structured CPA artifact must include material links');
    check(structured.googleSheetLinks?.length === 1, 'structured CPA artifact must include Google Sheet links');

    check(await fs.readFile(result.parsed.rawArtifactPath, 'utf8') === sampleText, 'raw text artifact must contain full text');
    check(await fs.readFile(result.parsed.rawHtmlArtifactPath, 'utf8') === sampleHtml, 'raw HTML artifact must contain full HTML');

    const actions = receivedCommands.map((command) => command.action);
    check(actions.includes('text'), 'cpa-offer CLI preset must read full-page text');
    check(actions.includes('html'), 'cpa-offer CLI preset must read HTML');
    check(!actions.includes('cookiesList') && !actions.includes('storageSnapshot') && !actions.includes('fetchUrl'), 'cpa-offer CLI preset must not inspect cookies, storage, or credentialed requests');
    const textPayload = receivedCommands.find((command) => command.action === 'text')?.payload || {};
    check(textPayload.fullPage === true, 'cpa-offer CLI preset must request full-page text coverage');
    check(textPayload.tabId === 71, 'cpa-offer CLI preset must forward tabId');
  });
}

async function checkSurface() {
  const [packageText, registry, cli, mcp] = await Promise.all([
    fs.readFile(path.join(rootDir, 'package.json'), 'utf8'),
    readRegistrySource(rootDir),
    readCliSource(rootDir),
    readMcpSource(rootDir),
  ]);
  const packageJson = JSON.parse(packageText);
  check(packageJson.scripts?.['check:cpa-offer-preset'] === 'node ./scripts/checks/features/check-cpa-offer-preset.mjs', 'package.json must expose check:cpa-offer-preset');
  check(packageJson.scripts?.check?.includes('npm run check:cpa-offer-preset'), 'npm run check must include check:cpa-offer-preset');
  check(registry.includes('--preset cpa-offer'), 'CLI usage registry must document --preset cpa-offer');
  check(cli.includes("args.preset === 'cpa-offer'"), 'CLI must route extract --preset cpa-offer');
  check(mcp.includes("'cpa-offer'") && mcp.includes('preset: z.enum'), 'MCP extract schema must expose cpa-offer preset');
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-cpa-offer-check-'));
try {
  await checkPureExtraction(tmpDir);
  await checkCliPreset(tmpDir);
  await checkSurface();
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
