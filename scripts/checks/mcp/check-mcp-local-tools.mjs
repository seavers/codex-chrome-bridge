#!/usr/bin/env node
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  BRIDGE_VERSION,
  CLI_COMMANDS,
  COMMAND_PAYLOAD_SCHEMAS,
  MCP_TOOLS,
  validateCommandPayload,
} from '../../../shared/command-registry.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mcpPath = path.join(rootDir, 'mcp/chrome-bridge-mcp.mjs');
const failures = [];

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function inheritedEnv(extra = {}) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
    ...extra,
  };
}

function parseToolJson(result, label) {
  const text = result?.content?.find((item) => item?.type === 'text')?.text;
  if (!text) {
    fail(`${label} did not return text content`);
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} text content was not JSON: ${String(error?.message || error)}`);
    return null;
  }
}

async function withMcpClient(fn, env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpPath],
    cwd: rootDir,
    env: inheritedEnv({ CHROME_BRIDGE_URL: 'http://127.0.0.1:9', ...env }),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'chrome-bridge-mcp-local-tools-check', version: '0.1.0' });

  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await client.connect(transport);
    return await fn(client);
  } catch (error) {
    fail(`MCP local tools check failed: ${String(error?.message || error)}${stderr ? `; stderr: ${stderr.slice(0, 500)}` : ''}`);
    return null;
  } finally {
    await client.close().catch(() => {});
  }
}

async function withFakeLiveDoctor(fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-mcp-doctor-check-'));
  const fakeBinDir = path.join(tmpDir, 'bin');
  await fs.mkdir(fakeBinDir);
  const fakeOsascript = path.join(fakeBinDir, 'osascript');
  await fs.writeFile(fakeOsascript, '#!/bin/sh\nprintf "Codex Bridge Fake Chrome Title\\n"\n');
  await fs.chmod(fakeOsascript, 0o755);

  const server = http.createServer((req, res) => {
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
    const { port } = server.address();
    return await fn({
      bridgeUrl: `http://127.0.0.1:${port}`,
      pathEnv: `${fakeBinDir}${path.delimiter}${process.env.PATH || ''}`,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function withFakeStaleSummaryBridge(fn) {
  const staleBridgeVersion = '0.0.0-stale-summary';
  const server = http.createServer((req, res) => {
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
    const { port } = server.address();
    return await fn({
      bridgeUrl: `http://127.0.0.1:${port}`,
      staleBridgeVersion,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withFakeCommandBridge(fn) {
  const receivedCommands = [];
  const server = http.createServer(async (req, res) => {
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
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        code: 'INVALID_PAYLOAD',
        error: String(error?.message || error),
      }));
      return;
    }

    receivedCommands.push(parsed);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      result: {
        action: parsed.action,
        payload: parsed.payload,
        timeoutMs: parsed.timeoutMs,
      },
    }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    return await fn({
      bridgeUrl: `http://127.0.0.1:${port}`,
      receivedCommands,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

let doctorLiveBridgeCurrent = null;
await withMcpClient(async (client) => {
  const tools = await client.listTools();
  const toolNames = new Set((tools.tools || []).map((tool) => tool.name));
  const registryToolNames = new Set(MCP_TOOLS);
  for (const tool of MCP_TOOLS) {
    check(toolNames.has(tool), `MCP listTools output is missing registry tool: ${tool}`);
  }
  for (const tool of toolNames) {
    check(registryToolNames.has(tool), `MCP listTools output includes unexpected MCP tool: ${tool}`);
  }
  check(toolNames.size === MCP_TOOLS.length, 'MCP listTools output count must match registry MCP_TOOLS count');

  check(toolNames.has('chrome_bridge_doctor'), 'MCP tools list must expose chrome_bridge_doctor');
  check(toolNames.has('chrome_bridge_extension_path'), 'MCP tools list must expose chrome_bridge_extension_path');
  check(toolNames.has('chrome_bridge_mcp_config'), 'MCP tools list must expose chrome_bridge_mcp_config');
  check(toolNames.has('chrome_bridge_codex_config'), 'MCP tools list must expose chrome_bridge_codex_config');
  check(toolNames.has('chrome_bridge_command_catalog'), 'MCP tools list must expose chrome_bridge_command_catalog');

  const doctorParsed = parseToolJson(await client.callTool({
    name: 'chrome_bridge_doctor',
    arguments: {},
  }), 'MCP doctor');

  if (doctorParsed) {
    check(doctorParsed.liveChecks === false, 'MCP doctor must keep liveChecks === false by default');
    check(doctorParsed.health?.skipped === true, 'MCP doctor default call must skip bridge health checks');
    check(doctorParsed.health?.ok === null, 'MCP doctor default call must not contact bridge health');
    check(doctorParsed.checks?.extensionConnected === null, 'MCP doctor default call must not infer extension connection');
    check(doctorParsed.mcpProfiles?.cursor === 'core', 'MCP doctor must recommend the core MCP profile for Cursor');
    check(doctorParsed.mcpProfiles?.generic === 'read', 'MCP doctor must recommend the read MCP profile for generic clients');
    check(Array.isArray(doctorParsed.nextActions), 'MCP doctor must return setup nextActions');
    check(doctorParsed.nextActions.some((action) => action.includes('runtime-smoke --coverage-plan')), 'MCP doctor offline nextActions must recommend the coverage plan');
    check(doctorParsed.nextActions.some((action) => action.includes('advise --task')), 'MCP doctor offline nextActions must recommend the advisor flow');
    check(doctorParsed.nextActions.some((action) => action.includes('mcp-config --client')), 'MCP doctor offline nextActions must recommend client snippets');
  }

  const catalogParsed = parseToolJson(await client.callTool({
    name: 'chrome_bridge_command_catalog',
    arguments: {},
  }), 'MCP command catalog');

  check(catalogParsed?.cliCommands?.length === CLI_COMMANDS.length, 'MCP command catalog must expose every registry CLI command');
  check(catalogParsed?.mcpTools?.length === MCP_TOOLS.length, 'MCP command catalog must expose every registry MCP tool');
  check(catalogParsed?.counts?.cliCommands === CLI_COMMANDS.length, 'MCP command catalog must expose registry CLI command count');
  check(catalogParsed?.counts?.mcpTools === MCP_TOOLS.length, 'MCP command catalog must expose registry MCP tool count');
  check(catalogParsed?.mcpProfile?.profile === 'full', 'MCP command catalog must expose the active full profile by default');
  check(catalogParsed?.mcpProfile?.counts?.enabled === MCP_TOOLS.length, 'MCP command catalog must expose the enabled tool count for the active profile');
  const catalogCommandNames = new Set(catalogParsed?.cliCommands || []);
  const catalogToolNames = new Set(catalogParsed?.mcpTools || []);
  for (const command of CLI_COMMANDS) {
    check(catalogCommandNames.has(command), `MCP command catalog is missing registry CLI command: ${command}`);
  }
  for (const tool of MCP_TOOLS) {
    check(catalogToolNames.has(tool), `MCP command catalog is missing registry tool: ${tool}`);
  }

  const doctorEntry = catalogParsed?.localCommands?.find((entry) => entry.id === 'doctor');
  check(Boolean(doctorEntry), 'MCP command catalog must include local doctor command');
  check(doctorEntry?.mcp?.includes('chrome_bridge_doctor'), 'MCP command catalog must map doctor to chrome_bridge_doctor');
  check(doctorEntry?.liveBridge === 'optional', 'MCP command catalog must mark doctor live bridge behavior optional');

  const extensionPath = await client.callTool({
    name: 'chrome_bridge_extension_path',
    arguments: {},
  });
  const extensionPathText = extensionPath?.content?.find((item) => item?.type === 'text')?.text;
  check(typeof extensionPathText === 'string' && extensionPathText.endsWith('/extension'), 'MCP extension path tool must return the unpacked extension path');

  const mcpConfig = await client.callTool({
    name: 'chrome_bridge_mcp_config',
    arguments: {},
  });
  const mcpConfigText = mcpConfig?.content?.find((item) => item?.type === 'text')?.text;
  check(mcpConfigText?.includes('## Claude Code'), 'MCP mcp-config tool must include Claude Code setup');
  check(mcpConfigText?.includes('## Cursor'), 'MCP mcp-config tool must include Cursor setup');
  check(mcpConfigText?.includes('## Hermes Agent'), 'MCP mcp-config tool must include Hermes setup');
  check(mcpConfigText?.includes('mcp/chrome-bridge-mcp.mjs'), 'MCP mcp-config tool must point at the local MCP server file');
  check(mcpConfigText?.includes('Recommended profile: `core`.'), 'MCP mcp-config tool must annotate compact-client recommendations');
  check(mcpConfigText?.includes('chrome-bridge://profiles/current'), 'MCP mcp-config tool must mention the current-profile resource');

  const mcpCursorConfig = await client.callTool({
    name: 'chrome_bridge_mcp_config',
    arguments: { client: 'cursor' },
  });
  const mcpCursorConfigText = mcpCursorConfig?.content?.find((item) => item?.type === 'text')?.text;
  check(mcpCursorConfigText?.includes('"mcpServers"'), 'MCP mcp-config cursor tool must return mcpServers JSON');
  check(mcpCursorConfigText?.includes('"CHROME_BRIDGE_MCP_TOOL_PROFILE": "core"'), 'MCP mcp-config cursor tool must recommend the compact MCP tool profile');
  check(mcpCursorConfigText?.includes('Recommended profile: `core`.'), 'MCP mcp-config cursor tool must explain the recommended profile');
  check(!mcpCursorConfigText?.includes('## Hermes Agent'), 'MCP mcp-config cursor tool must not return every client section');

  const codexConfig = await client.callTool({
    name: 'chrome_bridge_codex_config',
    arguments: {},
  });
  const codexConfigText = codexConfig?.content?.find((item) => item?.type === 'text')?.text;
  check(codexConfigText?.includes('[mcp_servers.chrome-bridge]'), 'MCP codex-config tool must return a Codex MCP server section');
  check(codexConfigText?.includes('mcp/chrome-bridge-mcp.mjs'), 'MCP codex-config tool must point at the local MCP server file');
});

await withMcpClient(async (client) => {
  const tools = await client.listTools();
  const toolNames = new Set((tools.tools || []).map((tool) => tool.name));
  check(toolNames.size > 0 && toolNames.size <= 40, 'MCP core profile must expose a compact tool list for IDE agents');
  check(toolNames.has('chrome_bridge_mcp_config'), 'MCP core profile must expose chrome_bridge_mcp_config');
  check(toolNames.has('chrome_bridge_observe'), 'MCP core profile must expose read-first observe');
  check(toolNames.has('chrome_bridge_click'), 'MCP core profile must expose confirmed click');
  check(!toolNames.has('chrome_bridge_cookies_list'), 'MCP core profile must omit sensitive private-browser tools by default');

  const catalogParsed = parseToolJson(await client.callTool({
    name: 'chrome_bridge_command_catalog',
    arguments: {},
  }), 'MCP command catalog core profile');
  check(catalogParsed?.mcpProfile?.profile === 'core', 'MCP command catalog must expose the active core profile when profile-gated');
  check(Array.isArray(catalogParsed?.mcpProfile?.omittedTools) && catalogParsed.mcpProfile.omittedTools.includes('chrome_bridge_cookies_list'), 'MCP command catalog core profile must list omitted sensitive tools');
}, {
  CHROME_BRIDGE_MCP_TOOL_PROFILE: 'core',
});

await withFakeLiveDoctor(async ({ bridgeUrl, pathEnv }) => {
  await withMcpClient(async (client) => {
    const liveDoctorParsed = parseToolJson(await client.callTool({
      name: 'chrome_bridge_doctor',
      arguments: { liveChecks: true },
    }), 'MCP doctor live checks');
    if (!liveDoctorParsed) return;

    check(liveDoctorParsed.liveChecks === true, 'MCP doctor live check fixture must report liveChecks=true');
    check(liveDoctorParsed.health?.ok === true, 'MCP doctor live check fixture must read fake health');
    check(liveDoctorParsed.checks?.expectedBridgeVersion === BRIDGE_VERSION, 'MCP doctor live checks must report expected bridge version');
    check(liveDoctorParsed.checks?.bridgeVersion === BRIDGE_VERSION, 'MCP doctor live checks must report observed bridge version');
    check(liveDoctorParsed.checks?.bridgeCurrent === true, 'MCP doctor live checks must confirm bridge version is current');
    doctorLiveBridgeCurrent = liveDoctorParsed.checks?.bridgeCurrent;
  }, {
    CHROME_BRIDGE_URL: bridgeUrl,
    PATH: pathEnv,
  });
});

let sessionSummaryStaleBridgeRecommendation = false;
await withFakeStaleSummaryBridge(async ({ bridgeUrl, staleBridgeVersion }) => {
  await withMcpClient(async (client) => {
    const summaryParsed = parseToolJson(await client.callTool({
      name: 'chrome_bridge_session_summary',
      arguments: {},
    }), 'MCP session-summary stale bridge');
    if (!summaryParsed) return;

    sessionSummaryStaleBridgeRecommendation = summaryParsed.recommendations?.some((recommendation) => (
      recommendation.includes('Restart the local Chrome Bridge server')
        && recommendation.includes(staleBridgeVersion)
    ));
    check(sessionSummaryStaleBridgeRecommendation, 'MCP session-summary must recommend restarting stale bridge server');
    check(summaryParsed.mcpProfile?.profile === 'full', 'MCP session-summary must include the active MCP profile summary');
    check(summaryParsed.nextActions?.some((action) => action.includes('chrome_bridge_doctor')), 'MCP session-summary must include a concrete stale-bridge next action');
  }, {
    CHROME_BRIDGE_URL: bridgeUrl,
  });
});

let inventoryIncludeAllChecks = 0;
let privateSensitiveChecks = 0;
let unsafeUrlMethodChecks = 0;
let selectTargetChecks = 0;
let timeoutBoundsChecks = 0;
let historyTimeChecks = 0;
let groupScopePayloadChecks = 0;
let mcpArtifactDirChecks = 0;
let profileRoutingChecks = 0;
await withFakeCommandBridge(async ({ bridgeUrl, receivedCommands }) => {
  const groupTitle = 'Codex Bridge MCP Group Scope';
  const groupColor = 'cyan';
  await withMcpClient(async (client) => {
    const beforeProfileRoute = receivedCommands.length;
    const profileRouteParsed = parseToolJson(await client.callTool({
      name: 'chrome_bridge_tabs',
      arguments: {},
    }), 'MCP CHROME_BRIDGE_PROFILE_ID fake command bridge');
    const profileRoutePayload = receivedCommands[beforeProfileRoute]?.payload || profileRouteParsed?.payload;
    check(receivedCommands[beforeProfileRoute]?.action === 'tabs', 'MCP profile routing check must dispatch tabs');
    check(profileRoutePayload?.profileId === 'profile-mcp-check', 'MCP must forward CHROME_BRIDGE_PROFILE_ID as payload.profileId');
    profileRoutingChecks += 1;
  }, {
    CHROME_BRIDGE_URL: bridgeUrl,
    CHROME_BRIDGE_PROFILE_ID: 'profile-mcp-check',
  });

  const includeAllCases = [
    { action: 'windows', tool: 'chrome_bridge_windows' },
    { action: 'tabs', tool: 'chrome_bridge_tabs' },
  ];
  const sensitiveCases = [
    {
      action: 'cookiesList',
      tool: 'chrome_bridge_cookies_list',
      args: { confirmed: true },
      confirmedArgs: { confirmed: true, confirmSensitive: true },
      expectedPayload: { confirmSensitive: true },
    },
    {
      action: 'storageSnapshot',
      tool: 'chrome_bridge_storage_snapshot',
      args: { includeValues: true, confirmed: true },
      confirmedArgs: { includeValues: true, confirmed: true, confirmSensitive: true },
      expectedPayload: { includeValues: true, confirmSensitive: true },
    },
    {
      action: 'fetchUrl',
      tool: 'chrome_bridge_request',
      args: { url: 'https://example.com', credentials: 'include', confirmed: true },
      confirmedArgs: { url: 'https://example.com', credentials: 'include', confirmed: true, confirmSensitive: true },
      expectedPayload: { url: 'https://example.com', credentials: 'include', confirmSensitive: true },
    },
  ];
  const unsafeCases = [
    {
      tool: 'chrome_bridge_open',
      args: { url: 'javascript:alert(1)' },
      expected: ['URL must use http:, https:, or about:blank', 'URL'],
    },
    {
      tool: 'chrome_bridge_request',
      args: { url: 'file:///etc/passwd', confirmed: true },
      expected: ['URL must use http: or https:', 'URL'],
    },
    {
      tool: 'chrome_bridge_request',
      args: { url: 'https://example.com', method: 'TRACE', confirmed: true },
      expected: ['Invalid enum value', 'Expected', 'TRACE'],
    },
  ];
  const cases = [
    { action: 'windows', tool: 'chrome_bridge_windows', args: { groupTitle, groupColor } },
    { action: 'tabs', tool: 'chrome_bridge_tabs', args: { groupTitle, groupColor } },
    { action: 'group', tool: 'chrome_bridge_group', args: { includeTabs: true, groupTitle, groupColor } },
    { action: 'ensureTab', tool: 'chrome_bridge_ensure_tab', args: { url: 'https://example.com', groupTitle, groupColor } },
    { action: 'adoptTab', tool: 'chrome_bridge_adopt_tab', args: { tabId: 123, groupTitle, groupColor, confirmed: true } },
    { action: 'open', tool: 'chrome_bridge_open', args: { url: 'https://example.com', newTab: true, groupTitle, groupColor } },
    { action: 'closeGroup', tool: 'chrome_bridge_close_group', args: { groupTitle, groupColor, confirmed: true } },
  ];

  await withMcpClient(async (client) => {
    for (const testCase of includeAllCases) {
      const beforeReject = receivedCommands.length;
      try {
        const rejected = await client.callTool({
          name: testCase.tool,
          arguments: { includeAll: true },
        });
        const rejectedText = rejected?.content?.find((item) => item?.type === 'text')?.text || '';
        check(rejected?.isError === true, `MCP ${testCase.tool} includeAll must return a tool error without confirmed=true`);
        check(
          rejectedText.includes(`${testCase.action} requires confirmed=true`),
          `MCP ${testCase.tool} includeAll tool error must explain confirmed=true`,
        );
      } catch (error) {
        check(
          String(error?.message || error).includes(`${testCase.action} requires confirmed=true`),
          `MCP ${testCase.tool} includeAll rejection must explain confirmed=true`,
        );
      }
      check(receivedCommands.length === beforeReject, `MCP ${testCase.tool} unconfirmed includeAll must not be accepted by fake bridge`);
      inventoryIncludeAllChecks += 1;

      const beforeAccept = receivedCommands.length;
      const parsed = parseToolJson(await client.callTool({
        name: testCase.tool,
        arguments: { includeAll: true, confirmed: true },
      }), `MCP ${testCase.tool} confirmed includeAll fake command bridge`);
      const commandPayload = receivedCommands[beforeAccept]?.payload || parsed?.payload;
      check(receivedCommands[beforeAccept]?.action === testCase.action, `MCP ${testCase.tool} confirmed includeAll must dispatch ${testCase.action}`);
      check(commandPayload?.includeAll === true, `MCP ${testCase.tool} confirmed includeAll must forward includeAll`);
      check(commandPayload?.confirmed === true, `MCP ${testCase.tool} confirmed includeAll must forward confirmed`);
      inventoryIncludeAllChecks += 1;
    }

    for (const testCase of sensitiveCases) {
      const beforeReject = receivedCommands.length;
      try {
        const rejected = await client.callTool({
          name: testCase.tool,
          arguments: testCase.args,
        });
        const rejectedText = rejected?.content?.find((item) => item?.type === 'text')?.text || '';
        check(rejected?.isError === true, `MCP ${testCase.tool} private-sensitive request must return a tool error without confirmSensitive`);
        check(
          rejectedText.includes('confirmSensitive=true'),
          `MCP ${testCase.tool} private-sensitive tool error must explain confirmSensitive=true`,
        );
      } catch (error) {
        check(
          String(error?.message || error).includes('confirmSensitive=true'),
          `MCP ${testCase.tool} private-sensitive rejection must explain confirmSensitive=true`,
        );
      }
      check(receivedCommands.length === beforeReject, `MCP ${testCase.tool} private-sensitive request without confirmSensitive must not be accepted`);
      privateSensitiveChecks += 1;

      const beforeAccept = receivedCommands.length;
      const parsed = parseToolJson(await client.callTool({
        name: testCase.tool,
        arguments: testCase.confirmedArgs,
      }), `MCP ${testCase.tool} private-sensitive fake command bridge`);
      const commandPayload = receivedCommands[beforeAccept]?.payload || parsed?.payload;
      check(receivedCommands[beforeAccept]?.action === testCase.action, `MCP ${testCase.tool} private-sensitive request must dispatch ${testCase.action}`);
      for (const [key, value] of Object.entries(testCase.expectedPayload)) {
        check(commandPayload?.[key] === value, `MCP ${testCase.tool} private-sensitive request must forward ${key}`);
      }
      check(commandPayload?.confirmed === true, `MCP ${testCase.tool} private-sensitive request must forward confirmed`);
      privateSensitiveChecks += 1;
    }

    for (const testCase of unsafeCases) {
      const beforeReject = receivedCommands.length;
      try {
        const rejected = await client.callTool({
          name: testCase.tool,
          arguments: testCase.args,
        });
        const rejectedText = rejected?.content?.find((item) => item?.type === 'text')?.text || '';
        check(rejected?.isError === true, `MCP ${testCase.tool} unsafe URL/method must return a tool error`);
        check(
          testCase.expected.some((needle) => rejectedText.includes(needle)),
          `MCP ${testCase.tool} unsafe URL/method tool error must explain the rejected input`,
        );
      } catch (error) {
        check(
          testCase.expected.some((needle) => String(error?.message || error).includes(needle)),
          `MCP ${testCase.tool} unsafe URL/method rejection must explain the rejected input`,
        );
      }
      check(receivedCommands.length === beforeReject, `MCP ${testCase.tool} unsafe URL/method must not be accepted by fake bridge`);
      unsafeUrlMethodChecks += 1;
    }

    const timeoutInvalidCases = [
      {
        tool: 'chrome_bridge_wait_for_selector',
        args: { selector: 'main', timeoutMs: -1 },
        expected: ['timeoutMs', 'greater than or equal to 0', 'between 0 and 300000'],
      },
      {
        tool: 'chrome_bridge_back',
        args: { timeoutMs: 300_001 },
        expected: ['timeoutMs', 'less than or equal to 300000', 'between 0 and 300000'],
      },
    ];
    for (const testCase of timeoutInvalidCases) {
      const beforeReject = receivedCommands.length;
      try {
        const rejected = await client.callTool({
          name: testCase.tool,
          arguments: testCase.args,
        });
        const rejectedText = rejected?.content?.find((item) => item?.type === 'text')?.text || '';
        check(rejected?.isError === true, `MCP ${testCase.tool} invalid timeoutMs must return a tool error`);
        check(
          testCase.expected.some((needle) => rejectedText.includes(needle)),
          `MCP ${testCase.tool} invalid timeoutMs tool error must explain timeout bounds`,
        );
      } catch (error) {
        check(
          testCase.expected.some((needle) => String(error?.message || error).includes(needle)),
          `MCP ${testCase.tool} invalid timeoutMs rejection must explain timeout bounds`,
        );
      }
      check(receivedCommands.length === beforeReject, `MCP ${testCase.tool} invalid timeoutMs must not be accepted by fake bridge`);
      timeoutBoundsChecks += 1;
    }

    const beforeWaitZero = receivedCommands.length;
    const waitZeroParsed = parseToolJson(await client.callTool({
      name: 'chrome_bridge_wait_for_selector',
      arguments: { selector: 'main', timeoutMs: 0 },
    }), 'MCP wait timeout 0 fake command bridge');
    const waitZeroPayload = receivedCommands[beforeWaitZero]?.payload || waitZeroParsed?.payload;
    check(receivedCommands[beforeWaitZero]?.action === 'waitForSelector', 'MCP wait timeout 0 must dispatch waitForSelector');
    check(waitZeroPayload?.timeoutMs === 0, 'MCP wait timeout 0 must forward timeoutMs 0');
    timeoutBoundsChecks += 1;

    const mcpArtifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-bridge-mcp-artifact-dir-check-'));
    try {
      const textParsed = parseToolJson(await client.callTool({
        name: 'chrome_bridge_text',
        arguments: {
          tabId: 123,
          artifactDir: mcpArtifactDir,
          summaryOnly: true,
        },
      }), 'MCP text artifactDir fake command bridge');
      check(textParsed?.artifactPath?.startsWith(`${mcpArtifactDir}${path.sep}`), 'MCP read tools must honor artifactDir when writing metadata-first artifacts');
      check(await fs.readFile(textParsed?.artifactPath).then(() => true).catch(() => false), 'MCP read tools must write the artifact into the requested artifactDir');
      mcpArtifactDirChecks += 1;
    } finally {
      await fs.rm(mcpArtifactDir, { recursive: true, force: true });
    }

    const beforeInvalidHistoryTime = receivedCommands.length;
    try {
      const rejected = await client.callTool({
        name: 'chrome_bridge_history_search',
        arguments: { startTime: -1, confirmed: true },
      });
      const rejectedText = rejected?.content?.find((item) => item?.type === 'text')?.text || '';
      check(rejected?.isError === true, 'MCP history negative startTime must return a tool error');
      check(
        ['startTime', 'greater than or equal to 0'].some((needle) => rejectedText.includes(needle)),
        'MCP history negative startTime tool error must explain startTime bounds',
      );
    } catch (error) {
      check(
        ['startTime', 'greater than or equal to 0'].some((needle) => String(error?.message || error).includes(needle)),
        'MCP history negative startTime rejection must explain startTime bounds',
      );
    }
    check(receivedCommands.length === beforeInvalidHistoryTime, 'MCP history negative startTime must not be accepted by fake bridge');
    historyTimeChecks += 1;

    const beforeValidHistoryTime = receivedCommands.length;
    const historyTimeParsed = parseToolJson(await client.callTool({
      name: 'chrome_bridge_history_search',
      arguments: { startTime: 0, endTime: 1, confirmed: true },
    }), 'MCP history time filter fake command bridge');
    const historyTimePayload = receivedCommands[beforeValidHistoryTime]?.payload || historyTimeParsed?.payload;
    check(receivedCommands[beforeValidHistoryTime]?.action === 'historySearch', 'MCP history time filter must dispatch historySearch');
    check(historyTimePayload?.startTime === 0, 'MCP history time filter must forward startTime 0');
    check(historyTimePayload?.endTime === 1, 'MCP history time filter must forward endTime 1');
    check(historyTimePayload?.confirmed === true, 'MCP history time filter must forward confirmed');
    historyTimeChecks += 1;

    check(COMMAND_PAYLOAD_SCHEMAS.select?.includes('index'), 'select schema must allow index before MCP behavior checks');
    const beforeMissingSelectTarget = receivedCommands.length;
    try {
      const rejected = await client.callTool({
        name: 'chrome_bridge_select',
        arguments: { selector: '#country', confirmed: true },
      });
      const rejectedText = rejected?.content?.find((item) => item?.type === 'text')?.text || '';
      check(rejected?.isError === true, 'MCP select without value, label, or index must return a tool error');
      check(
        rejectedText.includes('select requires value, label, or index'),
        'MCP select missing target tool error must explain value, label, or index',
      );
    } catch (error) {
      check(
        String(error?.message || error).includes('select requires value, label, or index'),
        'MCP select missing target rejection must explain value, label, or index',
      );
    }
    check(
      receivedCommands.length === beforeMissingSelectTarget,
      'MCP select missing target must not be accepted by fake command bridge',
    );
    selectTargetChecks += 1;

    const beforeSelectIndex = receivedCommands.length;
    const selectIndexParsed = parseToolJson(await client.callTool({
      name: 'chrome_bridge_select',
      arguments: { selector: '#country', index: 0, confirmed: true },
    }), 'MCP select index 0 fake command bridge');
    const selectIndexPayload = receivedCommands[beforeSelectIndex]?.payload || selectIndexParsed?.payload;
    check(receivedCommands[beforeSelectIndex]?.action === 'select', 'MCP select with index 0 must dispatch select');
    check(selectIndexPayload?.selector === '#country', 'MCP select with index 0 must forward selector');
    check(selectIndexPayload?.index === 0, 'MCP select with index 0 must forward numeric index 0');
    check(selectIndexPayload?.confirmed === true, 'MCP select with index 0 must forward confirmed');
    selectTargetChecks += 1;

    for (const testCase of cases) {
      check(COMMAND_PAYLOAD_SCHEMAS[testCase.action]?.includes('groupTitle'), `${testCase.action} schema must allow groupTitle before MCP behavior checks`);
      check(COMMAND_PAYLOAD_SCHEMAS[testCase.action]?.includes('groupColor'), `${testCase.action} schema must allow groupColor before MCP behavior checks`);
      const before = receivedCommands.length;
      const parsed = parseToolJson(await client.callTool({
        name: testCase.tool,
        arguments: testCase.args,
      }), `MCP ${testCase.tool} fake command bridge`);
      const commandPayload = receivedCommands[before]?.payload || parsed?.payload;
      check(receivedCommands[before]?.action === testCase.action, `MCP ${testCase.tool} must dispatch ${testCase.action}`);
      check(commandPayload?.groupTitle === groupTitle, `MCP ${testCase.tool} must forward groupTitle`);
      check(commandPayload?.groupColor === groupColor, `MCP ${testCase.tool} must forward groupColor`);
      groupScopePayloadChecks += 1;
    }
  }, {
    CHROME_BRIDGE_URL: bridgeUrl,
  });

  await withMcpClient(async (client) => {
    const sessionTitle = 'Kurerok Research';
    const sessionGroupTitle = 'Codex Bridge - Kurerok Research';
    const beforeSessionDefault = receivedCommands.length;
    const sessionDefaultParsed = parseToolJson(await client.callTool({
      name: 'chrome_bridge_ensure_tab',
      arguments: { url: 'https://example.com/session' },
    }), 'MCP session title group default fake command bridge');
    const sessionDefaultPayload = receivedCommands[beforeSessionDefault]?.payload || sessionDefaultParsed?.payload;
    check(receivedCommands[beforeSessionDefault]?.action === 'ensureTab', 'MCP session title default must dispatch ensureTab');
    check(sessionDefaultPayload?.groupTitle === undefined, 'MCP default ensure-tab must not derive a groupTitle from CHROME_BRIDGE_SESSION_TITLE');
    groupScopePayloadChecks += 1;

    const beforeSessionRead = receivedCommands.length;
    const sessionReadParsed = parseToolJson(await client.callTool({
      name: 'chrome_bridge_text',
      arguments: { summaryOnly: true },
    }), 'MCP session title read group default fake command bridge');
    const sessionReadPayload = receivedCommands[beforeSessionRead]?.payload || sessionReadParsed?.payload;
    check(receivedCommands[beforeSessionRead]?.action === 'text', 'MCP session title read default must dispatch text');
    check(sessionReadPayload?.groupTitle === undefined, 'MCP default read commands must not derive a groupTitle from CHROME_BRIDGE_SESSION_TITLE');
    groupScopePayloadChecks += 1;

    const beforeSessionOverride = receivedCommands.length;
    const sessionOverrideParsed = parseToolJson(await client.callTool({
      name: 'chrome_bridge_open',
      arguments: { url: 'https://example.com/override', newTab: true, groupTitle },
    }), 'MCP explicit group title override fake command bridge');
    const sessionOverridePayload = receivedCommands[beforeSessionOverride]?.payload || sessionOverrideParsed?.payload;
    check(receivedCommands[beforeSessionOverride]?.action === 'open', 'MCP explicit group title override must dispatch open');
    check(sessionOverridePayload?.groupTitle === groupTitle, 'MCP explicit groupTitle must override session-derived group title');
    groupScopePayloadChecks += 1;
  }, {
    CHROME_BRIDGE_URL: bridgeUrl,
    CHROME_BRIDGE_SESSION_TITLE: 'Kurerok Research',
  });

  await withMcpClient(async (client) => {
    const beforeThreadDefault = receivedCommands.length;
    const threadDefaultParsed = parseToolJson(await client.callTool({
      name: 'chrome_bridge_group',
      arguments: {},
    }), 'MCP thread id group fallback fake command bridge');
    const threadDefaultPayload = receivedCommands[beforeThreadDefault]?.payload || threadDefaultParsed?.payload;
    check(receivedCommands[beforeThreadDefault]?.action === 'group', 'MCP thread id fallback must dispatch group');
    check(threadDefaultPayload?.groupTitle === 'Codex Bridge - 019ea301', 'MCP must derive fallback groupTitle from short CODEX_THREAD_ID');
    groupScopePayloadChecks += 1;
  }, {
    CHROME_BRIDGE_URL: bridgeUrl,
    CHROME_BRIDGE_SESSION_TITLE: '',
    CODEX_SESSION_TITLE: '',
    CODEX_THREAD_TITLE: '',
    CODEX_THREAD_ID: '019ea301-5db2-7890-9d21-b1b928e6f521',
  });
});

if (failures.length) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  registryCommandCount: CLI_COMMANDS.length,
  registryToolCount: MCP_TOOLS.length,
  catalogCommandCount: CLI_COMMANDS.length,
  catalogToolCount: MCP_TOOLS.length,
  listedToolCount: MCP_TOOLS.length,
  checkedTools: ['chrome_bridge_doctor', 'chrome_bridge_extension_path', 'chrome_bridge_mcp_config', 'chrome_bridge_codex_config', 'chrome_bridge_command_catalog'],
  doctorOfflineByDefault: true,
  doctorLiveBridgeCurrent,
  sessionSummaryStaleBridgeRecommendation,
  inventoryIncludeAllChecks,
  privateSensitiveChecks,
  unsafeUrlMethodChecks,
  selectTargetChecks,
  timeoutBoundsChecks,
  historyTimeChecks,
  groupScopePayloadChecks,
  mcpArtifactDirChecks,
  profileRoutingChecks,
}, null, 2)}\n`);
