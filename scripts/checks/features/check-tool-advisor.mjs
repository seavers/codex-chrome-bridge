#!/usr/bin/env node
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliPath = path.join(rootDir, 'bin/chrome-bridge.mjs');
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

async function runCli(args, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: rootDir,
      env: inheritedEnv(env),
      timeout: 5_000,
    });
    return {
      ok: true,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout?.trim?.() || '',
      stderr: error?.stderr?.trim?.() || '',
      error: String(error?.message || error),
    };
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} did not return valid JSON: ${String(error?.message || error)}`);
    return null;
  }
}

async function withMcpClient(fn, env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpPath],
    cwd: rootDir,
    env: inheritedEnv({ CHROME_BRIDGE_SOCKET: '/tmp/chrome-bridge-unavailable.sock', ...env }),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'chrome-bridge-tool-advisor-check', version: '0.1.0' });

  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await client.connect(transport);
    return await fn(client);
  } catch (error) {
    fail(`Tool advisor MCP check failed: ${String(error?.message || error)}${stderr ? `; stderr: ${stderr.slice(0, 500)}` : ''}`);
    return null;
  } finally {
    await client.close().catch(() => {});
  }
}

function parseToolJson(result, label) {
  const text = result?.content?.find((item) => item?.type === 'text')?.text;
  if (!text) {
    fail(`${label} did not return text content`);
    return null;
  }
  return parseJson(text, label);
}

const cliExistingTab = parseJson((await runCli(['advise', '--task', 'already open analytics tab']))?.stdout || '', 'CLI advise existing tab');
check(cliExistingTab?.recommendedFirstTool?.id === 'adoptTab', 'CLI tool advisor should recommend adoptTab for already-open tab workflows');
check(cliExistingTab?.requiredConfirmations?.some((entry) => entry.includes('confirmed=true')), 'CLI tool advisor should mention confirmed=true for adopt-tab workflows');

const cliExtract = parseJson((await runCli(['advise', '--task', 'extract pricing table from current page']))?.stdout || '', 'CLI advise extract');
check(cliExtract?.recommendedFirstTool?.id === 'extract', 'CLI tool advisor should recommend extract for pricing-table tasks');
check(cliExtract?.prompts?.includes('chrome_bridge_extract_structured'), 'CLI tool advisor should link the structured extraction prompt');

const cliSetup = parseJson((await runCli(['advise', '--task', 'configure Cursor MCP setup']))?.stdout || '', 'CLI advise setup');
check(cliSetup?.recommendedFirstTool?.id === 'doctor', 'CLI tool advisor should recommend doctor for setup tasks');
check(cliSetup?.resources?.includes('chrome-bridge://docs/compatibility'), 'CLI tool advisor should link compatibility resource for setup tasks');

await withMcpClient(async (client) => {
  const debugAdvice = parseToolJson(await client.callTool({
    name: 'chrome_bridge_tool_advisor',
    arguments: {
      task: 'debug a slow page after login',
      surface: 'mcp',
    },
  }), 'MCP tool advisor debug');
  check(debugAdvice?.recommendedFirstTool?.id === 'diagnostics', 'MCP tool advisor should recommend diagnostics for debug tasks');
  check(debugAdvice?.prompts?.includes('chrome_bridge_debug_page'), 'MCP tool advisor should link the debug prompt');
});

await withMcpClient(async (client) => {
  const privateAdvice = parseToolJson(await client.callTool({
    name: 'chrome_bridge_tool_advisor',
    arguments: {
      task: 'read cookies for the current site',
      surface: 'mcp',
      client: 'cursor',
    },
  }), 'MCP tool advisor private-read core profile');
  check(privateAdvice?.recommendedFirstTool?.id === 'cookiesList', 'MCP tool advisor should target cookie inspection for cookie tasks');
  check(privateAdvice?.notes?.some((entry) => entry.includes('switch to full')), 'MCP tool advisor should recommend switching to full profile when private tools are omitted');
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
    checks: 4,
  }, null, 2));
  process.stdout.write('\n');
}
