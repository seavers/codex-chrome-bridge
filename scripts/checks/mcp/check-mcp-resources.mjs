#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCP_TOOLS } from '../../../shared/command-registry.mjs';

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

async function withMcpClient(fn, env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpPath],
    cwd: rootDir,
    env: inheritedEnv({ CHROME_BRIDGE_SOCKET: '/tmp/chrome-bridge-unavailable.sock', ...env }),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'chrome-bridge-mcp-resources-check', version: '0.1.0' });

  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await client.connect(transport);
    return await fn(client);
  } catch (error) {
    fail(`MCP resources check failed: ${String(error?.message || error)}${stderr ? `; stderr: ${stderr.slice(0, 500)}` : ''}`);
    return null;
  } finally {
    await client.close().catch(() => {});
  }
}

function resourceText(result, label) {
  const first = result?.contents?.[0];
  if (!first || typeof first.text !== 'string') {
    fail(`${label} did not return text resource contents`);
    return '';
  }
  return first.text;
}

function parseJsonResource(result, label) {
  const text = resourceText(result, label);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} was not valid JSON: ${String(error?.message || error)}`);
    return null;
  }
}

const EXPECTED_RESOURCE_URIS = [
  'chrome-bridge://docs/quickstart',
  'chrome-bridge://docs/safety',
  'chrome-bridge://docs/compatibility',
  'chrome-bridge://catalog/tools',
  'chrome-bridge://profiles/current',
  'chrome-bridge://workflows/read-first',
  'chrome-bridge://workflows/debug-bundle',
];

await withMcpClient(async (client) => {
  const resourceList = await client.listResources();
  const resourceUris = new Set((resourceList.resources || []).map((resource) => resource.uri));
  check(resourceUris.size === EXPECTED_RESOURCE_URIS.length, 'MCP resources/list count must match the expected Chrome Bridge resource set');
  for (const uri of EXPECTED_RESOURCE_URIS) {
    check(resourceUris.has(uri), `MCP resources/list is missing expected resource: ${uri}`);
  }

  const quickstart = await client.readResource({ uri: 'chrome-bridge://docs/quickstart' });
  const quickstartText = resourceText(quickstart, 'quickstart resource');
  check(quickstartText.includes('chrome_bridge_health'), 'quickstart resource must recommend health');
  check(quickstartText.includes('chrome_bridge_observe'), 'quickstart resource must recommend observe');

  const safety = await client.readResource({ uri: 'chrome-bridge://docs/safety' });
  const safetyText = resourceText(safety, 'safety resource');
  check(safetyText.includes('confirmSensitive: true'), 'safety resource must mention sensitive confirmation');

  const compatibility = await client.readResource({ uri: 'chrome-bridge://docs/compatibility' });
  const compatibilityText = resourceText(compatibility, 'compatibility resource');
  check(compatibilityText.includes('Claude Code'), 'compatibility resource must mention Claude Code');
  check(compatibilityText.includes('core'), 'compatibility resource must mention the core profile');

  const toolCatalog = await client.readResource({ uri: 'chrome-bridge://catalog/tools' });
  const toolCatalogText = resourceText(toolCatalog, 'catalog resource');
  check(toolCatalogText.includes('chrome_bridge_command_catalog'), 'tool guide resource must mention command catalog');
  check(toolCatalogText.includes('chrome_bridge_session_summary'), 'tool guide resource must mention session summary');

  const profile = parseJsonResource(await client.readResource({ uri: 'chrome-bridge://profiles/current' }), 'profile resource');
  check(profile?.profile === 'full', 'default profile resource must report the full MCP profile');
  check(profile?.counts?.total === MCP_TOOLS.length, 'profile resource total tool count must match registry MCP_TOOLS');
  check(profile?.counts?.enabled === MCP_TOOLS.length, 'full profile resource must enable every MCP tool');
  check(Array.isArray(profile?.omittedTools) && profile.omittedTools.length === 0, 'full profile resource must omit no tools');

  const readFirstWorkflow = await client.readResource({ uri: 'chrome-bridge://workflows/read-first' });
  const readFirstText = resourceText(readFirstWorkflow, 'read-first workflow resource');
  check(readFirstText.includes('chrome_bridge_snapshot'), 'read-first workflow resource must mention snapshot');
  check(readFirstText.includes('chrome_bridge_extract'), 'read-first workflow resource must mention extract');

  const debugWorkflow = await client.readResource({ uri: 'chrome-bridge://workflows/debug-bundle' });
  const debugWorkflowText = resourceText(debugWorkflow, 'debug-bundle workflow resource');
  check(debugWorkflowText.includes('chrome_bridge_debug_bundle'), 'debug workflow resource must mention debug bundle');
  check(debugWorkflowText.includes('chrome_bridge_lighthouse_ingest'), 'debug workflow resource must mention lighthouse ingest');
});

await withMcpClient(async (client) => {
  const profile = parseJsonResource(await client.readResource({ uri: 'chrome-bridge://profiles/current' }), 'core profile resource');
  check(profile?.profile === 'core', 'core profile resource must report the core MCP profile');
  check(profile?.counts?.enabled > 0 && profile?.counts?.enabled < MCP_TOOLS.length, 'core profile resource must expose a compact enabled tool count');
  check(Array.isArray(profile?.omittedTools) && profile.omittedTools.includes('chrome_bridge_cookies_list'), 'core profile resource must omit sensitive cookie tools');
}, {
  CHROME_BRIDGE_MCP_TOOL_PROFILE: 'core',
});

if (failures.length) {
  process.stderr.write(failures.map((failure) => `- ${failure}`).join('\n'));
  process.stderr.write('\n');
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({
    ok: true,
    resources: EXPECTED_RESOURCE_URIS.length,
  }, null, 2));
  process.stdout.write('\n');
}
