#!/usr/bin/env node
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const REQUIRED_PACKAGE_FILES = Object.freeze([
  'bin/chrome-bridge.mjs',
  'bin/cli/main.mjs',
  'mcp/chrome-bridge-mcp.mjs',
  'mcp/server/main.mjs',
  'native/host.mjs',
  'shared/action-recording.mjs',
  'shared/command-registry.mjs',
  'shared/registry/actions.mjs',
  'shared/registry/metadata.mjs',
  'shared/registry/cli-usage.mjs',
  'shared/registry/surfaces.mjs',
  'shared/registry/generated-docs.mjs',
  'shared/registry/validation.mjs',
  'shared/registry/index.mjs',
  'shared/cpa-offer-extract.mjs',
  'shared/diagnostics-output.mjs',
  'shared/download-discovery.mjs',
  'shared/fetch-timeout.mjs',
  'shared/lighthouse-plan.mjs',
  'shared/lighthouse-ingest.mjs',
  'shared/network-export.mjs',
  'shared/page-search.mjs',
  'shared/act-preview.mjs',
  'shared/act-preview-state.mjs',
  'shared/output-envelope.mjs',
  'shared/run-tabs.mjs',
  'shared/safe-record.mjs',
  'shared/session-group-title.mjs',
  'shared/structured-extract.mjs',
  'shared/tool-advisor.mjs',
  'extension/manifest.json',
  'extension/background.js',
  'extension/browser-data.js',
  'extension/debugger-session.js',
  'extension/download-actions.js',
  'extension/emulation-actions.js',
  'extension/extension-errors.js',
  'extension/keyboard-events.js',
  'extension/navigation-actions.js',
  'extension/page-execution.js',
  'extension/page-artifacts.js',
  'extension/page-read-actions.js',
  'extension/page-interactions.js',
  'extension/page-scripts.js',
  'extension/page-scripts/main.js',
  'extension/runtime-actions.js',
  'extension/safety-gates.js',
  'extension/tab-cleanup.js',
  'extension/tab-group-persistence.js',
  'extension/tab-info.js',
  'extension/tab-loading.js',
  'extension/trace-actions.js',
  'extension/user-prompts.js',
  'extension/workspace-policy.js',
  'extension/workspace-tabs.js',
  'extension/ask.html',
  'extension/ask.js',
  'docs/ARCHITECTURE.md',
  'docs/CLI.md',
  'docs/MCP.md',
  'docs/SAFETY.md',
  'docs/COMMAND-CATALOG.md',
  'docs/COMPATIBILITY.md',
  'docs/COMPETITIVE-ROADMAP.md',
  'docs/DISTRIBUTION.md',
  'docs/EXAMPLES.md',
  'docs/INSTALL.md',
  'docs/MAINTAINABILITY.md',
  'docs/PRIVACY-POLICY.md',
  'docs/REGISTRY-SUBMISSIONS.md',
  'docs/REAL-PAGE-VALIDATION.md',
  'docs/PUBLISHING.md',
  'examples/fixtures/article-news.html',
  'examples/fixtures/downloads.html',
  'examples/fixtures/lighthouse-report.json',
  'examples/fixtures/pricing-linear.html',
  'examples/fixtures/pricing-table.html',
  'examples/fixtures/product-page.html',
  'examples/mcp-clients/README.md',
  'examples/mcp-clients/claude-code.mcp.json',
  'examples/mcp-clients/cursor.mcp.json',
  'examples/mcp-clients/codex.config.toml',
  'examples/mcp-clients/vscode.mcp.json',
  'examples/mcp-clients/windsurf.mcp.json',
  'examples/mcp-clients/hermes.config.yaml',
  'examples/mcp-clients/generic.mcp.json',
  'scripts/docs/generate-command-catalog.mjs',
  'scripts/package/build-extension-zip.mjs',
  'scripts/checks/contracts/check-command-registry.mjs',
  'scripts/checks/contracts/check-registry-module-boundaries.mjs',
  'scripts/checks/contracts/check-bridge-contract.mjs',
  'scripts/checks/lib/registry-source.mjs',
  'scripts/docs/check-docs-coverage.mjs',
  'scripts/checks/release/check-runtime-smoke-plan.mjs',
  'scripts/checks/release/check-roadmap-coverage.mjs',
  'scripts/checks/cli/check-cli-local-tools.mjs',
  'scripts/checks/cli/check-cli-module-boundaries.mjs',
  'scripts/checks/lib/cli-source.mjs',
  'scripts/checks/mcp/check-mcp-runtime-smoke.mjs',
  'scripts/checks/mcp/check-mcp-local-tools.mjs',
  'scripts/checks/mcp/check-mcp-module-boundaries.mjs',
  'scripts/checks/mcp/check-mcp-prompts.mjs',
  'scripts/checks/mcp/check-mcp-resources.mjs',
  'scripts/checks/lib/mcp-source.mjs',
  'scripts/checks/features/check-tool-advisor.mjs',
  'scripts/checks/extension/check-tab-group-persistence.mjs',
  'scripts/checks/contracts/check-output-contract.mjs',
  'scripts/checks/features/check-run-tab-ownership.mjs',
  'scripts/checks/features/check-full-page-read.mjs',
  'scripts/checks/features/check-cpa-offer-preset.mjs',
  'scripts/checks/features/check-size-aware-screenshot.mjs',
  'scripts/checks/features/check-output-hygiene-helpers.mjs',
  'scripts/checks/features/check-diagnostics.mjs',
  'scripts/checks/extension/check-download-manager.mjs',
  'scripts/checks/extension/check-emulation.mjs',
  'scripts/checks/features/check-network-export.mjs',
  'scripts/checks/features/check-ubs-fixes.mjs',
  'scripts/checks/features/check-roadmap-next-slice.mjs',
  'scripts/checks/features/check-examples-gallery.mjs',
  'scripts/docs/check-client-docs.mjs',
  'scripts/docs/check-client-config-examples.mjs',
  'scripts/package/check-alias-package.mjs',
  'scripts/checks/features/check-act-preview.mjs',
  'scripts/checks/features/check-act-apply.mjs',
  'scripts/checks/features/check-lighthouse-plan.mjs',
  'scripts/package/check-extension-package.mjs',
  'scripts/checks/extension/check-page-scripts-modules.mjs',
  'scripts/checks/lib/page-scripts-source.mjs',
  'scripts/checks/lib/file-metrics.mjs',
  'scripts/package/check-package-contents.mjs',
  'scripts/checks/release/check-privacy-scan.mjs',
  'scripts/checks/release/check-maintainability.mjs',
  'scripts/service/install-launch-agent.mjs',
  'scripts/service/uninstall-launch-agent.mjs',
  'scripts/service/install-native-host.mjs',
  'scripts/service/uninstall-native-host.mjs',
  'README.md',
  'llms.txt',
  'CHANGELOG.md',
  'LICENSE',
  'SECURITY.md',
  'SUPPORT.md',
]);

const FORBIDDEN_PACKAGE_PATH_PREFIXES = Object.freeze([
  '.github/',
  '.git/',
  'codex/',
  'node_modules/',
  'screenshots/',
  'tmp/',
]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parsePackOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const [entry] = parsed;
    if (!entry || !Array.isArray(entry.files)) {
      throw new Error('missing files array');
    }
    return entry;
  } catch (error) {
    throw new Error(`Unable to parse npm pack --dry-run --json output: ${String(error?.message || error)}`);
  }
}

async function copyPackFileList(paths, packageDir) {
  for (const filePath of paths) {
    const source = path.join(rootDir, filePath);
    const destination = path.join(packageDir, filePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
}

async function checkPackagedRegistryScript(paths) {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'codex-chrome-bridge-pack-'));
  const packageDir = path.join(tempDir, 'package');
  try {
    await copyPackFileList(paths, packageDir);
    await execFileAsync(npmCommand, ['run', 'check:registry', '--prefix', packageDir], {
      maxBuffer: 5 * 1024 * 1024,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error),
      stdout: error?.stdout?.trim?.() || '',
      stderr: error?.stderr?.trim?.() || '',
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const { stdout } = await execFileAsync(npmCommand, ['pack', '--dry-run', '--json'], {
  maxBuffer: 5 * 1024 * 1024,
});

const pack = parsePackOutput(stdout);
const paths = new Set(pack.files.map((file) => file.path));
const failures = [];

for (const requiredPath of REQUIRED_PACKAGE_FILES) {
  if (!paths.has(requiredPath)) {
    failures.push(`package tarball is missing required file: ${requiredPath}`);
  }
}

for (const filePath of paths) {
  if (FORBIDDEN_PACKAGE_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    failures.push(`package tarball includes forbidden path: ${filePath}`);
  }
}

if (pack.entryCount !== paths.size) {
  failures.push(`package tarball entryCount ${pack.entryCount} does not match file list size ${paths.size}`);
}

const packagedRegistryCheck = await checkPackagedRegistryScript(paths);
if (!packagedRegistryCheck.ok) {
  failures.push([
    'package tarball layout cannot run npm run check:registry',
    packagedRegistryCheck.stderr,
    packagedRegistryCheck.stdout,
  ].filter(Boolean).join('\n'));
}

if (failures.length) {
  fail(failures.map((failure) => `- ${failure}`).join('\n'));
} else {
  process.stdout.write(JSON.stringify({
    ok: true,
    name: pack.name,
    version: pack.version,
    filename: pack.filename,
    entryCount: pack.entryCount,
    requiredFiles: REQUIRED_PACKAGE_FILES.length,
    packagedRegistryCheck: packagedRegistryCheck.ok,
    unpackedSize: pack.unpackedSize,
  }, null, 2));
  process.stdout.write('\n');
}
