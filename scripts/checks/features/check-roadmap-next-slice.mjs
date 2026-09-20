#!/usr/bin/env node
import { createFakeNativeBridge } from '../lib/fake-native-bridge.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  STRUCTURED_PRESET_OUTPUT_CONTRACT_VERSION,
  extractStructuredPreset,
} from '../../../shared/structured-extract.mjs';
import {
  DOWNLOAD_DISCOVERY_OUTPUT_CONTRACT_VERSION,
  discoverDownloads,
} from '../../../shared/download-discovery.mjs';
import {
  LIGHTHOUSE_INGEST_OUTPUT_CONTRACT_VERSION,
  ingestLighthouseReport,
  ingestLighthouseReportFile,
} from '../../../shared/lighthouse-ingest.mjs';
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
      timeout: 25_000,
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
      // Non-JSON failures are reported by callers.
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
  'Acme Analytics Platform',
  'By Ada Metrics',
  'Published June 12, 2026',
  'Acme Analytics helps operators monitor revenue, retention, and incidents.',
  'Pricing',
  'Starter - $19 per month - CSV export - Email support',
  'Growth - $79 per month - PDF export - Priority support',
  'Enterprise - Custom pricing - SSO - Audit logs',
  'SKU: ACME-ANALYTICS-PRO',
  'Availability: In stock',
  'Download PDF brochure: https://example.test/files/acme-brochure.pdf',
  'Export CSV: https://example.test/export/report.csv',
  'Offline XLSX: https://example.test/export/pricing.xlsx',
  'This raw article body is intentionally long enough to prove stdout stays summarized.',
].join('\n');

const sampleHtml = `<!doctype html>
<html>
  <head>
    <title>Acme Analytics Platform</title>
    <meta name="author" content="Ada Metrics">
    <meta property="article:published_time" content="2026-06-12T09:00:00Z">
  </head>
  <body>
    <main>
      <article>
        <h1>Acme Analytics Platform</h1>
        <p class="byline">By Ada Metrics</p>
        <time datetime="2026-06-12">June 12, 2026</time>
        <p>Acme Analytics helps operators monitor revenue, retention, and incidents.</p>
        <h2>Pricing</h2>
        <table>
          <tr><th>Plan</th><th>Price</th><th>Features</th></tr>
          <tr><td>Starter</td><td>$19/mo</td><td>CSV export, Email support</td></tr>
          <tr><td>Growth</td><td>$79/mo</td><td>PDF export, Priority support</td></tr>
          <tr><td>Enterprise</td><td>Custom</td><td>SSO, Audit logs</td></tr>
        </table>
        <dl>
          <dt>SKU</dt><dd>ACME-ANALYTICS-PRO</dd>
          <dt>Availability</dt><dd>In stock</dd>
        </dl>
        <a href="/files/acme-brochure.pdf" download>Download PDF brochure</a>
        <a href="/export/report.csv">Export CSV</a>
        <a href="/export/pricing.xlsx">Offline XLSX</a>
        <button>Export current view</button>
      </article>
    </main>
  </body>
</html>`;

const sampleLighthouseReport = {
  lighthouseVersion: '12.0.0',
  requestedUrl: 'https://example.test/product',
  finalDisplayedUrl: 'https://example.test/product',
  fetchTime: '2026-06-12T09:00:00.000Z',
  categories: {
    performance: { score: 0.82 },
    accessibility: { score: 0.97 },
    'best-practices': { score: 0.91 },
    seo: { score: 0.88 },
  },
  audits: {
    'largest-contentful-paint': {
      id: 'largest-contentful-paint',
      title: 'Largest Contentful Paint',
      score: 0.45,
      displayValue: '4.2 s',
    },
    'uses-responsive-images': {
      id: 'uses-responsive-images',
      title: 'Properly size images',
      score: 0,
      displayValue: 'Potential savings of 900 KiB',
    },
    'document-title': {
      id: 'document-title',
      title: 'Document has a title element',
      score: 1,
    },
  },
};

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
          tab: { id: parsed.payload.tabId ?? 81, url: 'https://example.test/product', title: 'Acme Analytics Platform' },
          url: 'https://example.test/product',
          title: 'Acme Analytics Platform',
          text: sampleText,
          length: sampleText.length,
          truncated: false,
          fullPageDiagnostics: {
            mode: 'full-page-scroll-walk',
            fullPage: true,
            scrollSteps: 2,
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
          tab: { id: parsed.payload.tabId ?? 81, url: 'https://example.test/product', title: 'Acme Analytics Platform' },
          url: 'https://example.test/product',
          title: 'Acme Analytics Platform',
          selector: parsed.payload.selector || 'html',
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

async function checkPureStructuredPresets(tmpDir) {
  const rawArtifactPath = path.join(tmpDir, 'raw-text.txt');
  const rawHtmlArtifactPath = path.join(tmpDir, 'raw-html.html');
  const common = {
    text: sampleText,
    html: sampleHtml,
    sourceUrl: 'https://example.test/product',
    title: 'Acme Analytics Platform',
    rawArtifactPath,
    rawHtmlArtifactPath,
  };

  const article = extractStructuredPreset({ preset: 'article', ...common });
  check(article.outputContract === STRUCTURED_PRESET_OUTPUT_CONTRACT_VERSION, 'article preset must expose structured contract version');
  check(article.schema?.name === 'article', 'article preset must expose schema name');
  check(article.data?.title === 'Acme Analytics Platform', 'article preset must extract title');
  check(article.data?.byline === 'Ada Metrics', 'article preset must extract byline');
  check(article.data?.publishedDate === '2026-06-12', 'article preset must extract published date');
  check(article.rawArtifactPath === rawArtifactPath && article.rawHtmlArtifactPath === rawHtmlArtifactPath, 'article preset must preserve raw artifact paths');
  check(!JSON.stringify(article).includes('intentionally long enough'), 'article preset must not inline raw page body');

  const product = extractStructuredPreset({ preset: 'product-page', ...common });
  check(product.schema?.name === 'product-page', 'product-page preset must expose schema name');
  check(product.data?.title === 'Acme Analytics Platform', 'product-page preset must extract title');
  check(product.data?.sku === 'ACME-ANALYTICS-PRO', 'product-page preset must extract SKU');
  check(product.data?.availability === 'In stock', 'product-page preset must extract availability');
  check(product.data?.downloadLinks?.some((link) => link.href.endsWith('/files/acme-brochure.pdf')), 'product-page preset must expose relevant download links');
  check(product.data?.downloadLinks?.some((link) => link.href.endsWith('/files/acme-brochure.pdf') && link.download === true), 'product-page preset must preserve bare download attribute links');

  const dataDownloadProduct = extractStructuredPreset({
    preset: 'product-page',
    ...common,
    html: '<a href="/files/manual.pdf" data-download>Manual PDF</a>',
  });
  check(dataDownloadProduct.data?.downloadLinks?.some((link) => link.download === false), 'product-page preset must not treat data-download as a download attribute');

  const pricing = extractStructuredPreset({ preset: 'pricing-table', ...common });
  check(pricing.schema?.name === 'pricing-table', 'pricing-table preset must expose schema name');
  check(pricing.data?.plans?.length === 3, 'pricing-table preset must extract three plans');
  check(pricing.data?.plans?.some((plan) => plan.name === 'Growth' && plan.price === '$79/mo'), 'pricing-table preset must extract Growth price');
}

async function checkPureDownloadDiscovery() {
  const discovery = discoverDownloads({
    html: sampleHtml,
    text: sampleText,
    sourceUrl: 'https://example.test/product',
    title: 'Acme Analytics Platform',
  });
  check(discovery.outputContract === DOWNLOAD_DISCOVERY_OUTPUT_CONTRACT_VERSION, 'download discovery must expose contract version');
  check(discovery.downloadCandidates?.length >= 3, 'download discovery must find downloadable links');
  check(discovery.downloadCandidates?.some((item) => item.fileType === 'pdf'), 'download discovery must classify PDF links');
  check(discovery.downloadCandidates?.some((item) => item.fileType === 'pdf' && item.kind === 'download-attribute'), 'download discovery must classify bare download attributes');
  check(discovery.downloadCandidates?.some((item) => item.fileType === 'csv'), 'download discovery must classify CSV links');
  check(discovery.exportActionCandidates?.some((item) => /export current view/i.test(item.label)), 'download discovery must find export action buttons');
  check(!JSON.stringify(discovery).includes('<html>'), 'download discovery output must not inline raw HTML');

  const dataDownloadDiscovery = discoverDownloads({
    html: '<a href="/files/manual.pdf" data-download>Manual PDF</a>',
    sourceUrl: 'https://example.test/product',
  });
  check(dataDownloadDiscovery.downloadCandidates?.some((item) => item.kind === 'file-link'), 'download discovery must not treat data-download as a download attribute');
}

async function checkPureLighthouseIngest() {
  const summary = ingestLighthouseReport({
    report: sampleLighthouseReport,
    reportPath: '/tmp/lighthouse-report.json',
  });
  check(summary.outputContract === LIGHTHOUSE_INGEST_OUTPUT_CONTRACT_VERSION, 'Lighthouse ingest must expose contract version');
  check(summary.url === 'https://example.test/product', 'Lighthouse ingest must preserve URL');
  check(summary.scores?.performance === 82, 'Lighthouse ingest must convert performance score to percent');
  check(summary.scores?.accessibility === 97, 'Lighthouse ingest must convert accessibility score to percent');
  check(summary.failingAudits?.some((audit) => audit.id === 'largest-contentful-paint'), 'Lighthouse ingest must include failing audits');
  check(!JSON.stringify(summary).includes('details'), 'Lighthouse ingest summary must omit bulky raw audit details');
}

async function checkInvalidLighthouseJson(tmpDir) {
  const reportPath = path.join(tmpDir, 'invalid-lighthouse.json');
  await fs.writeFile(reportPath, '{not valid json}\n');
  let message = '';
  try {
    await ingestLighthouseReportFile({ reportPath });
  } catch (error) {
    message = String(error?.message || error);
  }
  check(message.startsWith('Invalid Lighthouse JSON report:'), 'Lighthouse ingest must wrap invalid JSON parse errors');
}

async function checkCliStructuredPreset(tmpDir) {
  await withFakeBridge(async ({ socketPath, receivedCommands }) => {
    const out = path.join(tmpDir, 'article.json');
    const rawDir = path.join(tmpDir, 'raw-article');
    const result = await runCli([
      'extract',
      '--preset',
      'article',
      '--tab',
      '81',
      '--out',
      out,
      '--artifact-dir',
      rawDir,
    ], inheritedEnv({ CHROME_BRIDGE_SOCKET: socketPath }));

    check(result.ok, `article CLI preset failed: ${result.stderr || result.stdout}`);
    check(result.parsed?.ok === true, 'article CLI preset summary must report ok=true');
    check(result.parsed?.preset === 'article', 'article CLI preset summary must report preset');
    check(result.parsed?.outputContract === STRUCTURED_PRESET_OUTPUT_CONTRACT_VERSION, 'article CLI preset summary must report contract');
    check(result.parsed?.artifactPath === out, 'article CLI preset summary must expose structured artifact path');
    check(typeof result.parsed?.rawArtifactPath === 'string', 'article CLI preset summary must expose raw text artifact path');
    check(typeof result.parsed?.rawHtmlArtifactPath === 'string', 'article CLI preset summary must expose raw HTML artifact path');
    check(JSON.stringify(result.parsed).length < 12_000, 'article CLI preset stdout must stay summarized');

    const structured = JSON.parse(await fs.readFile(out, 'utf8'));
    check(structured.schema?.name === 'article', 'article structured artifact must expose schema name');
    check(structured.data?.title === 'Acme Analytics Platform', 'article structured artifact must contain title');
    check(await fs.readFile(result.parsed.rawArtifactPath, 'utf8') === sampleText, 'article raw text artifact must contain full text');

    const actions = receivedCommands.map((command) => command.action);
    check(actions.includes('text') && actions.includes('html'), 'article preset must read text and HTML only');
    check(!actions.includes('cookiesList') && !actions.includes('storageSnapshot') && !actions.includes('fetchUrl'), 'article preset must not inspect private browser data');
  });
}

async function checkCliDownloadDiscovery(tmpDir) {
  await withFakeBridge(async ({ socketPath, receivedCommands }) => {
    const out = path.join(tmpDir, 'downloads.json');
    const rawDir = path.join(tmpDir, 'raw-downloads');
    const result = await runCli([
      'download-discovery',
      '--tab',
      '81',
      '--out',
      out,
      '--artifact-dir',
      rawDir,
    ], inheritedEnv({ CHROME_BRIDGE_SOCKET: socketPath }));

    check(result.ok, `download-discovery CLI failed: ${result.stderr || result.stdout}`);
    check(result.parsed?.ok === true, 'download-discovery summary must report ok=true');
    check(result.parsed?.outputContract === DOWNLOAD_DISCOVERY_OUTPUT_CONTRACT_VERSION, 'download-discovery summary must report contract');
    check(result.parsed?.artifactPath === out, 'download-discovery summary must expose structured artifact path');
    check(result.parsed?.counts?.downloadCandidates >= 3, 'download-discovery summary must report download count');
    check(!result.stdout.includes('<html>'), 'download-discovery stdout must not inline raw HTML');

    const structured = JSON.parse(await fs.readFile(out, 'utf8'));
    check(structured.downloadCandidates?.some((item) => item.fileType === 'xlsx'), 'download-discovery artifact must include XLSX candidate');
    const actions = receivedCommands.map((command) => command.action);
    check(actions.includes('html'), 'download-discovery must read page HTML');
    check(!actions.includes('click') && !actions.includes('fetchUrl'), 'download-discovery must not click or fetch candidate URLs');
  });
}

async function checkCliLighthouseIngest(tmpDir) {
  const reportPath = path.join(tmpDir, 'lighthouse.json');
  const out = path.join(tmpDir, 'lighthouse-summary.json');
  await fs.writeFile(reportPath, `${JSON.stringify(sampleLighthouseReport, null, 2)}\n`);
  const result = await runCli([
    'lighthouse-ingest',
    '--report',
    reportPath,
    '--out',
    out,
  ], inheritedEnv());

  check(result.ok, `lighthouse-ingest CLI failed: ${result.stderr || result.stdout}`);
  check(result.parsed?.ok === true, 'lighthouse-ingest summary must report ok=true');
  check(result.parsed?.outputContract === LIGHTHOUSE_INGEST_OUTPUT_CONTRACT_VERSION, 'lighthouse-ingest summary must report contract');
  check(result.parsed?.artifactPath === out, 'lighthouse-ingest summary must expose artifact path');
  check(result.parsed?.scores?.performance === 82, 'lighthouse-ingest summary must include score percentages');
  check(result.parsed?.failingAuditCount === 2, 'lighthouse-ingest summary must report failing audit count');
  const structured = JSON.parse(await fs.readFile(out, 'utf8'));
  check(structured.failingAudits?.length === 2, 'lighthouse-ingest artifact must include failing audits');
}

async function checkSurface() {
  const [packageText, registry, cli, mcp, packageContentsChecker] = await Promise.all([
    fs.readFile(path.join(rootDir, 'package.json'), 'utf8'),
    readRegistrySource(rootDir),
    readCliSource(rootDir),
    readMcpSource(rootDir),
    fs.readFile(path.join(rootDir, 'scripts/package/check-package-contents.mjs'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageText);
  check(packageJson.scripts?.['check:roadmap-next-slice'] === 'node ./scripts/checks/features/check-roadmap-next-slice.mjs', 'package.json must expose check:roadmap-next-slice');
  check(packageJson.scripts?.check?.includes('npm run check:roadmap-next-slice'), 'npm run check must include check:roadmap-next-slice');
  check(registry.includes("--preset cpa-offer|article|product-page|pricing-table"), 'CLI usage registry must document structured preset enum');
  check(registry.includes('download-discovery'), 'registry must expose download-discovery command');
  check(registry.includes('lighthouse-ingest'), 'registry must expose lighthouse-ingest command');
  check(cli.includes("args.preset === 'cpa-offer'") && cli.includes('buildStructuredPresetExtraction'), 'CLI must route cpa-offer and structured extraction presets');
  check(cli.includes("cmd === 'download-discovery'"), 'CLI must implement download-discovery');
  check(cli.includes("cmd === 'lighthouse-ingest'"), 'CLI must implement lighthouse-ingest');
  check(mcp.includes("z.enum(['cpa-offer', 'article', 'product-page', 'pricing-table'])"), 'MCP extract schema must expose all presets');
  check(mcp.includes("'chrome_bridge_download_discovery'"), 'MCP must expose download discovery tool');
  check(mcp.includes("'chrome_bridge_lighthouse_ingest'"), 'MCP must expose Lighthouse ingest tool');
  for (const requiredPath of [
    'shared/structured-extract.mjs',
    'shared/download-discovery.mjs',
    'shared/lighthouse-ingest.mjs',
    'scripts/checks/features/check-roadmap-next-slice.mjs',
  ]) {
    check(packageContentsChecker.includes(`'${requiredPath}'`), `package contents checker must require ${requiredPath}`);
  }
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-next-slice-check-'));
try {
  await checkPureStructuredPresets(tmpDir);
  await checkPureDownloadDiscovery();
  await checkPureLighthouseIngest();
  await checkInvalidLighthouseJson(tmpDir);
  await checkCliStructuredPreset(tmpDir);
  await checkCliDownloadDiscovery(tmpDir);
  await checkCliLighthouseIngest(tmpDir);
  await checkSurface();
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
