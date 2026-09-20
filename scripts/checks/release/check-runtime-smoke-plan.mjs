#!/usr/bin/env node
import { createFakeNativeBridge } from '../lib/fake-native-bridge.mjs';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { BRIDGE_VERSION } from '../../../shared/command-registry.mjs';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = path.join(rootDir, 'bin/chrome-bridge.mjs');
const deadBridgeUrl = '/tmp/chrome-bridge-unavailable.sock';
const failures = [];

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

async function runCli(args, env = {}) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: rootDir,
      env: {
        ...process.env,
        ...env,
      },
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout || '',
      stderr: error?.stderr || '',
      error: String(error?.message || error),
    };
  }
}

async function withStaleHealthServer(fn) {
  const staleExtensionVersion = '0.0.0-stale-extension';
  const server = createFakeNativeBridge((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unexpected path' }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      bridge: {
        version: BRIDGE_VERSION,
      },
      extension: {
        connected: true,
        info: {
          version: staleExtensionVersion,
        },
      },
    }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { path: socketPath } = server.address();
    return await fn(socketPath, staleExtensionVersion);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withStaleBridgeHealthServer(fn) {
  const staleBridgeVersion = '0.0.0-stale-bridge';
  const server = createFakeNativeBridge((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unexpected path' }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      bridge: {
        version: staleBridgeVersion,
      },
      extension: {
        connected: true,
        info: {
          version: BRIDGE_VERSION,
        },
      },
    }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { path: socketPath } = server.address();
    return await fn(socketPath, staleBridgeVersion);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

let parsed;
try {
  const result = await runCli(['runtime-smoke', '--coverage-plan'], { CHROME_BRIDGE_SOCKET: deadBridgeUrl });
  if (!result.ok) throw new Error(result.error || result.stderr || 'coverage plan command failed');
  parsed = JSON.parse(result.stdout);
} catch (error) {
  fail(`runtime-smoke --coverage-plan failed with a dead bridge URL: ${String(error?.message || error)}`);
}

if (parsed) {
  check(parsed.ok === true, 'coverage plan command must succeed');
  check(parsed.mode === 'coverage-plan', 'coverage plan output must report mode=coverage-plan');
  check(parsed.liveBridge === false, 'coverage plan output must report liveBridge=false');
  check(parsed.finalVerificationComplete === false, 'coverage plan must not look like final live verification is complete');
  check(parsed.verification?.status === 'not-run', 'coverage plan verification status must be not-run');
  check(parsed.verification?.liveVerificationRequired === true, 'coverage plan must require final live verification');
  check(
    parsed.nextCommand === 'chrome-bridge reload-extension --confirm',
    'coverage plan nextCommand must point at the first live verification prep step',
  );
  check(
    parsed.nextAction?.includes('Reload the unpacked Chrome MCP Bridge extension'),
    'coverage plan top-level nextAction must explain the first live verification action',
  );
  check(
    parsed.verification?.nextCommand === 'chrome-bridge reload-extension --confirm',
    'coverage plan verification metadata must include the first live verification command',
  );
  check(
    parsed.verification?.nextAction?.includes('Reload the unpacked Chrome MCP Bridge extension'),
    'coverage plan verification metadata must include the first live verification action',
  );
  check(
    parsed.verification?.finalCommands?.includes('chrome-bridge reload-extension --confirm'),
    'coverage plan final commands must include confirmed extension reload before live smoke',
  );
  check(
    parsed.verification?.finalCommands?.includes('chrome-bridge doctor --live-checks'),
    'coverage plan final commands must include explicit live doctor check',
  );
  check(
    parsed.verification?.finalCommands?.includes('chrome-bridge runtime-smoke'),
    'coverage plan final commands must include live runtime-smoke',
  );
  check(
    parsed.verification?.finalMcpCalls?.some((call) => call?.tool === 'chrome_bridge_reload_extension' && call?.arguments?.confirmed === true),
    'coverage plan final MCP calls must include confirmed extension reload',
  );
  check(
    parsed.verification?.finalMcpCalls?.some((call) => call?.tool === 'chrome_bridge_doctor' && call?.arguments?.liveChecks === true),
    'coverage plan final MCP calls must include explicit live doctor check',
  );
  check(
    parsed.verification?.finalMcpCalls?.some((call) => call?.tool === 'chrome_bridge_runtime_smoke' && call?.arguments && Object.keys(call.arguments).length === 0),
    'coverage plan final MCP calls must include live runtime-smoke',
  );
  check(parsed.verification?.successCriteria?.ok === true, 'coverage plan success criteria must require top-level ok=true');
  check(parsed.verification?.successCriteria?.coverageOk === true, 'coverage plan success criteria must require coverage.ok=true');
  check(parsed.verification?.successCriteria?.bridgeVersion === BRIDGE_VERSION, 'coverage plan success criteria must require current bridge version');
  check(parsed.verification?.successCriteria?.extensionVersion === BRIDGE_VERSION, 'coverage plan success criteria must require current extension version');
  check(parsed.coverage?.ok === false, 'coverage plan coverage.ok must remain false until live smoke runs');
  check(parsed.coverage?.requiredCount > 0, 'coverage plan must include at least one required coverage item');
  check(parsed.coverage?.requiredCount === parsed.coverage?.missingCount, 'coverage plan must mark every required item missing before live smoke runs');
  check(Array.isArray(parsed.coverage?.required), 'coverage plan must include required coverage names');
  check(Array.isArray(parsed.coverage?.missing), 'coverage plan must include missing coverage names');
  check(parsed.coverage?.required?.length === parsed.coverage?.requiredCount, 'required coverage names must match requiredCount');
  check(parsed.coverage?.missing?.length === parsed.coverage?.missingCount, 'missing coverage names must match missingCount');
}

const summaryTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-runtime-smoke-summary-check-'));
try {
  const out = path.join(summaryTmpDir, 'runtime-smoke-full.json');
  const result = await runCli(['runtime-smoke', '--coverage-plan', '--summary-only', '--out', out], { CHROME_BRIDGE_SOCKET: deadBridgeUrl });
  let summaryParsed = null;
  try {
    summaryParsed = JSON.parse(result.stdout);
  } catch (error) {
    fail(`runtime-smoke --summary-only output was not JSON: ${String(error?.message || error)}`);
  }

  check(result.ok === true, 'runtime-smoke --summary-only coverage plan must succeed');
  check(summaryParsed?.summaryOnly === true, 'runtime-smoke --summary-only must mark summaryOnly=true');
  check(summaryParsed?.artifactPath === out, 'runtime-smoke --summary-only must expose the full JSON artifact path');
  check(!Object.prototype.hasOwnProperty.call(summaryParsed || {}, 'steps'), 'runtime-smoke --summary-only must omit step details from stdout');
  check(!Array.isArray(summaryParsed?.coverage?.required), 'runtime-smoke --summary-only must omit full required coverage names from stdout');
  check(!Array.isArray(summaryParsed?.coverage?.covered), 'runtime-smoke --summary-only must omit full covered coverage names from stdout');
  check(summaryParsed?.coverage?.requiredCount === parsed?.coverage?.requiredCount, 'runtime-smoke --summary-only must preserve required coverage count');
  check(JSON.stringify(summaryParsed || {}).length < 6_000, 'runtime-smoke --summary-only stdout JSON must stay token-budget friendly');

  const fullText = await fs.readFile(out, 'utf8').catch(() => null);
  check(Boolean(fullText), 'runtime-smoke --summary-only must write the full JSON artifact');
  const full = fullText ? JSON.parse(fullText) : null;
  check(Array.isArray(full?.coverage?.required), 'runtime-smoke --summary-only artifact must preserve full coverage details');
  check(full?.verification?.finalCommands?.includes('chrome-bridge runtime-smoke'), 'runtime-smoke --summary-only artifact must preserve full verification metadata');
} finally {
  await fs.rm(summaryTmpDir, { recursive: true, force: true });
}

let staleParsed;
let staleExtensionCliExitPreserved = false;
let staleExtensionStructuredOutput = false;
await withStaleHealthServer(async (socketPath, staleExtensionVersion) => {
  const result = await runCli(['runtime-smoke'], { CHROME_BRIDGE_SOCKET: socketPath });
  staleExtensionCliExitPreserved = result.ok === false;
  try {
    staleParsed = JSON.parse(result.stdout);
  } catch (error) {
    fail(`runtime-smoke stale-extension output was not JSON: ${String(error?.message || error)}`);
    return;
  }

  check(result.ok === false, 'stale-extension runtime smoke must exit nonzero');
  check(staleParsed.ok === false, 'stale-extension runtime smoke output must fail top-level ok');
  check(staleParsed.finalVerificationComplete === false, 'stale-extension runtime smoke must not look like final live verification is complete');
  check(staleParsed.skipped === true, 'stale-extension runtime smoke must be skipped before fixture work');
  check(staleParsed.extensionVersion === staleExtensionVersion, 'stale-extension runtime smoke must report observed extension version');
  check(staleParsed.verification?.status === 'skipped', 'stale-extension runtime smoke verification status must be skipped');
  check(staleParsed.verification?.liveVerificationRequired === true, 'stale-extension runtime smoke must still require final live verification');
  check(
    staleParsed.nextCommand === 'chrome-bridge reload-extension --confirm',
    'stale-extension top-level nextCommand must point at extension reload',
  );
  check(
    staleParsed.nextAction?.includes('Reload the unpacked Chrome MCP Bridge extension'),
    'stale-extension top-level nextAction must explain the reload action',
  );
  check(
    staleParsed.verification?.nextCommand === 'chrome-bridge reload-extension --confirm',
    'stale-extension verification metadata must point at extension reload as the next command',
  );
  check(
    staleParsed.verification?.nextAction?.includes('Reload the unpacked Chrome MCP Bridge extension'),
    'stale-extension verification metadata must explain the next reload action',
  );
  check(staleParsed.verification?.observed?.extensionVersion === staleExtensionVersion, 'stale-extension verification metadata must include observed extension version');
  check(
    staleParsed.verification?.finalCommands?.includes('chrome-bridge reload-extension --confirm')
      && staleParsed.verification?.finalCommands?.includes('chrome-bridge doctor --live-checks')
      && staleParsed.verification?.finalCommands?.includes('chrome-bridge runtime-smoke'),
    'stale-extension verification metadata must keep the final live command sequence',
  );
  check(
    staleParsed.verification?.finalMcpCalls?.some((call) => call?.tool === 'chrome_bridge_reload_extension' && call?.arguments?.confirmed === true)
      && staleParsed.verification?.finalMcpCalls?.some((call) => call?.tool === 'chrome_bridge_doctor' && call?.arguments?.liveChecks === true)
      && staleParsed.verification?.finalMcpCalls?.some((call) => call?.tool === 'chrome_bridge_runtime_smoke' && call?.arguments && Object.keys(call.arguments).length === 0),
    'stale-extension verification metadata must keep the final live MCP sequence',
  );
  staleExtensionStructuredOutput = !Object.prototype.hasOwnProperty.call(staleParsed, 'stdout');
  check(staleExtensionStructuredOutput, 'stale-extension runtime smoke must not fall back to raw stdout wrapping');
});

let staleBridgeParsed;
let staleBridgeCliExitPreserved = false;
let staleBridgeStructuredOutput = false;
await withStaleBridgeHealthServer(async (socketPath, staleBridgeVersion) => {
  const result = await runCli(['runtime-smoke'], { CHROME_BRIDGE_SOCKET: socketPath });
  staleBridgeCliExitPreserved = result.ok === false;
  try {
    staleBridgeParsed = JSON.parse(result.stdout);
  } catch (error) {
    fail(`runtime-smoke stale-bridge output was not JSON: ${String(error?.message || error)}`);
    return;
  }

  check(result.ok === false, 'stale-bridge runtime smoke must exit nonzero');
  check(staleBridgeParsed.ok === false, 'stale-bridge runtime smoke output must fail top-level ok');
  check(staleBridgeParsed.finalVerificationComplete === false, 'stale-bridge runtime smoke must not look like final live verification is complete');
  check(staleBridgeParsed.skipped === true, 'stale-bridge runtime smoke must be skipped before fixture work');
  check(staleBridgeParsed.bridgeVersion === staleBridgeVersion, 'stale-bridge runtime smoke must report observed bridge version');
  check(staleBridgeParsed.verification?.status === 'skipped', 'stale-bridge runtime smoke verification status must be skipped');
  check(staleBridgeParsed.verification?.liveVerificationRequired === true, 'stale-bridge runtime smoke must still require final live verification');
  check(
    staleBridgeParsed.nextCommand === 'chrome-bridge doctor --live-checks',
    'stale-bridge top-level nextCommand must point at live doctor after restart',
  );
  check(
    staleBridgeParsed.nextAction?.includes('Restart the Native Messaging Host'),
    'stale-bridge top-level nextAction must explain the bridge restart action',
  );
  check(
    staleBridgeParsed.verification?.nextCommand === 'chrome-bridge doctor --live-checks',
    'stale-bridge verification metadata must point at live doctor as the next command after restart',
  );
  check(
    staleBridgeParsed.verification?.nextAction?.includes('Restart the Native Messaging Host'),
    'stale-bridge verification metadata must explain the next bridge restart action',
  );
  check(staleBridgeParsed.verification?.observed?.bridgeVersion === staleBridgeVersion, 'stale-bridge verification metadata must include observed bridge version');
  check(
    staleBridgeParsed.verification?.finalCommands?.includes('chrome-bridge reload-extension --confirm')
      && staleBridgeParsed.verification?.finalCommands?.includes('chrome-bridge doctor --live-checks')
      && staleBridgeParsed.verification?.finalCommands?.includes('chrome-bridge runtime-smoke'),
    'stale-bridge verification metadata must keep the final live command sequence',
  );
  check(
    staleBridgeParsed.verification?.finalMcpCalls?.some((call) => call?.tool === 'chrome_bridge_reload_extension' && call?.arguments?.confirmed === true)
      && staleBridgeParsed.verification?.finalMcpCalls?.some((call) => call?.tool === 'chrome_bridge_doctor' && call?.arguments?.liveChecks === true)
      && staleBridgeParsed.verification?.finalMcpCalls?.some((call) => call?.tool === 'chrome_bridge_runtime_smoke' && call?.arguments && Object.keys(call.arguments).length === 0),
    'stale-bridge verification metadata must keep the final live MCP sequence',
  );
  staleBridgeStructuredOutput = !Object.prototype.hasOwnProperty.call(staleBridgeParsed, 'stdout');
  check(staleBridgeStructuredOutput, 'stale-bridge runtime smoke must not fall back to raw stdout wrapping');
});

if (failures.length) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  mode: parsed.mode,
  liveBridge: parsed.liveBridge,
  verificationStatus: parsed.verification.status,
  finalVerificationComplete: parsed.finalVerificationComplete,
  liveVerificationRequired: parsed.verification.liveVerificationRequired,
  successCriteriaBridgeVersion: parsed.verification.successCriteria.bridgeVersion,
  successCriteriaExtensionVersion: parsed.verification.successCriteria.extensionVersion,
  requiredCount: parsed.coverage.requiredCount,
  staleExtensionStatus: staleParsed?.verification?.status,
  staleBridgeStatus: staleBridgeParsed?.verification?.status,
  coveragePlanVerificationNextCommand: parsed.verification?.nextCommand,
  coveragePlanTopLevelNextAction: parsed.nextAction,
  staleExtensionTopLevelNextCommand: staleParsed?.nextCommand,
  staleBridgeTopLevelNextCommand: staleBridgeParsed?.nextCommand,
  staleExtensionNextCommand: staleParsed?.verification?.nextCommand,
  staleBridgeNextCommand: staleBridgeParsed?.verification?.nextCommand,
  staleExtensionFinalCommandCount: staleParsed?.verification?.finalCommands?.length || 0,
  staleBridgeFinalCommandCount: staleBridgeParsed?.verification?.finalCommands?.length || 0,
  staleExtensionFinalMcpCallCount: staleParsed?.verification?.finalMcpCalls?.length || 0,
  staleBridgeFinalMcpCallCount: staleBridgeParsed?.verification?.finalMcpCalls?.length || 0,
  staleExtensionCliExitPreserved,
  staleBridgeCliExitPreserved,
  staleExtensionStructuredOutput,
  staleBridgeStructuredOutput,
}, null, 2)}\n`);
