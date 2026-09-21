#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function readRequired(relativePath) {
  try {
    return await fs.readFile(path.join(rootDir, relativePath), 'utf8');
  } catch (error) {
    failures.push(`missing required client config example: ${relativePath}`);
    return null;
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${label} must be valid JSON: ${error?.message || error}`);
    return null;
  }
}

function checkSharedNodeConfig(entry, label) {
  check(entry?.command === 'node', `${label} must use node as the command`);
  check(Array.isArray(entry?.args), `${label} must declare args`);
  check(entry?.args?.[0] === '/absolute/path/to/codex-chrome-bridge/mcp/chrome-bridge-mcp.mjs', `${label} must point at the checked-in MCP server placeholder path`);
}

const files = {
  readme: 'examples/mcp-clients/README.md',
  claude: 'examples/mcp-clients/claude-code.mcp.json',
  cursor: 'examples/mcp-clients/cursor.mcp.json',
  codex: 'examples/mcp-clients/codex.config.toml',
  vscode: 'examples/mcp-clients/vscode.mcp.json',
  windsurf: 'examples/mcp-clients/windsurf.mcp.json',
  hermes: 'examples/mcp-clients/hermes.config.yaml',
  generic: 'examples/mcp-clients/generic.mcp.json',
  docsCompatibility: 'docs/COMPATIBILITY.md',
  docsExamples: 'docs/EXAMPLES.md',
  packageJson: 'package.json',
};

const [
  readme,
  claudeText,
  cursorText,
  codexText,
  vscodeText,
  windsurfText,
  hermesText,
  genericText,
  compatibilityText,
  examplesDocText,
  packageText,
] = await Promise.all(Object.values(files).map((file) => readRequired(file)));

check(readme?.includes('Replace `/absolute/path/to/codex-chrome-bridge`'), 'client config examples README must explain the placeholder path');
check(readme?.includes('mcp-config'), 'client config examples README must point back to mcp-config');
check(readme?.includes('advise --task'), 'client config examples README must point back to the advisor flow');

const claude = parseJson(claudeText, 'claude-code.mcp.json');
const cursor = parseJson(cursorText, 'cursor.mcp.json');
const vscode = parseJson(vscodeText, 'vscode.mcp.json');
const windsurf = parseJson(windsurfText, 'windsurf.mcp.json');
const generic = parseJson(genericText, 'generic.mcp.json');
const packageJson = parseJson(packageText, 'package.json');

checkSharedNodeConfig(claude?.mcpServers?.['chrome-bridge'], 'claude-code.mcp.json');
checkSharedNodeConfig(cursor?.mcpServers?.['chrome-bridge'], 'cursor.mcp.json');
checkSharedNodeConfig(windsurf?.mcpServers?.['chrome-bridge'], 'windsurf.mcp.json');
checkSharedNodeConfig(generic?.mcpServers?.['chrome-bridge'], 'generic.mcp.json');
checkSharedNodeConfig(vscode?.servers?.chromeBridge, 'vscode.mcp.json');
check(vscode?.servers?.chromeBridge?.type === 'stdio', 'vscode.mcp.json must use stdio server type');

check(cursor?.mcpServers?.['chrome-bridge']?.env?.CHROME_BRIDGE_MCP_TOOL_PROFILE === 'core', 'cursor.mcp.json must default to the core profile');
check(windsurf?.mcpServers?.['chrome-bridge']?.env?.CHROME_BRIDGE_MCP_TOOL_PROFILE === 'core', 'windsurf.mcp.json must default to the core profile');
check(generic?.mcpServers?.['chrome-bridge']?.env?.CHROME_BRIDGE_MCP_TOOL_PROFILE === 'read', 'generic.mcp.json must default to the read profile');
check(!claude?.mcpServers?.['chrome-bridge']?.env?.CHROME_BRIDGE_MCP_TOOL_PROFILE, 'claude-code.mcp.json must stay on the implicit full profile');

check(codexText?.includes('[mcp_servers.codex-chrome-bridge]'), 'codex.config.toml must define the codex-chrome-bridge MCP server');
check(codexText?.includes('command = "node"'), 'codex.config.toml must use node as the command');
check(codexText?.includes('/absolute/path/to/codex-chrome-bridge/mcp/chrome-bridge-mcp.mjs'), 'codex.config.toml must point at the checked-in MCP server placeholder path');
check(codexText?.includes('startup_timeout_sec = 20'), 'codex.config.toml must keep the startup timeout');
check(codexText?.includes('tool_timeout_sec = 60'), 'codex.config.toml must keep the tool timeout');

check(hermesText?.includes('mcp_servers:'), 'hermes.config.yaml must define mcp_servers');
check(hermesText?.includes('chrome_bridge:'), 'hermes.config.yaml must define the chrome_bridge server');
check(hermesText?.includes('command: "node"'), 'hermes.config.yaml must use node as the command');
check(hermesText?.includes('/absolute/path/to/codex-chrome-bridge/mcp/chrome-bridge-mcp.mjs'), 'hermes.config.yaml must point at the checked-in MCP server placeholder path');

check(compatibilityText?.includes('examples/mcp-clients/'), 'docs/COMPATIBILITY.md must mention the checked-in client config examples');
check(examplesDocText?.includes('MCP Client Config Files'), 'docs/EXAMPLES.md must include the client config examples section');
check(packageJson?.scripts?.['check:client-config-examples'] === 'node ./scripts/docs/check-client-config-examples.mjs', 'package.json must expose check:client-config-examples');
check(packageJson?.scripts?.check?.includes('npm run check:client-config-examples'), 'npm run check must include check:client-config-examples');

if (failures.length) {
  process.stdout.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  checkedFiles: 8,
}, null, 2)}\n`);
