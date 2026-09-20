#!/usr/bin/env node
import { createFakeNativeBridge } from '../lib/fake-native-bridge.mjs';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  BRIDGE_VERSION,
  CLI_COMMANDS,
  COMMAND_PAYLOAD_SCHEMAS,
  MCP_TOOLS,
  validateCommandPayload,
} from '../../../shared/command-registry.mjs';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = path.join(rootDir, 'bin/chrome-bridge.mjs');
const failures = [];

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

async function runCli(args, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: rootDir,
      env: {
        ...process.env,
        CHROME_BRIDGE_SOCKET: '/tmp/chrome-bridge-unavailable.sock',
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

async function withFakeLiveDoctor(fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-doctor-check-'));
  const fakeBinDir = path.join(tmpDir, 'bin');
  await fs.mkdir(fakeBinDir);
  const fakeOsascript = path.join(fakeBinDir, 'osascript');
  await fs.writeFile(fakeOsascript, '#!/bin/sh\nprintf "Codex Bridge Fake Chrome Title\\n"\n');
  await fs.chmod(fakeOsascript, 0o755);

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
    return await fn({
      socketPath: socketPath,
      pathEnv: `${fakeBinDir}${path.delimiter}${process.env.PATH || ''}`,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function withFakeStaleSummaryBridge(fn) {
  const staleBridgeVersion = '0.0.0-stale-summary';
  const server = createFakeNativeBridge((req, res) => {
    if (req.url === '/health') {
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
      return;
    }

    if (req.url === '/command') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        code: 'EXTENSION_NOT_CONNECTED',
        error: 'fake summary bridge has no extension command transport',
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unexpected path' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { path: socketPath } = server.address();
    return await fn({
      socketPath: socketPath,
      staleBridgeVersion,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withFakeCommandBridge(fn) {
  const receivedCommands = [];
  const invalidPayloadRequests = [];
  const server = createFakeNativeBridge(async (req, res) => {
    if (req.url !== '/command' || req.method !== 'POST') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unexpected path' }));
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
      return;
    }

    const { profileId: _profileId, ...validationPayload } = parsed.payload || {};
    try {
      validateCommandPayload(parsed.action, validationPayload);
    } catch (error) {
      invalidPayloadRequests.push(parsed);
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        code: 'INVALID_PAYLOAD',
        error: String(error?.message || error),
      }));
      return;
    }

    receivedCommands.push(parsed);
    const resultPayload = {
      action: parsed.action,
      payload: parsed.payload,
      timeoutMs: parsed.timeoutMs,
    };
    if (parsed.action === 'printPdf') {
      resultPayload.dataUrl = 'data:application/pdf;base64,JVBERi0xLjQKJQ==';
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      result: resultPayload,
    }));
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
      invalidPayloadRequests,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout || '{}');
  } catch (error) {
    fail(`${label} did not return JSON: ${String(error?.message || error)}`);
    return null;
  }
}

const doctorResult = await runCli(['doctor']);
check(doctorResult.ok, 'CLI doctor must succeed offline');
const doctorJson = parseJsonOutput(doctorResult, 'CLI doctor');
if (doctorJson) {
  check(doctorJson.liveChecks === false, 'CLI doctor must keep liveChecks=false by default');
  check(doctorJson.health?.skipped === true, 'CLI doctor default call must skip bridge health');
  check(doctorJson.health?.ok === null, 'CLI doctor default call must not contact bridge health');
  check(doctorJson.mcpProfiles?.cursor === 'core', 'CLI doctor must recommend the core MCP profile for Cursor');
  check(doctorJson.mcpProfiles?.generic === 'read', 'CLI doctor must recommend the read MCP profile for generic clients');
  check(Array.isArray(doctorJson.nextActions), 'CLI doctor must return setup nextActions');
  check(doctorJson.nextActions.some((action) => action.includes('runtime-smoke --coverage-plan')), 'CLI doctor offline nextActions must recommend coverage-plan');
  check(doctorJson.nextActions.some((action) => action.includes('advise --task')), 'CLI doctor offline nextActions must recommend the advisor flow');
  check(doctorJson.nextActions.some((action) => action.includes('mcp-config --client')), 'CLI doctor offline nextActions must recommend client config snippets');
}

let liveDoctorBridgeCurrent = null;
await withFakeLiveDoctor(async ({ socketPath, pathEnv }) => {
  const liveDoctorResult = await runCli(['doctor', '--live-checks'], {
    CHROME_BRIDGE_SOCKET: socketPath,
    PATH: pathEnv,
  });
  check(liveDoctorResult.ok, 'CLI doctor --live-checks must succeed against fake health and fake osascript');
  const liveDoctorJson = parseJsonOutput(liveDoctorResult, 'CLI doctor live checks');
  if (!liveDoctorJson) return;

  check(liveDoctorJson.liveChecks === true, 'CLI doctor live check fixture must report liveChecks=true');
  check(liveDoctorJson.health?.ok === true, 'CLI doctor live check fixture must read fake health');
  check(liveDoctorJson.checks?.expectedBridgeVersion === BRIDGE_VERSION, 'CLI doctor live checks must report expected bridge version');
  check(liveDoctorJson.checks?.bridgeVersion === BRIDGE_VERSION, 'CLI doctor live checks must report observed bridge version');
  check(liveDoctorJson.checks?.bridgeCurrent === true, 'CLI doctor live checks must confirm bridge version is current');
  liveDoctorBridgeCurrent = liveDoctorJson.checks?.bridgeCurrent;
});

let sessionSummaryStaleBridgeRecommendation = false;
await withFakeStaleSummaryBridge(async ({ socketPath, staleBridgeVersion }) => {
  const summaryResult = await runCli(['session-summary'], {
    CHROME_BRIDGE_SOCKET: socketPath,
  });
  check(summaryResult.ok, 'CLI session-summary must succeed against fake stale bridge health');
  const summaryJson = parseJsonOutput(summaryResult, 'CLI session-summary stale bridge');
  if (!summaryJson) return;

  sessionSummaryStaleBridgeRecommendation = summaryJson.recommendations?.some((recommendation) => (
    recommendation.includes('Restart the Native Messaging Host')
      && recommendation.includes(staleBridgeVersion)
  ));
  check(sessionSummaryStaleBridgeRecommendation, 'CLI session-summary must recommend restarting stale Native Messaging Host');
  check(summaryJson.nextActions?.some((action) => action.includes('doctor --live-checks')), 'CLI session-summary must include a concrete stale-bridge next action');
});

let groupScopePayloadChecks = 0;
let inventoryIncludeAllChecks = 0;
let privateSensitiveChecks = 0;
let unsafeUrlMethodChecks = 0;
let selectTargetChecks = 0;
let selectIndexChecks = 0;
let tabIdChecks = 0;
let clickAtCoordinateChecks = 0;
let hoverCoordinateChecks = 0;
let traceMaxEventsChecks = 0;
let privateLimitChecks = 0;
let readLimitChecks = 0;
let utilityNumberChecks = 0;
let profileRoutingChecks = 0;
await withFakeCommandBridge(async ({ socketPath, receivedCommands, invalidPayloadRequests }) => {
  const beforeProfileRoute = receivedCommands.length;
  const profileRouteResult = await runCli(['tabs'], {
    CHROME_BRIDGE_SOCKET: socketPath,
    CHROME_BRIDGE_PROFILE_ID: 'profile-cli-check',
  });
  check(profileRouteResult.ok, 'CLI must succeed when CHROME_BRIDGE_PROFILE_ID is configured');
  const profileRouteParsed = parseJsonOutput(profileRouteResult, 'CLI CHROME_BRIDGE_PROFILE_ID fake command bridge');
  const profileRoutePayload = receivedCommands[beforeProfileRoute]?.payload || profileRouteParsed?.payload;
  check(receivedCommands[beforeProfileRoute]?.action === 'tabs', 'CLI profile routing check must dispatch tabs');
  check(profileRoutePayload?.profileId === 'profile-cli-check', 'CLI must forward CHROME_BRIDGE_PROFILE_ID as payload.profileId');
  profileRoutingChecks += 1;

  const includeAllCases = [
    { action: 'tabs', args: ['tabs', '--all'], confirmedArgs: ['tabs', '--all', '--confirm'] },
    { action: 'windows', args: ['windows', '--all'], confirmedArgs: ['windows', '--all', '--confirm'] },
  ];

  for (const testCase of includeAllCases) {
    const beforeReject = receivedCommands.length;
    const rejected = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(!rejected.ok, `CLI ${testCase.args[0]} --all must fail without --confirm`);
    check(
      `${rejected.stderr}\n${rejected.stdout}\n${rejected.error}`.includes(`${testCase.args[0]} --all requires --confirm`),
      `CLI ${testCase.args[0]} --all rejection must explain --confirm`,
    );
    check(receivedCommands.length === beforeReject, `CLI ${testCase.args[0]} --all without confirm must not contact the bridge`);
    inventoryIncludeAllChecks += 1;

    const beforeAccept = receivedCommands.length;
    const accepted = await runCli(testCase.confirmedArgs, { CHROME_BRIDGE_SOCKET: socketPath });
    check(accepted.ok, `CLI ${testCase.args[0]} --all --confirm must succeed against fake command bridge`);
    const parsed = parseJsonOutput(accepted, `CLI ${testCase.args[0]} --all --confirm fake command bridge`);
    const commandPayload = receivedCommands[beforeAccept]?.payload || parsed?.payload;
    check(receivedCommands[beforeAccept]?.action === testCase.action, `CLI ${testCase.args[0]} --all --confirm must dispatch ${testCase.action}`);
    check(commandPayload?.includeAll === true, `CLI ${testCase.args[0]} --all --confirm must forward includeAll`);
    check(commandPayload?.confirmed === true, `CLI ${testCase.args[0]} --all --confirm must forward confirmed`);
    inventoryIncludeAllChecks += 1;
  }

  const sensitiveCases = [
    {
      action: 'cookiesList',
      command: 'cookies',
      args: ['cookies', '--confirm'],
      confirmedArgs: ['cookies', '--confirm', '--confirm-sensitive'],
      expectedPayload: { confirmSensitive: true },
    },
    {
      action: 'storageSnapshot',
      command: 'storage',
      args: ['storage', '--include-values', '--confirm'],
      confirmedArgs: ['storage', '--include-values', '--confirm', '--confirm-sensitive'],
      expectedPayload: { includeValues: true, confirmSensitive: true },
    },
    {
      action: 'fetchUrl',
      command: 'request',
      args: ['request', 'https://example.com', '--credentials', 'include', '--confirm'],
      confirmedArgs: ['request', 'https://example.com', '--credentials', 'include', '--confirm', '--confirm-sensitive'],
      expectedPayload: { url: 'https://example.com', credentials: 'include', confirmSensitive: true },
    },
  ];

  for (const testCase of sensitiveCases) {
    const beforeReject = receivedCommands.length;
    const rejected = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(!rejected.ok, `CLI ${testCase.command} private-sensitive request must fail without --confirm-sensitive`);
    check(
      `${rejected.stderr}\n${rejected.stdout}\n${rejected.error}`.includes('confirmSensitive=true'),
      `CLI ${testCase.command} private-sensitive rejection must explain confirmSensitive=true`,
    );
    check(receivedCommands.length === beforeReject, `CLI ${testCase.command} private-sensitive request without confirmSensitive must not be accepted`);
    privateSensitiveChecks += 1;

    const beforeAccept = receivedCommands.length;
    const accepted = await runCli(testCase.confirmedArgs, { CHROME_BRIDGE_SOCKET: socketPath });
    check(accepted.ok, `CLI ${testCase.command} --confirm-sensitive must succeed against fake command bridge`);
    const parsed = parseJsonOutput(accepted, `CLI ${testCase.command} --confirm-sensitive fake command bridge`);
    const commandPayload = receivedCommands[beforeAccept]?.payload || parsed?.payload;
    check(receivedCommands[beforeAccept]?.action === testCase.action, `CLI ${testCase.command} --confirm-sensitive must dispatch ${testCase.action}`);
    for (const [key, value] of Object.entries(testCase.expectedPayload)) {
      check(commandPayload?.[key] === value, `CLI ${testCase.command} --confirm-sensitive must forward ${key}`);
    }
    check(commandPayload?.confirmed === true, `CLI ${testCase.command} --confirm-sensitive must forward confirmed`);
    privateSensitiveChecks += 1;
  }

  const unsafeCases = [
    {
      command: 'open',
      args: ['open', 'javascript:alert(1)'],
      expected: 'URL protocol',
    },
    {
      command: 'request',
      args: ['request', 'file:///etc/passwd', '--confirm'],
      expected: 'URL protocol',
    },
    {
      command: 'request',
      args: ['request', 'https://example.com', '--method', 'TRACE', '--confirm'],
      expected: '--method must be one of',
    },
  ];

  for (const testCase of unsafeCases) {
    const beforeReject = receivedCommands.length;
    const rejected = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(!rejected.ok, `CLI ${testCase.command} unsafe URL/method case must fail`);
    check(
      `${rejected.stderr}\n${rejected.stdout}\n${rejected.error}`.includes(testCase.expected),
      `CLI ${testCase.command} unsafe URL/method rejection must mention ${testCase.expected}`,
    );
    check(receivedCommands.length === beforeReject, `CLI ${testCase.command} unsafe URL/method case must not be accepted`);
    unsafeUrlMethodChecks += 1;
  }

  check(COMMAND_PAYLOAD_SCHEMAS.select?.includes('index'), 'select schema must allow index before CLI behavior checks');
  const beforeMissingSelectTarget = receivedCommands.length;
  const beforeMissingSelectTargetRejects = invalidPayloadRequests.length;
  const missingSelectTarget = await runCli(['select', '--selector', '#country', '--confirm'], { CHROME_BRIDGE_SOCKET: socketPath });
  check(!missingSelectTarget.ok, 'CLI select without value, label, or index must fail');
  check(
    `${missingSelectTarget.stderr}\n${missingSelectTarget.stdout}\n${missingSelectTarget.error}`.includes('select requires value, label, or index'),
    'CLI select missing target rejection must explain value, label, or index',
  );
  check(
    receivedCommands.length === beforeMissingSelectTarget,
    'CLI select missing target must not be accepted by fake command bridge',
  );
  check(
    invalidPayloadRequests.length === beforeMissingSelectTargetRejects,
    'CLI select missing target must fail fast before contacting fake command bridge',
  );
  selectTargetChecks += 1;

  for (const invalidIndex of ['nope', '-1']) {
    const beforeInvalidSelectIndex = receivedCommands.length;
    const beforeInvalidSelectIndexRejects = invalidPayloadRequests.length;
    const rejected = await runCli(['select', '--selector', '#country', '--index', invalidIndex, '--confirm'], { CHROME_BRIDGE_SOCKET: socketPath });
    check(!rejected.ok, `CLI select --index ${invalidIndex} must fail`);
    check(
      `${rejected.stderr}\n${rejected.stdout}\n${rejected.error}`.includes('--index must be a non-negative integer'),
      `CLI select --index ${invalidIndex} rejection must explain non-negative integer`,
    );
    check(receivedCommands.length === beforeInvalidSelectIndex, `CLI select --index ${invalidIndex} must not be accepted by fake command bridge`);
    check(
      invalidPayloadRequests.length === beforeInvalidSelectIndexRejects,
      `CLI select --index ${invalidIndex} must fail fast before contacting fake command bridge`,
    );
    selectIndexChecks += 1;
  }

  const beforeSelectIndex = receivedCommands.length;
  const selectIndex = await runCli(['select', '--selector', '#country', '--index', '0', '--confirm'], { CHROME_BRIDGE_SOCKET: socketPath });
  check(selectIndex.ok, 'CLI select with index 0 must succeed against fake command bridge');
  const selectIndexParsed = parseJsonOutput(selectIndex, 'CLI select index 0 fake command bridge');
  const selectIndexPayload = receivedCommands[beforeSelectIndex]?.payload || selectIndexParsed?.payload;
  check(receivedCommands[beforeSelectIndex]?.action === 'select', 'CLI select with index 0 must dispatch select');
  check(selectIndexPayload?.selector === '#country', 'CLI select with index 0 must forward selector');
  check(selectIndexPayload?.index === 0, 'CLI select with index 0 must forward numeric index 0');
  check(selectIndexPayload?.confirmed === true, 'CLI select with index 0 must forward confirmed');
  selectIndexChecks += 1;

  for (const invalidTab of ['nope', '-1']) {
    const beforeInvalidTab = receivedCommands.length;
    const beforeInvalidTabRejects = invalidPayloadRequests.length;
    const rejected = await runCli(['snapshot', '--tab', invalidTab], { CHROME_BRIDGE_SOCKET: socketPath });
    check(!rejected.ok, `CLI snapshot --tab ${invalidTab} must fail`);
    check(
      `${rejected.stderr}\n${rejected.stdout}\n${rejected.error}`.includes('--tab must be a non-negative integer'),
      `CLI snapshot --tab ${invalidTab} rejection must explain non-negative integer`,
    );
    check(receivedCommands.length === beforeInvalidTab, `CLI snapshot --tab ${invalidTab} must not be accepted by fake command bridge`);
    check(
      invalidPayloadRequests.length === beforeInvalidTabRejects,
      `CLI snapshot --tab ${invalidTab} must fail fast before contacting fake command bridge`,
    );
    tabIdChecks += 1;
  }

  const beforeZeroTab = receivedCommands.length;
  const zeroTab = await runCli(['snapshot', '--tab', '0'], { CHROME_BRIDGE_SOCKET: socketPath });
  check(zeroTab.ok, 'CLI snapshot --tab 0 must succeed against fake command bridge');
  const zeroTabParsed = parseJsonOutput(zeroTab, 'CLI snapshot --tab 0 fake command bridge');
  const zeroTabPayload = receivedCommands[beforeZeroTab]?.payload || zeroTabParsed?.payload;
  check(receivedCommands[beforeZeroTab]?.action === 'snapshot', 'CLI snapshot --tab 0 must dispatch snapshot');
  check(zeroTabPayload?.tabId === 0, 'CLI snapshot --tab 0 must forward numeric tabId 0');
  tabIdChecks += 1;

  const clickAtInvalidCases = [
    { label: 'missing x', args: ['click-at', '--y', '5', '--confirm'] },
    { label: 'missing y', args: ['click-at', '--x', '5', '--confirm'] },
    { label: 'invalid x', args: ['click-at', '--x', 'nope', '--y', '5', '--confirm'] },
    { label: 'invalid y', args: ['click-at', '--x', '5', '--y', 'nope', '--confirm'] },
  ];
  for (const testCase of clickAtInvalidCases) {
    const beforeInvalidClickAt = receivedCommands.length;
    const beforeInvalidClickAtRejects = invalidPayloadRequests.length;
    const rejected = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(!rejected.ok, `CLI click-at ${testCase.label} must fail`);
    check(
      `${rejected.stderr}\n${rejected.stdout}\n${rejected.error}`.includes('click-at requires numeric --x and --y'),
      `CLI click-at ${testCase.label} rejection must explain numeric --x and --y`,
    );
    check(receivedCommands.length === beforeInvalidClickAt, `CLI click-at ${testCase.label} must not be accepted by fake command bridge`);
    check(
      invalidPayloadRequests.length === beforeInvalidClickAtRejects,
      `CLI click-at ${testCase.label} must fail fast before contacting fake command bridge`,
    );
    clickAtCoordinateChecks += 1;
  }

  const beforeClickAtZero = receivedCommands.length;
  const clickAtZero = await runCli(['click-at', '--x', '0', '--y', '0', '--confirm'], { CHROME_BRIDGE_SOCKET: socketPath });
  check(clickAtZero.ok, 'CLI click-at 0,0 must succeed against fake command bridge');
  const clickAtZeroParsed = parseJsonOutput(clickAtZero, 'CLI click-at 0,0 fake command bridge');
  const clickAtZeroPayload = receivedCommands[beforeClickAtZero]?.payload || clickAtZeroParsed?.payload;
  check(receivedCommands[beforeClickAtZero]?.action === 'clickAt', 'CLI click-at 0,0 must dispatch clickAt');
  check(clickAtZeroPayload?.x === 0, 'CLI click-at 0,0 must forward numeric x 0');
  check(clickAtZeroPayload?.y === 0, 'CLI click-at 0,0 must forward numeric y 0');
  check(clickAtZeroPayload?.confirmed === true, 'CLI click-at 0,0 must forward confirmed');
  clickAtCoordinateChecks += 1;

  const hoverInvalidCases = [
    { label: 'missing target', args: ['hover'] },
    { label: 'missing y', args: ['hover', '--x', '5'] },
    { label: 'invalid x', args: ['hover', '--x', 'nope', '--y', '5'] },
    { label: 'trusted missing x', args: ['hover', '--selector', '#action', '--trusted'] },
    { label: 'trusted invalid y', args: ['hover', '--x', '5', '--y', 'nope', '--trusted'] },
  ];
  for (const testCase of hoverInvalidCases) {
    const beforeInvalidHover = receivedCommands.length;
    const beforeInvalidHoverRejects = invalidPayloadRequests.length;
    const rejected = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(!rejected.ok, `CLI hover ${testCase.label} must fail`);
    check(
      `${rejected.stderr}\n${rejected.stdout}\n${rejected.error}`.includes('hover requires --selector or numeric --x and --y'),
      `CLI hover ${testCase.label} rejection must explain selector or numeric --x and --y`,
    );
    check(receivedCommands.length === beforeInvalidHover, `CLI hover ${testCase.label} must not be accepted by fake command bridge`);
    check(
      invalidPayloadRequests.length === beforeInvalidHoverRejects,
      `CLI hover ${testCase.label} must fail fast before contacting fake command bridge`,
    );
    hoverCoordinateChecks += 1;
  }

  const beforeHoverSelector = receivedCommands.length;
  const hoverSelector = await runCli(['hover', '--selector', '#action'], { CHROME_BRIDGE_SOCKET: socketPath });
  check(hoverSelector.ok, 'CLI hover selector must succeed against fake command bridge');
  const hoverSelectorParsed = parseJsonOutput(hoverSelector, 'CLI hover selector fake command bridge');
  const hoverSelectorPayload = receivedCommands[beforeHoverSelector]?.payload || hoverSelectorParsed?.payload;
  check(receivedCommands[beforeHoverSelector]?.action === 'hover', 'CLI hover selector must dispatch hover');
  check(hoverSelectorPayload?.selector === '#action', 'CLI hover selector must forward selector');
  check(hoverSelectorPayload?.trusted === false, 'CLI hover selector must forward trusted=false');
  hoverCoordinateChecks += 1;

  const beforeHoverTrustedZero = receivedCommands.length;
  const hoverTrustedZero = await runCli(['hover', '--x', '0', '--y', '0', '--trusted'], { CHROME_BRIDGE_SOCKET: socketPath });
  check(hoverTrustedZero.ok, 'CLI hover trusted 0,0 must succeed against fake command bridge');
  const hoverTrustedZeroParsed = parseJsonOutput(hoverTrustedZero, 'CLI hover trusted 0,0 fake command bridge');
  const hoverTrustedZeroPayload = receivedCommands[beforeHoverTrustedZero]?.payload || hoverTrustedZeroParsed?.payload;
  check(receivedCommands[beforeHoverTrustedZero]?.action === 'hover', 'CLI hover trusted 0,0 must dispatch hover');
  check(hoverTrustedZeroPayload?.x === 0, 'CLI hover trusted 0,0 must forward numeric x 0');
  check(hoverTrustedZeroPayload?.y === 0, 'CLI hover trusted 0,0 must forward numeric y 0');
  check(hoverTrustedZeroPayload?.trusted === true, 'CLI hover trusted 0,0 must forward trusted=true');
  hoverCoordinateChecks += 1;

  const traceMaxEventsInvalidCases = [
    { label: 'invalid max-events', args: ['trace-start', '--max-events', 'nope', '--confirm'] },
    { label: 'too small max-events', args: ['trace-start', '--max-events', '49', '--confirm'] },
    { label: 'too large max-events', args: ['trace-start', '--max-events', '2001', '--confirm'] },
  ];
  for (const testCase of traceMaxEventsInvalidCases) {
    const beforeInvalidTrace = receivedCommands.length;
    const beforeInvalidTraceRejects = invalidPayloadRequests.length;
    const rejected = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(!rejected.ok, `CLI trace-start ${testCase.label} must fail`);
    check(
      `${rejected.stderr}\n${rejected.stdout}\n${rejected.error}`.includes('--max-events must be between 50 and 2000'),
      `CLI trace-start ${testCase.label} rejection must explain max-events bounds`,
    );
    check(receivedCommands.length === beforeInvalidTrace, `CLI trace-start ${testCase.label} must not be accepted by fake command bridge`);
    check(
      invalidPayloadRequests.length === beforeInvalidTraceRejects,
      `CLI trace-start ${testCase.label} must fail fast before contacting fake command bridge`,
    );
    traceMaxEventsChecks += 1;
  }

  const beforeTraceMaxEventsMin = receivedCommands.length;
  const traceMaxEventsMin = await runCli(['trace-start', '--max-events', '50', '--confirm'], { CHROME_BRIDGE_SOCKET: socketPath });
  check(traceMaxEventsMin.ok, 'CLI trace-start --max-events 50 must succeed against fake command bridge');
  const traceMaxEventsMinParsed = parseJsonOutput(traceMaxEventsMin, 'CLI trace-start max-events 50 fake command bridge');
  const traceMaxEventsMinPayload = receivedCommands[beforeTraceMaxEventsMin]?.payload || traceMaxEventsMinParsed?.payload;
  check(receivedCommands[beforeTraceMaxEventsMin]?.action === 'traceStart', 'CLI trace-start --max-events 50 must dispatch traceStart');
  check(traceMaxEventsMinPayload?.maxEvents === 50, 'CLI trace-start --max-events 50 must forward numeric maxEvents 50');
  check(traceMaxEventsMinPayload?.confirmed === true, 'CLI trace-start --max-events 50 must forward confirmed');
  traceMaxEventsChecks += 1;

  const privateLimitInvalidCases = [
    {
      label: 'history invalid limit',
      args: ['history', '--limit', 'nope', '--confirm'],
      message: '--limit must be between 1 and 200',
    },
    {
      label: 'history too small limit',
      args: ['history', '--limit', '0', '--confirm'],
      message: '--limit must be between 1 and 200',
    },
    {
      label: 'history negative start-time',
      args: ['history', '--start-time', '-1', '--confirm'],
      message: '--start-time must be between 0 and 9007199254740991',
    },
    {
      label: 'history negative end-time',
      args: ['history', '--end-time', '-1', '--confirm'],
      message: '--end-time must be between 0 and 9007199254740991',
    },
    {
      label: 'bookmarks too large limit',
      args: ['bookmarks', '--limit', '201', '--confirm'],
      message: '--limit must be between 1 and 200',
    },
    {
      label: 'cookies too large limit',
      args: ['cookies', '--url', 'https://example.com', '--limit', '501', '--confirm'],
      message: '--limit must be between 1 and 500',
    },
  ];
  for (const testCase of privateLimitInvalidCases) {
    const beforeInvalidLimit = receivedCommands.length;
    const beforeInvalidLimitRejects = invalidPayloadRequests.length;
    const rejected = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(!rejected.ok, `CLI ${testCase.label} must fail`);
    check(
      `${rejected.stderr}\n${rejected.stdout}\n${rejected.error}`.includes(testCase.message),
      `CLI ${testCase.label} rejection must explain limit bounds`,
    );
    check(receivedCommands.length === beforeInvalidLimit, `CLI ${testCase.label} must not be accepted by fake command bridge`);
    check(
      invalidPayloadRequests.length === beforeInvalidLimitRejects,
      `CLI ${testCase.label} must fail fast before contacting fake command bridge`,
    );
    privateLimitChecks += 1;
  }

  const privateLimitValidCases = [
    {
      label: 'history min limit',
      action: 'historySearch',
      args: ['history', '--limit', '1', '--confirm'],
      expectedLimit: 1,
    },
    {
      label: 'history time filter',
      action: 'historySearch',
      args: ['history', '--start-time', '0', '--end-time', '1', '--confirm'],
      expectedLimit: undefined,
      expectedPayload: { startTime: 0, endTime: 1 },
    },
    {
      label: 'bookmarks min limit',
      action: 'bookmarksSearch',
      args: ['bookmarks', '--limit', '1', '--confirm'],
      expectedLimit: 1,
    },
    {
      label: 'cookies min limit',
      action: 'cookiesList',
      args: ['cookies', '--url', 'https://example.com', '--limit', '1', '--confirm'],
      expectedLimit: 1,
    },
  ];
  for (const testCase of privateLimitValidCases) {
    const beforeValidLimit = receivedCommands.length;
    const accepted = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(accepted.ok, `CLI ${testCase.label} must succeed against fake command bridge`);
    const parsed = parseJsonOutput(accepted, `CLI ${testCase.label} fake command bridge`);
    const commandPayload = receivedCommands[beforeValidLimit]?.payload || parsed?.payload;
    check(receivedCommands[beforeValidLimit]?.action === testCase.action, `CLI ${testCase.label} must dispatch ${testCase.action}`);
    if (testCase.expectedLimit !== undefined) {
      check(commandPayload?.limit === testCase.expectedLimit, `CLI ${testCase.label} must forward numeric limit`);
    }
    for (const [key, value] of Object.entries(testCase.expectedPayload || {})) {
      check(commandPayload?.[key] === value, `CLI ${testCase.label} must forward ${key}`);
    }
    check(commandPayload?.confirmed === true, `CLI ${testCase.label} must forward confirmed`);
    privateLimitChecks += 1;
  }

  const readLimitInvalidCases = [
    {
      label: 'observe too small limit',
      args: ['observe', '--limit', '0'],
      message: '--limit must be between 1 and 300',
    },
    {
      label: 'observe too small max-text-chars',
      args: ['observe', '--max-text-chars', '19'],
      message: '--max-text-chars must be between 20 and 1000',
    },
    {
      label: 'find-elements too large limit',
      args: ['find-elements', '--limit', '301'],
      message: '--limit must be between 1 and 300',
    },
    {
      label: 'find-elements invalid max-text-chars',
      args: ['find-elements', '--max-text-chars', 'nope'],
      message: '--max-text-chars must be between 20 and 1000',
    },
    {
      label: 'extract too large max-items',
      args: ['extract', '--max-items', '501'],
      message: '--max-items must be between 1 and 500',
    },
    {
      label: 'extract too small max-text-chars',
      args: ['extract', '--max-text-chars', '49'],
      message: '--max-text-chars must be between 50 and 2000',
    },
    {
      label: 'snapshot too small max-chars',
      args: ['snapshot', '--max-chars', '999'],
      message: '--max-chars must be between 1000 and 200000',
    },
    {
      label: 'text invalid max-chars',
      args: ['text', '--max-chars', 'nope'],
      message: '--max-chars must be between 1000 and 200000',
    },
    {
      label: 'html too large max-chars',
      args: ['html', '--max-chars', '500001'],
      message: '--max-chars must be between 1000 and 500000',
    },
    {
      label: 'pdf too large scale',
      args: ['pdf', '--out', path.join(os.tmpdir(), 'chrome-bridge-read-limit.pdf'), '--scale', '2.1'],
      message: '--scale must be between 0.1 and 2',
    },
    {
      label: 'trace-events too small limit',
      args: ['trace-events', '--limit', '0'],
      message: '--limit must be between 1 and 2000',
    },
    {
      label: 'trace-stop invalid limit',
      args: ['trace-stop', '--limit', 'nope'],
      message: '--limit must be between 1 and 2000',
    },
  ];
  for (const testCase of readLimitInvalidCases) {
    const beforeInvalidReadLimit = receivedCommands.length;
    const beforeInvalidReadLimitRejects = invalidPayloadRequests.length;
    const rejected = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(!rejected.ok, `CLI ${testCase.label} must fail`);
    check(
      `${rejected.stderr}\n${rejected.stdout}\n${rejected.error}`.includes(testCase.message),
      `CLI ${testCase.label} rejection must explain numeric bounds`,
    );
    check(receivedCommands.length === beforeInvalidReadLimit, `CLI ${testCase.label} must not be accepted by fake command bridge`);
    check(
      invalidPayloadRequests.length === beforeInvalidReadLimitRejects,
      `CLI ${testCase.label} must fail fast before contacting fake command bridge`,
    );
    readLimitChecks += 1;
  }

  const readLimitValidCases = [
    {
      label: 'observe min bounds',
      action: 'observe',
      args: ['observe', '--limit', '1', '--max-text-chars', '20'],
      expectedPayload: { limit: 1, maxTextChars: 20 },
    },
    {
      label: 'find-elements min bounds',
      action: 'findElements',
      args: ['find-elements', '--limit', '1', '--max-text-chars', '20'],
      expectedPayload: { limit: 1, maxTextChars: 20 },
    },
    {
      label: 'extract min bounds',
      action: 'extractPage',
      args: ['extract', '--max-items', '1', '--max-text-chars', '50'],
      expectedPayload: { maxItems: 1, maxTextChars: 50 },
    },
    {
      label: 'snapshot min bounds',
      action: 'snapshot',
      args: ['snapshot', '--max-chars', '1000'],
      expectedPayload: { maxChars: 1000 },
    },
    {
      label: 'text min bounds',
      action: 'text',
      args: ['text', '--max-chars', '1000'],
      expectedPayload: { maxChars: 1000 },
    },
    {
      label: 'html min bounds',
      action: 'html',
      args: ['html', '--max-chars', '1000'],
      expectedPayload: { maxChars: 1000 },
    },
    {
      label: 'pdf min scale',
      action: 'printPdf',
      args: ['pdf', '--out', path.join(os.tmpdir(), 'chrome-bridge-read-limit.pdf'), '--scale', '0.1'],
      expectedPayload: { scale: 0.1 },
    },
    {
      label: 'trace-events min limit',
      action: 'traceEvents',
      args: ['trace-events', '--limit', '1'],
      expectedPayload: { limit: 1 },
    },
    {
      label: 'trace-stop min limit',
      action: 'traceStop',
      args: ['trace-stop', '--limit', '1'],
      expectedPayload: { limit: 1 },
    },
  ];
  for (const testCase of readLimitValidCases) {
    const beforeValidReadLimit = receivedCommands.length;
    const accepted = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(accepted.ok, `CLI ${testCase.label} must succeed against fake command bridge`);
    const parsed = parseJsonOutput(accepted, `CLI ${testCase.label} fake command bridge`);
    const commandPayload = receivedCommands[beforeValidReadLimit]?.payload || parsed?.payload;
    check(receivedCommands[beforeValidReadLimit]?.action === testCase.action, `CLI ${testCase.label} must dispatch ${testCase.action}`);
    for (const [key, value] of Object.entries(testCase.expectedPayload)) {
      check(commandPayload?.[key] === value, `CLI ${testCase.label} must forward numeric ${key}`);
    }
    readLimitChecks += 1;
  }

  const utilityNumberInvalidCases = [
    {
      label: 'wait invalid timeout-ms',
      args: ['wait', '--selector', 'main', '--timeout-ms', 'nope'],
      message: '--timeout-ms must be between 0 and 300000',
    },
    {
      label: 'wait negative timeout-ms',
      args: ['wait', '--selector', 'main', '--timeout-ms', '-1'],
      message: '--timeout-ms must be between 0 and 300000',
    },
    {
      label: 'wait too large timeout-ms',
      args: ['wait', '--selector', 'main', '--timeout-ms', '300001'],
      message: '--timeout-ms must be between 0 and 300000',
    },
    {
      label: 'scroll invalid x',
      args: ['scroll', '--x', 'nope'],
      message: '--x must be numeric',
    },
    {
      label: 'scroll invalid y',
      args: ['scroll', '--y', 'nope'],
      message: '--y must be numeric',
    },
    {
      label: 'storage too small max-value-chars',
      args: ['storage', '--max-value-chars', '49', '--confirm'],
      message: '--max-value-chars must be between 50 and 5000',
    },
    {
      label: 'request too small max-chars',
      args: ['request', 'https://example.com', '--max-chars', '99', '--confirm'],
      message: '--max-chars must be between 100 and 200000',
    },
    {
      label: 'ask invalid timeout-ms',
      args: ['ask', '--question', 'Continue?', '--timeout-ms', 'nope'],
      message: '--timeout-ms must be between 5000 and 1800000',
    },
  ];
  for (const testCase of utilityNumberInvalidCases) {
    const beforeInvalidUtilityNumber = receivedCommands.length;
    const beforeInvalidUtilityNumberRejects = invalidPayloadRequests.length;
    const rejected = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(!rejected.ok, `CLI ${testCase.label} must fail`);
    check(
      `${rejected.stderr}\n${rejected.stdout}\n${rejected.error}`.includes(testCase.message),
      `CLI ${testCase.label} rejection must explain numeric bounds`,
    );
    check(receivedCommands.length === beforeInvalidUtilityNumber, `CLI ${testCase.label} must not be accepted by fake command bridge`);
    check(
      invalidPayloadRequests.length === beforeInvalidUtilityNumberRejects,
      `CLI ${testCase.label} must fail fast before contacting fake command bridge`,
    );
    utilityNumberChecks += 1;
  }

  const utilityNumberValidCases = [
    {
      label: 'wait zero timeout',
      action: 'waitForSelector',
      args: ['wait', '--selector', 'main', '--timeout-ms', '0'],
      expectedPayload: { selector: 'main', timeoutMs: 0 },
    },
    {
      label: 'scroll zero coordinates',
      action: 'scroll',
      args: ['scroll', '--x', '0', '--y', '0'],
      expectedPayload: { x: 0, y: 0 },
    },
    {
      label: 'storage min max-value-chars',
      action: 'storageSnapshot',
      args: ['storage', '--max-value-chars', '50', '--confirm'],
      expectedPayload: { maxValueChars: 50, confirmed: true },
    },
    {
      label: 'request min max-chars',
      action: 'fetchUrl',
      args: ['request', 'https://example.com', '--max-chars', '100', '--confirm'],
      expectedPayload: { url: 'https://example.com', maxChars: 100, confirmed: true },
    },
    {
      label: 'ask min timeout-ms',
      action: 'askUser',
      args: ['ask', '--question', 'Continue?', '--timeout-ms', '5000'],
      expectedPayload: { question: 'Continue?', timeoutMs: 5000 },
      expectedTimeoutMs: 10_000,
    },
  ];
  for (const testCase of utilityNumberValidCases) {
    const beforeValidUtilityNumber = receivedCommands.length;
    const accepted = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(accepted.ok, `CLI ${testCase.label} must succeed against fake command bridge`);
    const parsed = parseJsonOutput(accepted, `CLI ${testCase.label} fake command bridge`);
    const receivedCommand = receivedCommands[beforeValidUtilityNumber];
    const commandPayload = receivedCommand?.payload || parsed?.payload;
    check(receivedCommand?.action === testCase.action, `CLI ${testCase.label} must dispatch ${testCase.action}`);
    for (const [key, value] of Object.entries(testCase.expectedPayload)) {
      check(commandPayload?.[key] === value, `CLI ${testCase.label} must forward ${key}`);
    }
    if (testCase.expectedTimeoutMs !== undefined) {
      check(receivedCommand?.timeoutMs === testCase.expectedTimeoutMs, `CLI ${testCase.label} must pass command timeoutMs`);
    }
    utilityNumberChecks += 1;
  }

  const groupTitle = 'Codex Bridge CLI Group Scope';
  const groupColor = 'cyan';
  const cases = [
    { action: 'windows', args: ['windows', '--group-title', groupTitle, '--group-color', groupColor] },
    { action: 'tabs', args: ['tabs', '--group-title', groupTitle, '--group-color', groupColor] },
    { action: 'group', args: ['group', '--tabs', '--group-title', groupTitle, '--group-color', groupColor] },
    { action: 'ensureTab', args: ['ensure-tab', 'https://example.com', '--group-title', groupTitle, '--group-color', groupColor] },
    { action: 'adoptTab', args: ['adopt-tab', '--tab', '123', '--group-title', groupTitle, '--group-color', groupColor, '--confirm'] },
    { action: 'open', args: ['open', 'https://example.com', '--new', '--group-title', groupTitle, '--group-color', groupColor] },
    { action: 'closeGroup', args: ['close-group', '--group-title', groupTitle, '--group-color', groupColor, '--confirm'] },
  ];

  for (const testCase of cases) {
    check(COMMAND_PAYLOAD_SCHEMAS[testCase.action]?.includes('groupTitle'), `${testCase.action} schema must allow groupTitle before CLI behavior checks`);
    check(COMMAND_PAYLOAD_SCHEMAS[testCase.action]?.includes('groupColor'), `${testCase.action} schema must allow groupColor before CLI behavior checks`);
    const before = receivedCommands.length;
    const result = await runCli(testCase.args, { CHROME_BRIDGE_SOCKET: socketPath });
    check(result.ok, `CLI ${testCase.args[0]} must succeed against fake command bridge`);
    const parsed = parseJsonOutput(result, `CLI ${testCase.args[0]} fake command bridge`);
    const commandPayload = receivedCommands[before]?.payload || parsed?.payload;
    check(receivedCommands[before]?.action === testCase.action, `CLI ${testCase.args[0]} must dispatch ${testCase.action}`);
    check(commandPayload?.groupTitle === groupTitle, `CLI ${testCase.args[0]} must forward groupTitle`);
    check(commandPayload?.groupColor === groupColor, `CLI ${testCase.args[0]} must forward groupColor`);
    groupScopePayloadChecks += 1;
  }

  const sessionTitle = 'Kurerok Research';
  const sessionGroupTitle = 'Codex Bridge - Kurerok Research';
  const beforeSessionDefault = receivedCommands.length;
  const sessionDefaultResult = await runCli(['ensure-tab', 'https://example.com/session'], {
    CHROME_BRIDGE_SOCKET: socketPath,
    CHROME_BRIDGE_SESSION_TITLE: sessionTitle,
  });
  check(sessionDefaultResult.ok, 'CLI ensure-tab must succeed with CHROME_BRIDGE_SESSION_TITLE');
  const sessionDefaultParsed = parseJsonOutput(sessionDefaultResult, 'CLI session title group default fake command bridge');
  const sessionDefaultPayload = receivedCommands[beforeSessionDefault]?.payload || sessionDefaultParsed?.payload;
  check(receivedCommands[beforeSessionDefault]?.action === 'ensureTab', 'CLI session title default must dispatch ensureTab');
  check(sessionDefaultPayload?.groupTitle === undefined, 'CLI default ensure-tab must not derive a groupTitle from CHROME_BRIDGE_SESSION_TITLE');
  groupScopePayloadChecks += 1;

  const beforeSessionRead = receivedCommands.length;
  const sessionReadResult = await runCli(['text', '--summary-only'], {
    CHROME_BRIDGE_SOCKET: socketPath,
    CHROME_BRIDGE_SESSION_TITLE: sessionTitle,
  });
  check(sessionReadResult.ok, 'CLI text must succeed with CHROME_BRIDGE_SESSION_TITLE');
  const sessionReadParsed = parseJsonOutput(sessionReadResult, 'CLI session title read group default fake command bridge');
  const sessionReadPayload = receivedCommands[beforeSessionRead]?.payload || sessionReadParsed?.payload;
  check(receivedCommands[beforeSessionRead]?.action === 'text', 'CLI session title read default must dispatch text');
  check(sessionReadPayload?.groupTitle === undefined, 'CLI default read commands must not derive a groupTitle from CHROME_BRIDGE_SESSION_TITLE');
  groupScopePayloadChecks += 1;

  const beforeSessionOverride = receivedCommands.length;
  const sessionOverrideResult = await runCli(['open', 'https://example.com/override', '--new', '--group-title', groupTitle], {
    CHROME_BRIDGE_SOCKET: socketPath,
    CHROME_BRIDGE_SESSION_TITLE: sessionTitle,
  });
  check(sessionOverrideResult.ok, 'CLI explicit group title must succeed with session title env');
  const sessionOverrideParsed = parseJsonOutput(sessionOverrideResult, 'CLI explicit group title override fake command bridge');
  const sessionOverridePayload = receivedCommands[beforeSessionOverride]?.payload || sessionOverrideParsed?.payload;
  check(receivedCommands[beforeSessionOverride]?.action === 'open', 'CLI explicit group title override must dispatch open');
  check(sessionOverridePayload?.groupTitle === groupTitle, 'CLI explicit --group-title must override session-derived group title');
  groupScopePayloadChecks += 1;

  const threadId = '019ea301-5db2-7890-9d21-b1b928e6f521';
  const beforeThreadDefault = receivedCommands.length;
  const threadDefaultResult = await runCli(['group'], {
    CHROME_BRIDGE_SOCKET: socketPath,
    CHROME_BRIDGE_SESSION_TITLE: '',
    CODEX_SESSION_TITLE: '',
    CODEX_THREAD_TITLE: '',
    CODEX_THREAD_ID: threadId,
  });
  check(threadDefaultResult.ok, 'CLI group must succeed with CODEX_THREAD_ID fallback');
  const threadDefaultParsed = parseJsonOutput(threadDefaultResult, 'CLI thread id group fallback fake command bridge');
  const threadDefaultPayload = receivedCommands[beforeThreadDefault]?.payload || threadDefaultParsed?.payload;
  check(receivedCommands[beforeThreadDefault]?.action === 'group', 'CLI thread id fallback must dispatch group');
  check(threadDefaultPayload?.groupTitle === 'Codex Bridge - 019ea301', 'CLI must derive fallback groupTitle from short CODEX_THREAD_ID');
  groupScopePayloadChecks += 1;
  });

const extensionPathResult = await runCli(['extension-path']);
check(extensionPathResult.ok, 'CLI extension-path must succeed offline');
check(extensionPathResult.stdout.trim().endsWith('/extension'), 'CLI extension-path must return the unpacked extension path');

const mcpConfigResult = await runCli(['mcp-config']);
check(mcpConfigResult.ok, 'CLI mcp-config must succeed offline');
check(mcpConfigResult.stdout.includes('## Claude Code'), 'CLI mcp-config must include Claude Code setup');
check(mcpConfigResult.stdout.includes('## Cursor'), 'CLI mcp-config must include Cursor setup');
check(mcpConfigResult.stdout.includes('## VS Code'), 'CLI mcp-config must include VS Code setup');
check(mcpConfigResult.stdout.includes('## Windsurf / Cascade'), 'CLI mcp-config must include Windsurf setup');
check(mcpConfigResult.stdout.includes('## Hermes Agent'), 'CLI mcp-config must include Hermes setup');
check(mcpConfigResult.stdout.includes('mcp/chrome-bridge-mcp.mjs'), 'CLI mcp-config must point at the local MCP server file');
check(mcpConfigResult.stdout.includes('Recommended profile: `core`.'), 'CLI mcp-config must annotate compact-client recommendations');
check(mcpConfigResult.stdout.includes('chrome-bridge://profiles/current'), 'CLI mcp-config must mention the current-profile resource');

const cursorMcpConfigResult = await runCli(['mcp-config', '--client', 'cursor']);
check(cursorMcpConfigResult.ok, 'CLI mcp-config --client cursor must succeed offline');
check(cursorMcpConfigResult.stdout.includes('"mcpServers"'), 'CLI cursor mcp-config must return mcpServers JSON');
check(cursorMcpConfigResult.stdout.includes('"CHROME_BRIDGE_MCP_TOOL_PROFILE": "core"'), 'CLI cursor mcp-config must recommend the compact MCP tool profile');
check(cursorMcpConfigResult.stdout.includes('Recommended profile: `core`.'), 'CLI mcp-config --client cursor must explain the recommended profile');
check(!cursorMcpConfigResult.stdout.includes('## Hermes Agent'), 'CLI mcp-config --client cursor must not print every client section');

const mcpWriteTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-mcp-write-check-'));
const mcpWriteCursorResult = await runCli(['mcp-write', '--client', 'cursor', '--root', mcpWriteTmpDir]);
check(mcpWriteCursorResult.ok, 'CLI mcp-write --client cursor must succeed offline');
const mcpWriteCursorJson = parseJsonOutput(mcpWriteCursorResult, 'CLI mcp-write cursor');
const cursorConfigPath = path.join(mcpWriteTmpDir, '.cursor', 'mcp.json');
const cursorConfigText = await fs.readFile(cursorConfigPath, 'utf8');
check(mcpWriteCursorJson?.path === cursorConfigPath, 'CLI mcp-write cursor must report the written project-local path');
check(mcpWriteCursorJson?.projectLocal === true, 'CLI mcp-write cursor must stay project-local by default');
check(cursorConfigText.includes('"CHROME_BRIDGE_MCP_TOOL_PROFILE": "core"'), 'CLI mcp-write cursor must write the core MCP profile');

const codexConfigPath = path.join(mcpWriteTmpDir, '.codex', 'config.toml');
await fs.mkdir(path.dirname(codexConfigPath), { recursive: true });
await fs.writeFile(codexConfigPath, '[mcp_servers.other]\ncommand = "node"\nargs = ["/tmp/other.mjs"]\n', 'utf8');
const mcpWriteCodexResult = await runCli(['mcp-write', '--client', 'codex', '--root', mcpWriteTmpDir]);
check(mcpWriteCodexResult.ok, 'CLI mcp-write --client codex must merge into project-local config');
const codexConfigText = await fs.readFile(codexConfigPath, 'utf8');
check(codexConfigText.includes('[mcp_servers.other]'), 'CLI mcp-write codex must preserve other MCP server sections');
check(codexConfigText.includes('[mcp_servers.chrome-bridge]'), 'CLI mcp-write codex must add the chrome-bridge MCP section');

const hermesWriteResult = await runCli(['mcp-write', '--client', 'hermes', '--root', mcpWriteTmpDir]);
check(!hermesWriteResult.ok, 'CLI mcp-write hermes without --out must fail closed');
check(
  `${hermesWriteResult.stderr}\n${hermesWriteResult.stdout}\n${hermesWriteResult.error}`.includes('no built-in project-local config path'),
  'CLI mcp-write hermes failure must explain the missing project-local path',
);

const codexConfigResult = await runCli(['codex-config']);
check(codexConfigResult.ok, 'CLI codex-config must succeed offline');
check(codexConfigResult.stdout.includes('[mcp_servers.chrome-bridge]'), 'CLI codex-config must return a Codex MCP server section');
check(codexConfigResult.stdout.includes('mcp/chrome-bridge-mcp.mjs'), 'CLI codex-config must point at the local MCP server file');

const catalogResult = await runCli(['command-catalog']);
check(catalogResult.ok, 'CLI command-catalog must succeed offline');
const catalogJson = parseJsonOutput(catalogResult, 'CLI command-catalog');
if (catalogJson) {
  check(catalogJson.cliCommands?.length === CLI_COMMANDS.length, 'CLI command-catalog must expose every registry CLI command');
  check(catalogJson.mcpTools?.length === MCP_TOOLS.length, 'CLI command-catalog must expose every registry MCP tool');
  check(catalogJson.counts?.cliCommands === CLI_COMMANDS.length, 'CLI command-catalog must expose CLI command count');
  check(catalogJson.counts?.mcpTools === MCP_TOOLS.length, 'CLI command-catalog must expose MCP tool count');
  const catalogCommands = new Set(catalogJson.cliCommands || []);
  const catalogTools = new Set(catalogJson.mcpTools || []);
  for (const command of CLI_COMMANDS) {
    check(catalogCommands.has(command), `CLI command-catalog is missing registry CLI command: ${command}`);
  }
  for (const tool of MCP_TOOLS) {
    check(catalogTools.has(tool), `CLI command-catalog is missing registry MCP tool: ${tool}`);
  }
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  checkedCommands: ['doctor', 'extension-path', 'mcp-config', 'codex-config', 'command-catalog'],
  doctorOfflineByDefault: true,
  doctorLiveBridgeCurrent: liveDoctorBridgeCurrent,
  sessionSummaryStaleBridgeRecommendation,
  inventoryIncludeAllChecks,
  privateSensitiveChecks,
  unsafeUrlMethodChecks,
  selectTargetChecks,
  selectIndexChecks,
  tabIdChecks,
  clickAtCoordinateChecks,
  hoverCoordinateChecks,
  traceMaxEventsChecks,
  privateLimitChecks,
  readLimitChecks,
  utilityNumberChecks,
  profileRoutingChecks,
  groupScopePayloadChecks,
  catalogCommandCount: CLI_COMMANDS.length,
  catalogToolCount: MCP_TOOLS.length,
}, null, 2)}\n`);
