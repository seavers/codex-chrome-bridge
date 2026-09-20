#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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
  const client = new Client({ name: 'chrome-bridge-mcp-prompts-check', version: '0.1.0' });

  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await client.connect(transport);
    return await fn(client);
  } catch (error) {
    fail(`MCP prompts check failed: ${String(error?.message || error)}${stderr ? `; stderr: ${stderr.slice(0, 500)}` : ''}`);
    return null;
  } finally {
    await client.close().catch(() => {});
  }
}

function promptText(result, label) {
  const textBlocks = (result?.messages || [])
    .filter((message) => message?.content?.type === 'text')
    .map((message) => message.content.text);
  if (!textBlocks.length) {
    fail(`${label} did not return any text prompt messages`);
    return '';
  }
  return textBlocks.join('\n');
}

const EXPECTED_PROMPTS = [
  'chrome_bridge_read_first',
  'chrome_bridge_existing_tab',
  'chrome_bridge_debug_page',
  'chrome_bridge_extract_structured',
  'chrome_bridge_safe_interaction',
  'chrome_bridge_release_smoke',
];

await withMcpClient(async (client) => {
  const promptList = await client.listPrompts();
  const promptNames = new Set((promptList.prompts || []).map((prompt) => prompt.name));
  check(promptNames.size === EXPECTED_PROMPTS.length, 'MCP prompt count must match the expected Chrome Bridge prompt set');
  for (const name of EXPECTED_PROMPTS) {
    check(promptNames.has(name), `MCP prompts/list is missing expected prompt: ${name}`);
  }

  const readFirst = await client.getPrompt({
    name: 'chrome_bridge_read_first',
    arguments: {
      goal: 'inspect pricing without mutation',
    },
  });
  const readFirstText = promptText(readFirst, 'chrome_bridge_read_first');
  check(readFirstText.includes('chrome_bridge_health'), 'read_first prompt must start with health');
  check(readFirstText.includes('chrome_bridge_observe'), 'read_first prompt must recommend observe');
  check(readFirstText.includes('chrome_bridge_extract'), 'read_first prompt must recommend structured extraction');

  const existingTab = await client.getPrompt({
    name: 'chrome_bridge_existing_tab',
    arguments: {
      pageHint: 'already open analytics dashboard',
    },
  });
  const existingTabText = promptText(existingTab, 'chrome_bridge_existing_tab');
  check(existingTabText.includes('chrome_bridge_adopt_tab'), 'existing_tab prompt must recommend adopt_tab');
  check(existingTabText.includes('confirmed=true'), 'existing_tab prompt must mention confirmation');

  const debugPage = await client.getPrompt({
    name: 'chrome_bridge_debug_page',
    arguments: {
      suspectedIssue: 'page feels slow after login',
    },
  });
  const debugText = promptText(debugPage, 'chrome_bridge_debug_page');
  check(debugText.includes('chrome_bridge_diagnostics'), 'debug_page prompt must recommend diagnostics');
  check(debugText.includes('chrome_bridge_debug_bundle'), 'debug_page prompt must recommend debug_bundle');
  check(debugText.includes('chrome_bridge_lighthouse_ingest'), 'debug_page prompt must recommend lighthouse ingest');

  const extractStructured = await client.getPrompt({
    name: 'chrome_bridge_extract_structured',
    arguments: {
      preset: 'pricing-table',
    },
  });
  const extractText = promptText(extractStructured, 'chrome_bridge_extract_structured');
  check(extractText.includes('pricing-table'), 'extract_structured prompt must echo the requested preset');
  check(extractText.includes('chrome_bridge_extract'), 'extract_structured prompt must recommend extract');

  const safeInteraction = await client.getPrompt({
    name: 'chrome_bridge_safe_interaction',
    arguments: {
      intent: 'click the export button',
    },
  });
  const interactionText = promptText(safeInteraction, 'chrome_bridge_safe_interaction');
  check(interactionText.includes('confirmed=true'), 'safe_interaction prompt must mention confirmed=true');
  check(interactionText.includes('chrome_bridge_find_elements'), 'safe_interaction prompt must recommend pre-click discovery');

  const releaseSmoke = await client.getPrompt({
    name: 'chrome_bridge_release_smoke',
    arguments: {},
  });
  const smokeText = promptText(releaseSmoke, 'chrome_bridge_release_smoke');
  check(smokeText.includes('coveragePlan=true'), 'release_smoke prompt must mention coveragePlan=true');
  check(smokeText.includes('verification.status="passed"'), 'release_smoke prompt must mention passed verification');
});

if (failures.length) {
  process.stderr.write(failures.map((failure) => `- ${failure}`).join('\n'));
  process.stderr.write('\n');
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({
    ok: true,
    prompts: EXPECTED_PROMPTS.length,
  }, null, 2));
  process.stdout.write('\n');
}
