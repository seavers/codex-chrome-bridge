#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function listRepoExtensionFiles() {
  const extensionDir = path.join(rootDir, 'extension');
  async function walk(dir, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) return walk(absolutePath, relativePath);
      if (entry.isFile()) return [relativePath];
      return [];
    }));
    return nested.flat().sort();
  }
  return walk(extensionDir);
}

async function runBuild(outputPath) {
  try {
    const result = await execFileAsync(process.execPath, [
      path.join(rootDir, 'scripts/package/build-extension-zip.mjs'),
      '--out',
      outputPath,
    ], {
      cwd: rootDir,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(result.stdout);
  } catch (error) {
    failures.push(`extension zip build failed: ${error?.stderr || error?.stdout || error?.message || error}`);
    return null;
  }
}

async function zipEntries(zipPath) {
  try {
    const result = await execFileAsync('/usr/bin/unzip', ['-Z1', zipPath], {
      cwd: rootDir,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean).sort();
  } catch (error) {
    failures.push(`unable to inspect extension zip: ${error?.stderr || error?.stdout || error?.message || error}`);
    return [];
  }
}

const [packageJson, manifestJson, readmeText, extensionDocText, publishingText, installText, registryText, privacyPolicyText, storeListingText] = await Promise.all([
  fs.readFile(path.join(rootDir, 'package.json'), 'utf8').then((text) => JSON.parse(text)),
  fs.readFile(path.join(rootDir, 'extension/manifest.json'), 'utf8').then((text) => JSON.parse(text)),
  fs.readFile(path.join(rootDir, 'README.md'), 'utf8'),
  fs.readFile(path.join(rootDir, 'docs/EXTENSION.md'), 'utf8'),
  fs.readFile(path.join(rootDir, 'docs/PUBLISHING.md'), 'utf8'),
  fs.readFile(path.join(rootDir, 'docs/INSTALL.md'), 'utf8'),
  fs.readFile(path.join(rootDir, 'docs/REGISTRY-SUBMISSIONS.md'), 'utf8'),
  fs.readFile(path.join(rootDir, 'docs/PRIVACY-POLICY.md'), 'utf8'),
  fs.readFile(path.join(rootDir, 'docs/CHROME-WEB-STORE.md'), 'utf8').catch(() => ''),
]);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-extension-zip-'));
const outputPath = path.join(tempDir, 'chrome-mcp-bridge-extension.zip');
const build = await runBuild(outputPath);
const archiveFiles = await zipEntries(outputPath);
const repoFiles = await listRepoExtensionFiles();

check(build?.ok === true, 'extension zip build must succeed');
check(build?.action === 'extension-zip', 'extension zip build must report action=extension-zip');
check(build?.version === manifestJson.version, 'extension zip build must report the manifest version');
check(build?.outputPath === outputPath, 'extension zip build must honor the explicit --out path');
check(build?.fileCount === repoFiles.length, 'extension zip build must report the packaged file count');
check(manifestJson.version === packageJson.version, 'extension manifest and package versions must match');
check(JSON.stringify(archiveFiles) === JSON.stringify(repoFiles), 'extension zip must contain exactly the tracked extension files');
check(archiveFiles.includes('manifest.json'), 'extension zip must include manifest.json');
check(archiveFiles.includes('background.js'), 'extension zip must include background.js');
check(!archiveFiles.some((entry) => entry.startsWith('extension/')), 'extension zip must package files at the archive root');
check(!archiveFiles.some((entry) => entry.includes('node_modules')), 'extension zip must not include node_modules');
check(packageJson.scripts?.['extension:zip'] === 'node ./scripts/package/build-extension-zip.mjs', 'package scripts must expose extension:zip');
check(packageJson.scripts?.['check:extension-package'] === 'node ./scripts/package/check-extension-package.mjs', 'package scripts must expose check:extension-package');
check(packageJson.scripts?.check?.includes('npm run check:extension-package'), 'npm run check must include check:extension-package');
check(readmeText.includes('docs/INSTALL.md'), 'README must link the install guide');
check(readmeText.includes('docs/REGISTRY-SUBMISSIONS.md'), 'README must link the registry submission guide');
check(readmeText.includes('docs/PRIVACY-POLICY.md'), 'README must link the extension privacy policy');
check(readmeText.includes('docs/CHROME-WEB-STORE.md'), 'README must link the Chrome Web Store submission packet');
check(readmeText.includes('npm run extension:zip'), 'README must document the extension zip command');
check(extensionDocText.includes('npm run extension:zip'), 'docs/EXTENSION.md must document the extension zip command');
check(extensionDocText.includes('Chrome Web Store'), 'docs/EXTENSION.md must mention Chrome Web Store readiness');
check(extensionDocText.includes('CHROME-WEB-STORE.md'), 'docs/EXTENSION.md must link the Chrome Web Store submission packet');
check(publishingText.includes('npm run extension:zip'), 'docs/PUBLISHING.md must include extension zip packaging');
check(publishingText.includes('npm run check:extension-package'), 'docs/PUBLISHING.md must include extension package verification');
check(publishingText.includes('docs/CHROME-WEB-STORE.md'), 'docs/PUBLISHING.md must include the Chrome Web Store submission packet');
check(installText.includes('Claude Code') && installText.includes('Cursor') && installText.includes('Windsurf / Cascade'), 'docs/INSTALL.md must include client fast paths');
check(registryText.includes('GitHub topics') && registryText.includes('npm keywords'), 'docs/REGISTRY-SUBMISSIONS.md must include directory metadata guidance');
check(privacyPolicyText.includes('Chrome MCP Bridge') && privacyPolicyText.includes('loopback') && privacyPolicyText.includes('no analytics'), 'docs/PRIVACY-POLICY.md must describe local loopback behavior and no analytics');
check(storeListingText.includes('Chrome Web Store Submission Packet'), 'docs/CHROME-WEB-STORE.md must exist with a submission packet');
check(storeListingText.includes('Permission Justification') && storeListingText.includes('Data Use Answers'), 'Chrome Web Store packet must include permissions and data-use answers');

await fs.rm(tempDir, { recursive: true, force: true });

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  version: manifestJson.version,
  fileCount: archiveFiles.length,
  outputPathChecked: true,
}, null, 2)}\n`);
