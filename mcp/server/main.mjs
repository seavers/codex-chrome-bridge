import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  BRIDGE_VERSION,
  HTTP_METHODS,
  MCP_TOOLS,
  NETWORK_EMULATION_PROFILES,
  TAB_GROUP_COLORS,
  commandCatalog,
  commandDefaultTimeoutMs,
} from '../../shared/command-registry.mjs';
import { buildCpaOfferExtraction } from '../../shared/cpa-offer-extract.mjs';
import { buildStructuredPresetExtraction } from '../../shared/structured-extract.mjs';
import { buildDownloadDiscovery } from '../../shared/download-discovery.mjs';
import { ingestLighthouseReportFile } from '../../shared/lighthouse-ingest.mjs';
import { buildLighthousePlan } from '../../shared/lighthouse-plan.mjs';
import { buildNetworkExport } from '../../shared/network-export.mjs';
import { summarizeDiagnosticsOutput } from '../../shared/diagnostics-output.mjs';
import { buildToolAdvisor } from '../../shared/tool-advisor.mjs';
import { appendActionRecording, summarizeActionRecording } from '../../shared/action-recording.mjs';
import { buildPageSearch } from '../../shared/page-search.mjs';
import { formatReadOutput } from '../../shared/output-envelope.mjs';
import { withSessionGroupTitle } from '../../shared/session-group-title.mjs';
import { bridgeSocketPath, nativeBridgeCommand, nativeBridgeHealth } from '../../shared/native-bridge.mjs';

const BRIDGE_TRANSPORT = 'native-messaging+unix-socket';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const execFileAsync = promisify(execFile);

function configuredChromeProfileId() {
  const value = process.env.CHROME_BRIDGE_PROFILE_ID;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function withConfiguredChromeProfile(payload = {}) {
  const profileId = configuredChromeProfileId();
  if (!profileId || payload.profileId !== undefined) return payload;
  return { ...payload, profileId };
}

function hasAllowedUrlProtocol(value, allowedProtocols) {
  try {
    const parsed = new URL(value);
    return allowedProtocols.includes(parsed.protocol)
      && (parsed.protocol !== 'about:' || parsed.href === 'about:blank');
  } catch {
    return false;
  }
}

const navigationUrlSchema = z.string().refine(
  (value) => hasAllowedUrlProtocol(value, ['http:', 'https:', 'about:']),
  'URL must use http:, https:, or about:blank',
);

const webUrlSchema = z.string().refine(
  (value) => hasAllowedUrlProtocol(value, ['http:', 'https:']),
  'URL must use http: or https:',
);

const chromeIdSchema = z.number().int().nonnegative();
const payloadTimeoutSchema = z.number().min(0).max(300000);
const timestampSchema = z.number().min(0).max(Number.MAX_SAFE_INTEGER);
const selectIndexSchema = z.number().int().nonnegative();
const readOutputSchema = {
  out: z.string().optional(),
  artifactDir: z.string().optional(),
  summaryOnly: z.boolean().optional(),
  noContent: z.boolean().optional(),
  includeContent: z.boolean().optional(),
  maxInlineChars: z.number().int().min(0).max(500000).optional(),
};
const fullPageReadSchema = {
  fullPage: z.boolean().optional(),
  waitForText: z.string().optional(),
  waitForPattern: z.string().optional(),
  scrollStepPx: z.number().min(100).max(5000).optional(),
  maxScrollSteps: z.number().int().min(1).max(200).optional(),
  scrollDelayMs: z.number().min(0).max(2000).optional(),
};

async function bridgeFetch(pathname, options = {}, timeoutMs = 30_000) {
  if (pathname === '/health') return nativeBridgeHealth(timeoutMs);
  if (pathname !== '/command') throw new Error(`Unsupported native bridge path: ${pathname}`);
  let body;
  try { body = JSON.parse(options.body || '{}'); } catch { throw new Error('Invalid bridge command body'); }
  return nativeBridgeCommand(body.action, body.payload || {}, timeoutMs);
}

async function bridgeCommand(action, payload = {}, timeoutMs) {
  const effectiveTimeoutMs = timeoutMs ?? commandDefaultTimeoutMs(action);
  const scopedPayload = withSessionGroupTitle(action, payload);
  const routedPayload = withConfiguredChromeProfile(scopedPayload);
  try {
    const json = await bridgeFetch('/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, payload: routedPayload, timeoutMs: effectiveTimeoutMs }),
    }, effectiveTimeoutMs);
    await appendActionRecording({ action, payload: routedPayload, timeoutMs: effectiveTimeoutMs, ok: true, result: json.result })
      .catch(() => {});
    return json.result;
  } catch (error) {
    await appendActionRecording({ action, payload: routedPayload, timeoutMs: effectiveTimeoutMs, ok: false, error })
      .catch(() => {});
    throw error;
  }
}

function textResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function readOutputOptions(args = {}) {
  return {
    out: args.out,
    artifactDir: args.artifactDir,
    summaryOnly: Boolean(args.summaryOnly),
    noContent: Boolean(args.noContent),
    includeContent: Boolean(args.includeContent),
    maxInlineChars: args.maxInlineChars,
  };
}

function requireSelectTarget(args = {}) {
  if (args.value === undefined && args.label === undefined && args.index === undefined) {
    throw new Error('select requires value, label, or index');
  }
}

function requireElementTarget(args = {}, toolName = 'tool') {
  if (!args.selector && !args.elementRef) {
    throw new Error(`${toolName} requires selector or elementRef`);
  }
}

function parseLocalCliJson(stdout) {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function localCliText(command, args = []) {
  const result = await execFileAsync(process.execPath, [
    path.join(rootDir, 'bin/chrome-bridge.mjs'),
    command,
    ...args,
  ], { timeout: 5_000 });
  return result.stdout.trimEnd();
}

async function localSelfTest() {
  try {
    const result = await execFileAsync(process.execPath, [
      path.join(rootDir, 'bin/chrome-bridge.mjs'),
      'self-test',
    ], { timeout: 10_000 });
    return parseLocalCliJson(result.stdout) || {};
  } catch (error) {
    const parsed = parseLocalCliJson(error?.stdout);
    if (parsed) {
      return {
        ...parsed,
        cliExitError: String(error?.message || error),
        stderr: error?.stderr || '',
      };
    }

    return {
      ok: false,
      error: String(error?.message || error),
      stdout: error?.stdout || '',
      stderr: error?.stderr || '',
    };
  }
}

async function localDoctor(args = {}) {
  try {
    const cliArgs = [
      path.join(rootDir, 'bin/chrome-bridge.mjs'),
      'doctor',
    ];
    if (args.liveChecks) cliArgs.push('--live-checks');
    const result = await execFileAsync(process.execPath, cliArgs, { timeout: 10_000 });
    return parseLocalCliJson(result.stdout) || {};
  } catch (error) {
    const parsed = parseLocalCliJson(error?.stdout);
    if (parsed) {
      return {
        ...parsed,
        cliExitError: String(error?.message || error),
        stderr: error?.stderr || '',
      };
    }

    return {
      ok: false,
      error: String(error?.message || error),
      stdout: error?.stdout || '',
      stderr: error?.stderr || '',
    };
  }
}

async function localRuntimeSmoke(args = {}) {
  try {
    const cliArgs = [
      path.join(rootDir, 'bin/chrome-bridge.mjs'),
      'runtime-smoke',
    ];
    if (args.keepTab) cliArgs.push('--keep-tab');
    if (args.coveragePlan) cliArgs.push('--coverage-plan');
    if (args.summaryOnly) cliArgs.push('--summary-only');
    if (args.out) cliArgs.push('--out', args.out);
    const result = await execFileAsync(process.execPath, cliArgs, { timeout: 180_000 });
    return parseLocalCliJson(result.stdout) || {};
  } catch (error) {
    const parsed = parseLocalCliJson(error?.stdout);
    if (parsed) {
      return {
        ...parsed,
        cliExitError: String(error?.message || error),
        stderr: error?.stderr || '',
      };
    }

    return {
      ok: false,
      error: String(error?.message || error),
      stdout: error?.stdout || '',
      stderr: error?.stderr || '',
    };
  }
}

async function localActPreview(args = {}) {
  try {
    const cliArgs = [
      path.join(rootDir, 'bin/chrome-bridge.mjs'),
      'act-preview',
      '--intent',
      args.intent,
    ];
    if (args.tabId !== undefined) cliArgs.push('--tab', String(args.tabId));
    if (args.maxCandidates !== undefined) cliArgs.push('--max-candidates', String(args.maxCandidates));
    if (args.riskTolerance) cliArgs.push('--risk', args.riskTolerance);
    if (args.selectorPreference) cliArgs.push('--selector-preference', args.selectorPreference);
    if (args.allowExternal) cliArgs.push('--allow-external');
    const result = await execFileAsync(process.execPath, cliArgs, { timeout: 30_000 });
    return parseLocalCliJson(result.stdout) || {};
  } catch (error) {
    const parsed = parseLocalCliJson(error?.stdout);
    if (parsed) {
      return {
        ...parsed,
        cliExitError: String(error?.message || error),
        stderr: error?.stderr || '',
      };
    }
    return {
      ok: false,
      error: String(error?.message || error),
      stdout: error?.stdout || '',
      stderr: error?.stderr || '',
    };
  }
}

async function localActApply(args = {}) {
  try {
    const cliArgs = [
      path.join(rootDir, 'bin/chrome-bridge.mjs'),
      'act-apply',
      '--preview-id',
      args.previewId,
      '--confirm',
    ];
    if (args.text !== undefined) cliArgs.push('--text', args.text);
    if (args.value !== undefined) cliArgs.push('--value', args.value);
    if (args.label !== undefined) cliArgs.push('--label', args.label);
    if (args.index !== undefined) cliArgs.push('--index', String(args.index));
    const result = await execFileAsync(process.execPath, cliArgs, { timeout: 30_000 });
    return parseLocalCliJson(result.stdout) || {};
  } catch (error) {
    const parsed = parseLocalCliJson(error?.stdout);
    if (parsed) {
      return {
        ...parsed,
        cliExitError: String(error?.message || error),
        stderr: error?.stderr || '',
      };
    }
    return {
      ok: false,
      error: String(error?.message || error),
      stdout: error?.stdout || '',
      stderr: error?.stderr || '',
    };
  }
}

async function sessionSummary() {
  const health = await bridgeFetch('/health').catch((error) => ({
    ok: false,
    code: error.code || null,
    error: String(error?.message || error),
  }));
  const group = await bridgeCommand('group', {}, 10_000).catch((error) => ({
    ok: false,
    code: error.code || null,
    error: String(error?.message || error),
  }));
  const workspace = await bridgeCommand('workspace', { includeTabs: true }, 10_000).catch((error) => ({
    ok: false,
    code: error.code || null,
    error: String(error?.message || error),
  }));
  return {
    generatedAt: new Date().toISOString(),
    bridgeTransport: BRIDGE_TRANSPORT,
    socketPath: bridgeSocketPath(),
    health,
    workspace,
    group,
    mcpProfile: currentMcpProfileSummary(),
    nextActions: summaryNextActions(health, group, workspace),
    recommendations: summaryRecommendations(health, group, workspace),
  };
}

function summaryRecommendations(health, group, workspace) {
  const recommendations = [];
  const bridgeVersion = health?.bridge?.version || health?.extension?.info?.version;
  const extensionVersion = health?.extension?.info?.version;
  const policyMode = workspace?.policy?.mode || workspace?.workspace?.policyMode;
  if (bridgeVersion && bridgeVersion !== BRIDGE_VERSION) {
    recommendations.push(`Restart the Native Messaging Host; expected ${BRIDGE_VERSION}, got ${bridgeVersion}.`);
  }
  if (extensionVersion && extensionVersion !== BRIDGE_VERSION) {
    recommendations.push(`Reload the unpacked extension; expected ${BRIDGE_VERSION}, got ${extensionVersion}.`);
  }
  if (!health?.extension?.connected) {
    recommendations.push('Load or reload the unpacked Chrome extension.');
  }
  if ((workspace?.counts?.tabs === 0) || (group?.tabs && !group.tabs.length)) {
    recommendations.push('Run ensure-tab, open, or adopt-tab before browser work.');
  }
  if (policyMode === 'strict') {
    recommendations.push('Strict workspace policy is active; outside tabs are blocked even with allowExternal.');
  }
  return recommendations;
}

function summaryNextActions(health, group, workspace) {
  const actions = [];
  const bridgeVersion = health?.bridge?.version || health?.extension?.info?.version;
  const extensionVersion = health?.extension?.info?.version;
  const extensionConnected = Boolean(health?.extension?.connected);
  const policyMode = workspace?.policy?.mode || workspace?.workspace?.policyMode;
  const hasScopedTabs = Boolean((workspace?.counts?.tabs > 0) || (Array.isArray(group?.tabs) && group.tabs.length));

  if (bridgeVersion && bridgeVersion !== BRIDGE_VERSION) {
    actions.push('Restart the Native Messaging Host, then rerun chrome_bridge_doctor with liveChecks=true.');
    return actions;
  }
  if (extensionVersion && extensionVersion !== BRIDGE_VERSION) {
    actions.push('Run chrome_bridge_reload_extension with confirmed=true, then rerun chrome_bridge_doctor with liveChecks=true.');
    return actions;
  }
  if (!extensionConnected) {
    actions.push('Load or reload the unpacked Chrome MCP Bridge extension in chrome://extensions/.');
    actions.push('After that, run chrome_bridge_health and confirm extension.connected is true.');
    return actions;
  }
  if (!hasScopedTabs) {
    actions.push('Run chrome_bridge_ensure_tab or chrome_bridge_adopt_tab with confirmed=true before browser work.');
  } else {
    actions.push('Start with chrome_bridge_observe or chrome_bridge_snapshot before any interaction.');
  }
  if (policyMode === 'strict') {
    actions.push('Strict workspace policy is active, so keep work inside the scoped group or change the workspace policy first.');
  }
  actions.push('If the next tool is unclear, call chrome_bridge_tool_advisor with the current task.');
  return actions;
}

async function writeDataUrlFile(filePath, dataUrl, expectedPrefix) {
  const match = new RegExp(`^${expectedPrefix},(.+)$`).exec(dataUrl || '');
  if (!match) throw new Error(`Invalid data URL for ${filePath}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(match[1], 'base64'));
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const DEBUG_BUNDLE_REDACTED_KEYS = new Set([
  'url',
  'href',
  'title',
  'text',
  'label',
  'value',
  'values',
  'dataUrl',
  'favIconUrl',
]);

function redactDebugBundleValue(value) {
  if (Array.isArray(value)) return value.map((item) => redactDebugBundleValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    DEBUG_BUNDLE_REDACTED_KEYS.has(key) ? '[redacted]' : redactDebugBundleValue(entry),
  ]));
}

async function debugBundle(args = {}) {
  const outputDir = path.resolve(args.out);
  const target = {
    tabId: args.tabId,
    allowExternal: args.allowExternal,
  };
  const createdAt = new Date().toISOString();
  const includeSnapshot = Boolean(args.includeSnapshot);
  const includeObserve = Boolean(args.includeObserve);
  const includeScreenshot = Boolean(args.includeScreenshot);
  const includeTraceEvents = Boolean(args.includeTraceEvents);
  const manifest = {
    createdAt,
    bridgeTransport: BRIDGE_TRANSPORT,
    socketPath: bridgeSocketPath(),
    files: [],
    privacy: {
      mode: 'redacted',
      note: 'Bundle redacts URL/title/text/value fields and excludes cookie values, storage values, request bodies, credentialed requests, page artifacts, and full trace events unless explicitly requested.',
      pageArtifacts: {
        snapshot: includeSnapshot ? 'included' : 'omitted-by-default',
        observe: includeObserve ? 'included' : 'omitted-by-default',
        screenshot: includeScreenshot ? 'included' : 'omitted-by-default',
      },
      traceEvents: includeTraceEvents ? 'included' : 'summarized-by-default',
    },
  };

  const addJson = async (name, value, options = {}) => {
    const output = options.redact === false ? value : redactDebugBundleValue(value);
    await writeJsonFile(path.join(outputDir, name), output);
    manifest.files.push(name);
    return output;
  };

  const summary = await sessionSummary();
  await addJson('session-summary.json', redactDebugBundleValue(summary));
  await addJson('health.json', redactDebugBundleValue(summary.health));
  if (includeSnapshot) {
    await addJson('snapshot.json', await bridgeCommand('snapshot', { ...target, maxChars: 50_000 }, 30_000).catch((error) => ({
      ok: false,
      code: error.code || null,
      error: String(error?.message || error),
    })), { redact: false });
  }
  if (includeObserve) {
    await addJson('observe.json', await bridgeCommand('observe', { ...target, limit: 100 }, 30_000).catch((error) => ({
      ok: false,
      code: error.code || null,
      error: String(error?.message || error),
    })), { redact: false });
  }
  const trace = await bridgeCommand('traceSummary', target, 30_000).catch((error) => ({
    ok: false,
    code: error.code || null,
    error: String(error?.message || error),
  }));
  await addJson('trace-summary.json', trace);
  if (includeTraceEvents) {
    const traceEvents = await bridgeCommand('traceEvents', { ...target, limit: 200 }, 30_000).catch((error) => ({
      ok: false,
      code: error.code || null,
      error: String(error?.message || error),
    }));
    await addJson('trace-events.json', traceEvents, { redact: false });
  }

  if (includeScreenshot) {
    const screenshot = await bridgeCommand('screenshot', target, 30_000).catch((error) => ({
      ok: false,
      code: error.code || null,
      error: String(error?.message || error),
    }));
    if (screenshot?.dataUrl) {
      await writeDataUrlFile(path.join(outputDir, 'screenshot.png'), screenshot.dataUrl, 'data:image\\/png;base64');
      manifest.files.push('screenshot.png');
      await addJson('screenshot.json', { ...screenshot, dataUrl: undefined });
    } else {
      await addJson('screenshot.json', screenshot);
    }
  }

  await addJson('manifest.json', manifest);
  return {
    ok: true,
    out: outputDir,
    files: manifest.files,
    createdAt,
  };
}

async function diagnostics(args = {}) {
  const result = await bridgeCommand('diagnostics', {
    tabId: args.tabId,
    allowExternal: args.allowExternal,
  }, 30_000);
  const artifactPath = args.out ? path.resolve(args.out) : null;
  if (artifactPath) {
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  return summarizeDiagnosticsOutput(result, { artifactPath });
}

const server = new McpServer({
  name: 'chrome-mcp-bridge',
  version: BRIDGE_VERSION,
});

const MCP_TOOL_PROFILES = Object.freeze({
  full: null,
  core: new Set([
    'chrome_bridge_health',
    'chrome_bridge_runtime_smoke',
    'chrome_bridge_doctor',
    'chrome_bridge_extension_path',
    'chrome_bridge_mcp_config',
    'chrome_bridge_command_catalog',
    'chrome_bridge_tool_advisor',
    'chrome_bridge_windows',
    'chrome_bridge_tabs',
    'chrome_bridge_group',
    'chrome_bridge_workspace',
    'chrome_bridge_ensure_tab',
    'chrome_bridge_adopt_tab',
    'chrome_bridge_open',
    'chrome_bridge_activate_tab',
    'chrome_bridge_close_tab',
    'chrome_bridge_close_group',
    'chrome_bridge_wait_for_selector',
    'chrome_bridge_observe',
    'chrome_bridge_find_elements',
    'chrome_bridge_extract',
    'chrome_bridge_download_discovery',
    'chrome_bridge_download',
    'chrome_bridge_snapshot',
    'chrome_bridge_text',
    'chrome_bridge_html',
    'chrome_bridge_screenshot',
    'chrome_bridge_pdf',
    'chrome_bridge_diagnostics',
    'chrome_bridge_click_at',
    'chrome_bridge_click',
    'chrome_bridge_type',
    'chrome_bridge_press',
    'chrome_bridge_select',
    'chrome_bridge_select_options',
    'chrome_bridge_fill_form',
    'chrome_bridge_scroll',
    'chrome_bridge_ask_user',
    'chrome_bridge_session_summary',
    'chrome_bridge_lighthouse_ingest',
  ]),
  read: new Set([
    'chrome_bridge_health',
    'chrome_bridge_doctor',
    'chrome_bridge_extension_path',
    'chrome_bridge_mcp_config',
    'chrome_bridge_command_catalog',
    'chrome_bridge_tool_advisor',
    'chrome_bridge_windows',
    'chrome_bridge_tabs',
    'chrome_bridge_group',
    'chrome_bridge_workspace',
    'chrome_bridge_ensure_tab',
    'chrome_bridge_adopt_tab',
    'chrome_bridge_open',
    'chrome_bridge_wait_for_selector',
    'chrome_bridge_observe',
    'chrome_bridge_find_elements',
    'chrome_bridge_extract',
    'chrome_bridge_download_discovery',
    'chrome_bridge_snapshot',
    'chrome_bridge_text',
    'chrome_bridge_html',
    'chrome_bridge_screenshot',
    'chrome_bridge_pdf',
    'chrome_bridge_diagnostics',
    'chrome_bridge_ask_user',
    'chrome_bridge_session_summary',
    'chrome_bridge_debug_bundle',
    'chrome_bridge_lighthouse_ingest',
  ]),
});

function normalizeMcpToolProfile(value) {
  const profile = String(value || 'full').toLowerCase();
  return Object.prototype.hasOwnProperty.call(MCP_TOOL_PROFILES, profile) ? profile : 'full';
}

const mcpToolProfile = normalizeMcpToolProfile(process.env.CHROME_BRIDGE_MCP_TOOL_PROFILE);
const enabledMcpTools = MCP_TOOL_PROFILES[mcpToolProfile];
const registerTool = server.tool.bind(server);
server.tool = (name, ...args) => {
  if (enabledMcpTools && !enabledMcpTools.has(name)) return undefined;
  return registerTool(name, ...args);
};

const MCP_TOOL_PROFILE_DESCRIPTIONS = Object.freeze({
  full: 'Full MCP tool surface for local-first clients that can handle the entire browser and diagnostics set.',
  core: 'Compact MCP tool surface for IDE agents; keeps high-value browser tools while omitting sensitive private-browser tools by default.',
  read: 'Read-mostly MCP tool surface for conservative clients that should inspect and export before mutating.',
});

function currentMcpProfileSummary() {
  const enabledTools = enabledMcpTools ? MCP_TOOLS.filter((name) => enabledMcpTools.has(name)) : [...MCP_TOOLS];
  const omittedTools = enabledMcpTools ? MCP_TOOLS.filter((name) => !enabledMcpTools.has(name)) : [];
  return {
    profile: mcpToolProfile,
    description: MCP_TOOL_PROFILE_DESCRIPTIONS[mcpToolProfile],
    enabledTools,
    omittedTools,
    counts: {
      enabled: enabledTools.length,
      omitted: omittedTools.length,
      total: MCP_TOOLS.length,
    },
  };
}

function markdownResource(uri, text) {
  return {
    contents: [
      {
        uri,
        mimeType: 'text/markdown',
        text,
      },
    ],
  };
}

function jsonResource(uri, value) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: `${JSON.stringify(value, null, 2)}\n`,
      },
    ],
  };
}

function quickstartResourceText() {
  return [
    '# Chrome MCP Bridge Quickstart',
    '',
    '1. Load the unpacked Chrome extension from `extension/`.',
    '2. Install the Native Messaging Host with `npm run install:native-host -- <extension-id>`; no bridge daemon is required.',
    '3. Configure your MCP client with `chrome-bridge mcp-config` or `chrome_bridge_mcp_config`.',
    '4. Start every workflow with `chrome_bridge_health` and `chrome_bridge_workspace`.',
    '5. If the target page is already open, ask the user to focus it and use `chrome_bridge_adopt_tab` with `confirmed: true`.',
    '6. Prefer read-first tools before interaction: `chrome_bridge_snapshot`, `chrome_bridge_text`, `chrome_bridge_observe`, `chrome_bridge_find_elements`, `chrome_bridge_extract`.',
    '7. Use interaction tools only after explicit user approval for the exact action.',
    '',
    'When another session is using the live bridge, prefer `chrome_bridge_doctor`, `chrome_bridge_command_catalog`, and `chrome_bridge_runtime_smoke` with `coveragePlan: true`.',
  ].join('\n');
}

function safetyResourceText() {
  return [
    '# Chrome MCP Bridge Safety',
    '',
    '- The bridge controls a real logged-in Chrome profile on the local machine.',
    '- Default scope is all Chrome tabs; explicit `scoped` or `strict` workspace policy can restore group boundaries.',
    '- Inventory reads like `tabs` and `windows` are all-tabs by default; pass `includeAll: false` with a group scope to limit the result.',
    '- Mutating tools require `confirmed: true`.',
    '- Private browser reads such as cookies, storage values, and credentialed requests require `confirmSensitive: true` in addition to `confirmed: true`.',
    '- Large or sensitive outputs should go to local artifacts instead of inline MCP text.',
    '- Do not use the bridge for CAPTCHA bypass, stealth automation, proxy rotation, credential extraction, or unattended private-account mutation.',
  ].join('\n');
}

function compatibilityResourceText() {
  return [
    '# MCP Client Compatibility',
    '',
    'Supported local stdio clients include Claude Code, Cursor, Codex, VS Code, Windsurf/Cascade, Hermes Agent, and generic MCP clients.',
    '',
    'Fast path:',
    '',
    '- `chrome_bridge_mcp_config` from MCP',
    '- `chrome-bridge mcp-config` from CLI',
    '',
    'Profile guidance:',
    '',
    '- `full`: broad local harnesses and clients that can handle the full surface',
    '- `core`: compact IDE profile for Cursor and Windsurf',
    '- `read`: conservative read-mostly profile',
    '',
    'If a client warns about too many tools, switch to `CHROME_BRIDGE_MCP_TOOL_PROFILE=core` first.',
  ].join('\n');
}

function toolCatalogResourceText() {
  const profile = currentMcpProfileSummary();
  return [
    '# Chrome MCP Bridge Tool Guide',
    '',
    `Active MCP profile: \`${profile.profile}\``,
    '',
    profile.description,
    '',
    `Enabled tools: ${profile.counts.enabled}/${profile.counts.total}`,
    `Omitted tools: ${profile.counts.omitted}`,
    '',
    'Recommended local diagnostics:',
    '',
    '- `chrome_bridge_health`',
    '- `chrome_bridge_doctor`',
    '- `chrome_bridge_command_catalog`',
    '- `chrome_bridge_mcp_config`',
    '- `chrome_bridge_session_summary`',
    '',
    'Recommended read-first browser tools:',
    '',
    '- `chrome_bridge_workspace`',
    '- `chrome_bridge_group`',
    '- `chrome_bridge_tabs`',
    '- `chrome_bridge_observe`',
    '- `chrome_bridge_find_elements`',
    '- `chrome_bridge_extract`',
    '- `chrome_bridge_snapshot`',
    '- `chrome_bridge_text`',
    '',
    'Recommended artifact/debug tools:',
    '',
    '- `chrome_bridge_screenshot`',
    '- `chrome_bridge_pdf`',
    '- `chrome_bridge_diagnostics`',
    '- `chrome_bridge_debug_bundle`',
    '- `chrome_bridge_lighthouse_ingest`',
    '',
    'Use `chrome_bridge_command_catalog` when the agent needs the full local contract, risk tiers, default timeouts, CLI aliases, or confirmation metadata.',
  ].join('\n');
}

function readFirstWorkflowText() {
  return [
    '# Read-First Workflow',
    '',
    '1. Call `chrome_bridge_health`.',
    '2. Call `chrome_bridge_workspace` and note policy mode.',
    '3. If the page is already open, ask the user to focus it and call `chrome_bridge_adopt_tab` with `confirmed: true`.',
    '4. Otherwise use `chrome_bridge_ensure_tab` and `chrome_bridge_open`.',
    '5. Inspect the page with `chrome_bridge_snapshot` or `chrome_bridge_text`.',
    '6. Use `chrome_bridge_observe` to get ranked actionable elements.',
    '7. Narrow with `chrome_bridge_find_elements` or `chrome_bridge_extract` before proposing any mutation.',
    '8. Ask for confirmation before click, type, select, upload, dialog, or private-data reads.',
  ].join('\n');
}

function debugBundleWorkflowText() {
  return [
    '# Debug Bundle Workflow',
    '',
    '1. Start with `chrome_bridge_session_summary` to confirm bridge state and workspace policy.',
    '2. Use `chrome_bridge_diagnostics` for bounded performance/resource hints.',
    '3. Use `chrome_bridge_debug_bundle` with only the minimum required include flags.',
    '4. Keep page artifacts local; default debug bundles should stay redacted.',
    '5. If the issue is performance-specific, ingest a local Lighthouse report with `chrome_bridge_lighthouse_ingest`.',
    '6. Prefer `chrome_bridge_trace_summary` and `chrome_bridge_diagnostics` before requesting heavier evidence.',
  ].join('\n');
}

function promptTextResult(text, description) {
  return {
    description,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text,
        },
      },
    ],
  };
}

server.resource(
  'quickstart-doc',
  'chrome-bridge://docs/quickstart',
  {
    title: 'Quickstart',
    description: 'Compact quickstart for loading the extension, starting the bridge, and beginning a safe browser workflow.',
    mimeType: 'text/markdown',
  },
  async (uri) => markdownResource(uri.toString(), quickstartResourceText()),
);

server.resource(
  'safety-doc',
  'chrome-bridge://docs/safety',
  {
    title: 'Safety',
    description: 'Compact safety boundary for real-profile local Chrome automation.',
    mimeType: 'text/markdown',
  },
  async (uri) => markdownResource(uri.toString(), safetyResourceText()),
);

server.resource(
  'compatibility-doc',
  'chrome-bridge://docs/compatibility',
  {
    title: 'Client Compatibility',
    description: 'Compact MCP client compatibility guide and profile guidance.',
    mimeType: 'text/markdown',
  },
  async (uri) => markdownResource(uri.toString(), compatibilityResourceText()),
);

server.resource(
  'tool-catalog-guide',
  'chrome-bridge://catalog/tools',
  {
    title: 'Tool Guide',
    description: 'Compact guide to the highest-value Chrome MCP Bridge tools and when to use the full command catalog.',
    mimeType: 'text/markdown',
  },
  async (uri) => markdownResource(uri.toString(), toolCatalogResourceText()),
);

server.resource(
  'current-profile',
  'chrome-bridge://profiles/current',
  {
    title: 'Current MCP Profile',
    description: 'Current MCP profile, enabled tool count, and omitted tools for this server process.',
    mimeType: 'application/json',
  },
  async (uri) => jsonResource(uri.toString(), {
    generatedAt: new Date().toISOString(),
    ...currentMcpProfileSummary(),
  }),
);

server.resource(
  'read-first-workflow',
  'chrome-bridge://workflows/read-first',
  {
    title: 'Read-First Workflow',
    description: 'Recommended safe workflow for inspecting a page before proposing interaction.',
    mimeType: 'text/markdown',
  },
  async (uri) => markdownResource(uri.toString(), readFirstWorkflowText()),
);

server.resource(
  'debug-bundle-workflow',
  'chrome-bridge://workflows/debug-bundle',
  {
    title: 'Debug Bundle Workflow',
    description: 'Recommended bounded debugging flow before collecting heavier local artifacts.',
    mimeType: 'text/markdown',
  },
  async (uri) => markdownResource(uri.toString(), debugBundleWorkflowText()),
);

server.prompt(
  'chrome_bridge_read_first',
  'Plan a safe read-first workflow before any browser mutation.',
  {
    goal: z.string().optional(),
  },
  async ({ goal } = {}) => promptTextResult([
    'Use Chrome MCP Bridge in read-first mode.',
    goal ? `Goal: ${goal}` : 'Goal: inspect the current browser task safely before mutation.',
    'First call chrome_bridge_health, then chrome_bridge_workspace.',
    'If the page is already open, ask the user to focus it and use chrome_bridge_adopt_tab with confirmed=true.',
    'Then prefer chrome_bridge_snapshot or chrome_bridge_text, followed by chrome_bridge_observe and chrome_bridge_find_elements.',
    'Use chrome_bridge_extract for structured output when that is cheaper than free-form reading.',
    'Do not click, type, submit, or read private browser data until the user explicitly approves the exact action.',
    'If output may be large, keep it in local artifacts instead of inline MCP text.',
  ].join('\n'), 'Read-first browser inspection workflow.'),
);

server.prompt(
  'chrome_bridge_existing_tab',
  'Guide the agent through adopting an already-open tab into the scoped group.',
  {
    pageHint: z.string().optional(),
  },
  async ({ pageHint } = {}) => promptTextResult([
    'Help the user work with an already-open Chrome tab.',
    pageHint ? `Target tab hint: ${pageHint}` : 'Ask the user to focus the target tab in Chrome first.',
    'After the user confirms the correct tab is focused, call chrome_bridge_adopt_tab with confirmed=true.',
    'Then call chrome_bridge_group or chrome_bridge_tabs to verify scope.',
    'Read first with chrome_bridge_snapshot, chrome_bridge_observe, and chrome_bridge_find_elements before suggesting interaction.',
    'If the wrong tab is in scope, stop and ask the user to refocus rather than guessing.',
  ].join('\n'), 'Existing-tab adoption workflow.'),
);

server.prompt(
  'chrome_bridge_debug_page',
  'Guide the agent through a bounded debugging workflow with local artifacts.',
  {
    suspectedIssue: z.string().optional(),
  },
  async ({ suspectedIssue } = {}) => promptTextResult([
    'Use a bounded Chrome MCP Bridge debugging flow.',
    suspectedIssue ? `Suspected issue: ${suspectedIssue}` : 'Suspected issue: unknown browser, UI, or performance problem.',
    'Start with chrome_bridge_session_summary and chrome_bridge_diagnostics.',
    'Prefer chrome_bridge_trace_summary and chrome_bridge_diagnostics before heavier artifact collection.',
    'If needed, write a redacted local debug bundle with chrome_bridge_debug_bundle and only the minimum include flags.',
    'For performance reports, ingest a local Lighthouse JSON report with chrome_bridge_lighthouse_ingest instead of dumping raw audits.',
    'Keep raw page artifacts local; summarize findings in metadata-first form.',
  ].join('\n'), 'Bounded debug workflow for browser issues.'),
);

server.prompt(
  'chrome_bridge_extract_structured',
  'Guide the agent to structured extraction with the lowest-risk and lowest-token path.',
  {
    preset: z.enum(['cpa-offer', 'article', 'product-page', 'pricing-table', 'tables', 'forms', 'lists', 'keyValues']).optional(),
  },
  async ({ preset } = {}) => promptTextResult([
    'Use Chrome MCP Bridge for structured extraction.',
    preset ? `Preferred extraction target: ${preset}` : 'Choose the smallest extraction surface that fits the task.',
    'If a known preset applies, use chrome_bridge_extract with a preset first.',
    'Otherwise use chrome_bridge_extract with kind=tables, forms, lists, or keyValues.',
    'If the page is large, prefer artifact paths with out or artifactDir rather than inlining everything.',
    'Do not use free-form screenshot reading when structured extraction can answer the question more cheaply.',
  ].join('\n'), 'Structured extraction workflow.'),
);

server.prompt(
  'chrome_bridge_safe_interaction',
  'Guide the agent through a confirmation-aware interaction workflow.',
  {
    intent: z.string().optional(),
  },
  async ({ intent } = {}) => promptTextResult([
    'Use Chrome MCP Bridge interaction mode carefully.',
    intent ? `Planned interaction: ${intent}` : 'Planned interaction: unknown.',
    'Before mutation, inspect the page with chrome_bridge_observe and chrome_bridge_find_elements.',
    'Propose the exact selector or action to the user before calling click, type, press, select, upload, or handle dialog.',
    'Use confirmed=true only after the user explicitly approves the exact action.',
    'If the interaction could expose private browser data, also require confirmSensitive=true where applicable.',
    'After the interaction, read the page again rather than chaining autonomous mutations.',
  ].join('\n'), 'Confirmation-aware browser interaction workflow.'),
);

server.prompt(
  'chrome_bridge_release_smoke',
  'Guide the agent through the safe live verification sequence after bridge or extension changes.',
  {},
  async () => promptTextResult([
    'Run the Chrome MCP Bridge live verification flow only when no other session is using the bridge.',
    'First use chrome_bridge_runtime_smoke with coveragePlan=true if you need the offline checklist.',
    'When the bridge is free, reload the extension, run doctor with liveChecks=true, then run runtime smoke.',
    'Treat the verification as complete only when ok=true, coverage.ok=true, and verification.status="passed".',
    'If the smoke output includes nextCommand or nextAction, follow that recovery guidance rather than guessing.',
  ].join('\n'), 'Release verification workflow.'),
);

server.tool(
  'chrome_bridge_health',
  'Check whether the local Native Messaging Host and extension are connected.',
  {},
  async () => textResult(await bridgeFetch('/health')),
);

server.tool(
  'chrome_bridge_reload_extension',
  'Ask the loaded Chrome MCP Bridge extension to reload itself after local extension file edits. Requires confirmed=true because it interrupts active bridge sessions.',
  {
    confirmed: z.boolean(),
  },
  async (args) => textResult(await bridgeCommand('reloadExtension', args, 5_000)),
);

server.tool(
  'chrome_bridge_self_test',
  'Run local Chrome Bridge file/surface parity checks: syntax, manifest permissions, versions, extension actions, CLI commands, MCP tools, and safety gates.',
  {},
  async () => textResult(await localSelfTest()),
);

server.tool(
  'chrome_bridge_runtime_smoke',
  `Run a safe local runtime smoke test in real Chrome after extension v${BRIDGE_VERSION} is loaded. Pass coveragePlan=true to print the offline checklist with verification.status="not-run"; live success requires ok=true, coverage.ok=true, and verification.status="passed".`,
  {
    keepTab: z.boolean().optional(),
    coveragePlan: z.boolean().optional(),
    summaryOnly: z.boolean().optional(),
    out: z.string().optional(),
  },
  async (args) => textResult(await localRuntimeSmoke(args)),
);

server.tool(
  'chrome_bridge_doctor',
  'Inspect local Chrome Bridge installation paths and setup hints. Offline by default; pass liveChecks=true only when no other session is using the bridge because it probes /health and Chrome Apple Events.',
  {
    liveChecks: z.boolean().optional(),
  },
  async (args) => textResult(await localDoctor(args)),
);

server.tool(
  'chrome_bridge_extension_path',
  'Return the local unpacked Chrome extension directory path. This is offline and does not contact Chrome or the bridge.',
  {},
  async () => textResult(await localCliText('extension-path')),
);

server.tool(
  'chrome_bridge_mcp_config',
  'Return MCP client configuration snippets for Claude Code, Cursor, Codex, VS Code, Windsurf, Hermes, or generic stdio clients. This is offline and does not contact Chrome or the bridge.',
  {
    client: z.enum(['all', 'claude-code', 'cursor', 'codex', 'vscode', 'windsurf', 'hermes', 'generic']).optional(),
  },
  async (args) => textResult(await localCliText('mcp-config', args.client ? ['--client', args.client] : [])),
);

server.tool(
  'chrome_bridge_codex_config',
  'Return the legacy Codex MCP configuration snippet for this local Chrome Bridge installation using the current Node executable. This is offline and does not contact Chrome or the bridge.',
  {},
  async () => textResult(await localCliText('codex-config')),
);

server.tool(
  'chrome_bridge_windows',
  'List Chrome windows with grouped tabs. By default this includes all normal Chrome windows; pass includeAll=false with a group scope to limit the result.',
  {
    includeAll: z.boolean().optional(),
    groupTitle: z.string().optional(),
    groupColor: z.enum(TAB_GROUP_COLORS).optional(),
    confirmed: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('windows', args)),
);

server.tool(
  'chrome_bridge_tabs',
  'List Chrome tabs. By default this includes all Chrome tabs; pass includeAll=false with a group scope to limit the result.',
  {
    includeAll: z.boolean().optional(),
    groupTitle: z.string().optional(),
    groupColor: z.enum(TAB_GROUP_COLORS).optional(),
    confirmed: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('tabs', args)),
);

server.tool(
  'chrome_bridge_group',
  'Show the Codex Bridge Chrome tab group and tabs currently scoped to it.',
  {
    includeTabs: z.boolean().optional(),
    groupTitle: z.string().optional(),
    groupColor: z.enum(TAB_GROUP_COLORS).optional(),
  },
  async (args) => textResult(await bridgeCommand('group', args)),
);

server.tool(
  'chrome_bridge_workspace',
  'Show the active Chrome Bridge workspace defaults, policy mode, group counts, and optionally grouped tabs.',
  {
    includeTabs: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('workspace', args, 10_000)),
);

server.tool(
  'chrome_bridge_set_workspace',
  'Set local workspace defaults for group title/color and policy mode. Requires confirmed=true; policyMode supports open, scoped, or strict.',
  {
    name: z.string().optional(),
    groupTitle: z.string().optional(),
    groupColor: z.enum(TAB_GROUP_COLORS).optional(),
    policyMode: z.enum(['open', 'scoped', 'strict']).optional(),
    confirmed: z.boolean(),
  },
  async (args) => textResult(await bridgeCommand('setWorkspace', args, 10_000)),
);

server.tool(
  'chrome_bridge_clear_workspace',
  'Clear local workspace defaults and return to the default Codex Bridge group settings. Requires confirmed=true.',
  {
    confirmed: z.boolean(),
  },
  async (args) => textResult(await bridgeCommand('clearWorkspace', args, 10_000)),
);

server.tool(
  'chrome_bridge_ensure_tab',
  'Create or return the dedicated non-focused Codex Chrome tab, optionally navigating it to a URL.',
  {
    url: navigationUrlSchema.optional(),
    active: z.boolean().optional(),
    groupTitle: z.string().optional(),
    groupColor: z.enum(TAB_GROUP_COLORS).optional(),
  },
  async (args) => textResult(await bridgeCommand('ensureTab', args, 30_000)),
);

server.tool(
  'chrome_bridge_adopt_tab',
  'Adopt the current active tab, or a specified tabId, into the Codex Bridge group. Requires confirmed=true because it changes tab grouping in the user browser.',
  {
    tabId: chromeIdSchema.optional(),
    groupTitle: z.string().optional(),
    groupColor: z.enum(TAB_GROUP_COLORS).optional(),
    confirmed: z.boolean(),
  },
  async (args) => textResult(await bridgeCommand('adoptTab', args, 30_000)),
);

server.tool(
  'chrome_bridge_open',
  'Open a URL in the Codex Bridge Chrome tab group. By default this reuses the dedicated tab; pass newTab to create another grouped tab.',
  {
    url: navigationUrlSchema,
    tabId: chromeIdSchema.optional(),
    active: z.boolean().optional(),
    newTab: z.boolean().optional(),
    groupTitle: z.string().optional(),
    groupColor: z.enum(TAB_GROUP_COLORS).optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('open', args, 30_000)),
);

server.tool(
  'chrome_bridge_activate_tab',
  'Activate any Chrome tab. Explicit scoped policies may require allowExternal for outside tabs.',
  {
    tabId: chromeIdSchema.optional(),
    focusWindow: z.boolean().optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('activateTab', args, 10_000)),
);

server.tool(
  'chrome_bridge_close_tab',
  'Close a tab in the Codex Bridge group. Requires confirmed=true.',
  {
    tabId: chromeIdSchema.optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('closeTab', args, 10_000)),
);

server.tool(
  'chrome_bridge_close_group',
  'Close every tab in the Codex Bridge group. Requires confirmed=true.',
  {
    groupTitle: z.string().optional(),
    groupColor: z.enum(TAB_GROUP_COLORS).optional(),
    confirmed: z.boolean(),
  },
  async (args) => textResult(await bridgeCommand('closeGroup', args, 10_000)),
);

server.tool(
  'chrome_bridge_back',
  'Navigate the current Codex Bridge tab backward.',
  {
    tabId: chromeIdSchema.optional(),
    allowExternal: z.boolean().optional(),
    timeoutMs: payloadTimeoutSchema.optional(),
  },
  async (args) => textResult(await bridgeCommand('goBack', args, 30_000)),
);

server.tool(
  'chrome_bridge_forward',
  'Navigate the current Codex Bridge tab forward.',
  {
    tabId: chromeIdSchema.optional(),
    allowExternal: z.boolean().optional(),
    timeoutMs: payloadTimeoutSchema.optional(),
  },
  async (args) => textResult(await bridgeCommand('goForward', args, 30_000)),
);

server.tool(
  'chrome_bridge_reload_tab',
  'Reload the current Codex Bridge tab.',
  {
    tabId: chromeIdSchema.optional(),
    bypassCache: z.boolean().optional(),
    allowExternal: z.boolean().optional(),
    timeoutMs: payloadTimeoutSchema.optional(),
  },
  async (args) => textResult(await bridgeCommand('reloadTab', args, 30_000)),
);

server.tool(
  'chrome_bridge_wait_for_selector',
  'Wait for a selector or observed elementRef to appear in the selected tab.',
  {
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    tabId: chromeIdSchema.optional(),
    timeoutMs: payloadTimeoutSchema.optional(),
    visible: z.boolean().optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    requireElementTarget(args, 'chrome_bridge_wait_for_selector');
    return textResult(await bridgeCommand('waitForSelector', args, 30_000));
  },
);

server.tool(
  'chrome_bridge_observe',
  'Read a ranked, bounded list of actionable elements from the selected tab without clicking or mutating page state.',
  {
    tabId: chromeIdSchema.optional(),
    limit: z.number().min(1).max(300).optional(),
    maxTextChars: z.number().min(20).max(1000).optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('observe', args, 30_000)),
);

server.tool(
  'chrome_bridge_act_preview',
  'Plan one likely next browser action from natural-language intent and current page state without mutating the page.',
  {
    intent: z.string(),
    tabId: chromeIdSchema.optional(),
    maxCandidates: z.number().min(1).max(20).optional(),
    riskTolerance: z.enum(['read-only', 'confirmed-interaction', 'private-read']).optional(),
    selectorPreference: z.enum(['stable', 'any']).optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await localActPreview(args)),
);

server.tool(
  'chrome_bridge_act_apply',
  'Apply exactly one previously previewed action by previewId with explicit confirmation, then return before/after evidence and a recommended next read.',
  {
    previewId: z.string(),
    text: z.string().optional(),
    value: z.string().optional(),
    label: z.string().optional(),
    index: z.number().min(0).optional(),
    confirmed: z.boolean(),
  },
  async (args) => {
    if (!args.confirmed) throw new Error('chrome_bridge_act_apply requires confirmed=true');
    return textResult(await localActApply(args));
  },
);

server.tool(
  'chrome_bridge_find_elements',
  'Read ranked actionable elements filtered by role, text, nearby text, placeholder, href, action kind, or risk hint.',
  {
    tabId: chromeIdSchema.optional(),
    role: z.string().optional(),
    text: z.string().optional(),
    nearText: z.string().optional(),
    placeholder: z.string().optional(),
    href: z.string().optional(),
    actionKind: z.string().optional(),
    risk: z.string().optional(),
    limit: z.number().min(1).max(300).optional(),
    maxTextChars: z.number().min(20).max(1000).optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('findElements', args, 30_000)),
);

server.tool(
  'chrome_bridge_page_search',
  'Search full-page text with ranked snippets while keeping raw page text in local artifacts.',
  {
    query: z.string(),
    tabId: chromeIdSchema.optional(),
    artifactDir: z.string().optional(),
    out: z.string().optional(),
    maxChars: z.number().min(1000).max(200000).optional(),
    maxMatches: z.number().min(1).max(50).optional(),
    maxSnippetChars: z.number().min(80).max(2000).optional(),
    viewportOnly: z.boolean().optional(),
    allowExternal: z.boolean().optional(),
    ...fullPageReadSchema,
  },
  async (args) => {
    const result = await bridgeCommand('text', {
      tabId: args.tabId,
      allowExternal: args.allowExternal,
      maxChars: args.maxChars ?? 200_000,
      fullPage: args.viewportOnly ? false : true,
      waitForText: args.waitForText,
      waitForPattern: args.waitForPattern,
      scrollStepPx: args.scrollStepPx,
      maxScrollSteps: args.maxScrollSteps,
      scrollDelayMs: args.scrollDelayMs,
    }, 30_000);
    const envelope = await formatReadOutput({
      action: 'text',
      result,
      options: {
        artifactDir: args.artifactDir,
        summaryOnly: true,
      },
    });
    return textResult(await buildPageSearch({
      query: args.query,
      text: result.text,
      source: {
        url: result.url || result.tab?.url || null,
        title: result.title || result.tab?.title || null,
        tabId: result.tab?.id ?? result.tabId ?? null,
      },
      rawArtifactPath: envelope.artifactPath,
      out: args.out,
      artifactDir: args.artifactDir,
      maxMatches: args.maxMatches ?? 8,
      maxSnippetChars: args.maxSnippetChars ?? 320,
    }));
  },
);

server.tool(
  'chrome_bridge_extract',
  'Extract structured JSON from the selected tab: tables, forms, lists, key-value blocks, or artifact-backed cpa-offer/article/product-page/pricing-table presets.',
  {
    tabId: chromeIdSchema.optional(),
    kind: z.enum(['all', 'tables', 'forms', 'lists', 'keyValues']).optional(),
    preset: z.enum(['cpa-offer', 'article', 'product-page', 'pricing-table']).optional(),
    network: z.string().optional(),
    out: z.string().optional(),
    artifactDir: z.string().optional(),
    rawOut: z.string().optional(),
    rawHtmlOut: z.string().optional(),
    selector: z.string().optional(),
    maxChars: z.number().min(1000).max(200000).optional(),
    maxHtmlChars: z.number().min(1000).max(500000).optional(),
    ...fullPageReadSchema,
    maxItems: z.number().min(1).max(500).optional(),
    maxTextChars: z.number().min(50).max(2000).optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    if (args.preset === 'cpa-offer') {
      return textResult(await buildCpaOfferExtraction({
        bridgeCommand,
        target: {
          tabId: args.tabId,
          allowExternal: args.allowExternal,
        },
        options: {
          out: args.out,
          artifactDir: args.artifactDir,
          rawOut: args.rawOut,
          rawHtmlOut: args.rawHtmlOut,
          sourceNetwork: args.network,
          selector: args.selector,
          maxChars: args.maxChars ?? 200_000,
          maxHtmlChars: args.maxHtmlChars ?? 500_000,
          waitForText: args.waitForText,
          waitForPattern: args.waitForPattern,
          scrollStepPx: args.scrollStepPx,
          maxScrollSteps: args.maxScrollSteps,
          scrollDelayMs: args.scrollDelayMs,
        },
      }));
    }
    if (['article', 'product-page', 'pricing-table'].includes(args.preset)) {
      return textResult(await buildStructuredPresetExtraction({
        bridgeCommand,
        target: {
          tabId: args.tabId,
          allowExternal: args.allowExternal,
        },
        options: {
          preset: args.preset,
          out: args.out,
          artifactDir: args.artifactDir,
          rawOut: args.rawOut,
          rawHtmlOut: args.rawHtmlOut,
          selector: args.selector,
          maxChars: args.maxChars ?? 200_000,
          maxHtmlChars: args.maxHtmlChars ?? 500_000,
          waitForText: args.waitForText,
          waitForPattern: args.waitForPattern,
          scrollStepPx: args.scrollStepPx,
          maxScrollSteps: args.maxScrollSteps,
          scrollDelayMs: args.scrollDelayMs,
        },
      }));
    }

    return textResult(await bridgeCommand('extractPage', {
      tabId: args.tabId,
      kind: args.kind,
      maxItems: args.maxItems,
      maxTextChars: args.maxTextChars,
      allowExternal: args.allowExternal,
    }, 30_000));
  },
);

server.tool(
  'chrome_bridge_download_discovery',
  'Discover download and offline-export candidates from page HTML without clicking, downloading, or fetching candidate URLs.',
  {
    out: z.string(),
    tabId: chromeIdSchema.optional(),
    allowExternal: z.boolean().optional(),
    selector: z.string().optional(),
    artifactDir: z.string().optional(),
    rawHtmlOut: z.string().optional(),
    maxHtmlChars: z.number().min(1000).max(500000).optional(),
  },
  async (args) => textResult(await buildDownloadDiscovery({
    bridgeCommand,
    target: {
      tabId: args.tabId,
      allowExternal: args.allowExternal,
    },
    options: {
      out: args.out,
      artifactDir: args.artifactDir,
      rawHtmlOut: args.rawHtmlOut,
      selector: args.selector,
      maxHtmlChars: args.maxHtmlChars ?? 500_000,
    },
  })),
);

server.tool(
  'chrome_bridge_download',
  'Click one confirmed selector or observed elementRef, wait for exactly one browser download, and return local file metadata without file contents.',
  {
    tabId: chromeIdSchema.optional(),
    allowExternal: z.boolean().optional(),
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    confirmed: z.boolean(),
    downloadTimeoutMs: z.number().min(1000).max(180000).optional(),
  },
  async (args) => {
    requireElementTarget(args, 'chrome_bridge_download');
    if (!args.confirmed) throw new Error('chrome_bridge_download requires confirmed=true');
    return textResult(await bridgeCommand('download', args, 60_000));
  },
);

server.tool(
  'chrome_bridge_snapshot',
  'Read a structured snapshot from a Chrome tab: title, URL, headings, visible controls, tables, JSON-LD, and bounded visible text.',
  {
    tabId: chromeIdSchema.optional(),
    maxChars: z.number().min(1000).max(200000).optional(),
    allowExternal: z.boolean().optional(),
    ...fullPageReadSchema,
    ...readOutputSchema,
  },
  async (args) => {
    const result = await bridgeCommand('snapshot', {
      tabId: args.tabId,
      maxChars: args.maxChars ?? 200_000,
      allowExternal: args.allowExternal,
      fullPage: Boolean(args.fullPage),
      waitForText: args.waitForText,
      waitForPattern: args.waitForPattern,
      scrollStepPx: args.scrollStepPx,
      maxScrollSteps: args.maxScrollSteps,
      scrollDelayMs: args.scrollDelayMs,
    }, 30_000);
    return textResult(await formatReadOutput({
      action: 'snapshot',
      result,
      options: readOutputOptions(args),
    }));
  },
);

server.tool(
  'chrome_bridge_text',
  'Read bounded visible text from a Chrome tab.',
  {
    tabId: chromeIdSchema.optional(),
    maxChars: z.number().min(1000).max(200000).optional(),
    allowExternal: z.boolean().optional(),
    ...fullPageReadSchema,
    ...readOutputSchema,
  },
  async (args) => {
    const result = await bridgeCommand('text', {
      tabId: args.tabId,
      maxChars: args.maxChars ?? 200_000,
      allowExternal: args.allowExternal,
      fullPage: Boolean(args.fullPage),
      waitForText: args.waitForText,
      waitForPattern: args.waitForPattern,
      scrollStepPx: args.scrollStepPx,
      maxScrollSteps: args.maxScrollSteps,
      scrollDelayMs: args.scrollDelayMs,
    }, 30_000);
    return textResult(await formatReadOutput({
      action: 'text',
      result,
      options: readOutputOptions(args),
    }));
  },
);

server.tool(
  'chrome_bridge_html',
  'Read bounded HTML from the selected tab, selector, or observed elementRef.',
  {
    tabId: chromeIdSchema.optional(),
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    maxChars: z.number().min(1000).max(500000).optional(),
    outer: z.boolean().optional(),
    allowExternal: z.boolean().optional(),
    ...readOutputSchema,
  },
  async (args) => {
    const result = await bridgeCommand('html', {
      tabId: args.tabId,
      selector: args.selector,
      elementRef: args.elementRef,
      maxChars: args.maxChars ?? 500_000,
      outer: args.outer,
      allowExternal: args.allowExternal,
    }, 30_000);
    return textResult(await formatReadOutput({
      action: 'html',
      result,
      options: readOutputOptions(args),
    }));
  },
);

server.tool(
  'chrome_bridge_screenshot',
  'Capture a PNG screenshot of the dedicated or selected Chrome tab and save it to a local path. Supports viewport, fullPage, selector or elementRef screenshots, and size-aware viewport fallback.',
  {
    out: z.string(),
    tabId: chromeIdSchema.optional(),
    fullPage: z.boolean().optional(),
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    maxPixels: z.number().int().min(1).max(1000000000).optional(),
    fallback: z.enum(['viewport', 'error']).optional(),
    timeoutMs: payloadTimeoutSchema.optional(),
    allowExternal: z.boolean().optional(),
    ...readOutputSchema,
  },
  async (args) => {
    const result = await bridgeCommand('screenshot', {
      tabId: args.tabId,
      fullPage: args.fullPage,
      selector: args.selector,
      elementRef: args.elementRef,
      maxPixels: args.maxPixels,
      fallback: args.fallback,
      allowExternal: args.allowExternal,
    }, args.timeoutMs ?? (args.fullPage || args.selector || args.elementRef ? 60_000 : 30_000));
    return textResult(await formatReadOutput({
      action: 'screenshot',
      result,
      options: readOutputOptions(args),
    }));
  },
);

server.tool(
  'chrome_bridge_pdf',
  'Export the selected Chrome tab as a PDF and save it to a local path.',
  {
    out: z.string(),
    tabId: chromeIdSchema.optional(),
    landscape: z.boolean().optional(),
    printBackground: z.boolean().optional(),
    pageRanges: z.string().optional(),
    scale: z.number().min(0.1).max(2).optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    const result = await bridgeCommand('printPdf', {
      tabId: args.tabId,
      landscape: args.landscape,
      printBackground: args.printBackground,
      pageRanges: args.pageRanges,
      scale: args.scale,
      allowExternal: args.allowExternal,
    }, 60_000);
    const match = /^data:application\/pdf;base64,(.+)$/.exec(result.dataUrl || '');
    if (!match) throw new Error('Extension returned an invalid PDF data URL');
    const outputPath = path.resolve(args.out);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(match[1], 'base64'));
    return textResult({ ...result, dataUrl: undefined, out: outputPath });
  },
);

server.tool(
  'chrome_bridge_set_viewport',
  'Apply confirmed viewport emulation to the selected tab until chrome_bridge_clear_emulation resets it.',
  {
    tabId: chromeIdSchema.optional(),
    width: z.number().int().min(200).max(10000),
    height: z.number().int().min(200).max(10000),
    deviceScaleFactor: z.number().min(0.1).max(5).optional(),
    mobile: z.boolean().optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    if (!args.confirmed) throw new Error('chrome_bridge_set_viewport requires confirmed=true');
    return textResult(await bridgeCommand('setViewport', args, 10_000));
  },
);

server.tool(
  'chrome_bridge_emulate_network',
  'Apply confirmed bounded network emulation to the selected tab until chrome_bridge_clear_emulation resets it.',
  {
    tabId: chromeIdSchema.optional(),
    networkProfile: z.enum(NETWORK_EMULATION_PROFILES),
    latencyMs: z.number().int().min(1).max(120000).optional(),
    downloadKbps: z.number().int().min(1).max(1000000).optional(),
    uploadKbps: z.number().int().min(1).max(1000000).optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    if (!args.confirmed) throw new Error('chrome_bridge_emulate_network requires confirmed=true');
    return textResult(await bridgeCommand('emulateNetwork', args, 10_000));
  },
);

server.tool(
  'chrome_bridge_clear_emulation',
  'Reset confirmed viewport and network emulation overrides for the selected tab.',
  {
    tabId: chromeIdSchema.optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    if (!args.confirmed) throw new Error('chrome_bridge_clear_emulation requires confirmed=true');
    return textResult(await bridgeCommand('clearEmulation', args, 10_000));
  },
);

server.tool(
  'chrome_bridge_click_at',
  'Click viewport coordinates in the selected tab. Requires confirmed=true; trusted=true uses Chrome Debugger input.',
  {
    x: z.number(),
    y: z.number(),
    tabId: chromeIdSchema.optional(),
    button: z.string().optional(),
    trusted: z.boolean().optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('clickAt', args, 30_000)),
);

server.tool(
  'chrome_bridge_hover',
  'Hover an element or coordinates in the selected tab.',
  {
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    tabId: chromeIdSchema.optional(),
    trusted: z.boolean().optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('hover', args, 30_000)),
);

server.tool(
  'chrome_bridge_drag_drop',
  'Drag one selector, elementRef, or coordinate point to another selector, elementRef, or coordinate point. Requires confirmed=true; trusted=true uses Chrome Debugger mouse input.',
  {
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    targetSelector: z.string().optional(),
    targetElementRef: z.string().optional(),
    targetX: z.number().optional(),
    targetY: z.number().optional(),
    tabId: chromeIdSchema.optional(),
    trusted: z.boolean().optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    const hasSource = Boolean(args.selector || args.elementRef || (args.x !== undefined && args.y !== undefined));
    const hasTarget = Boolean(args.targetSelector || args.targetElementRef || (args.targetX !== undefined && args.targetY !== undefined));
    if (!hasSource) throw new Error('chrome_bridge_drag_drop requires source selector, elementRef, or x/y');
    if (!hasTarget) throw new Error('chrome_bridge_drag_drop requires targetSelector, targetElementRef, or targetX/targetY');
    return textResult(await bridgeCommand('dragDrop', args, 30_000));
  },
);

server.tool(
  'chrome_bridge_click',
  'Click a selector or observed elementRef in the selected tab. Requires confirmed=true.',
  {
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    tabId: chromeIdSchema.optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    requireElementTarget(args, 'chrome_bridge_click');
    return textResult(await bridgeCommand('click', args, 30_000));
  },
);

server.tool(
  'chrome_bridge_type',
  'Type text into a selector or observed elementRef in the selected tab. Requires confirmed=true; trusted=true uses Chrome Debugger insertText.',
  {
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    text: z.string(),
    tabId: chromeIdSchema.optional(),
    trusted: z.boolean().optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    requireElementTarget(args, 'chrome_bridge_type');
    return textResult(await bridgeCommand('type', args, 30_000));
  },
);

server.tool(
  'chrome_bridge_press',
  'Press a keyboard key in the selected tab. Requires confirmed=true; trusted=true uses Chrome Debugger input.',
  {
    key: z.string(),
    code: z.string().optional(),
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    tabId: chromeIdSchema.optional(),
    trusted: z.boolean().optional(),
    ctrlKey: z.boolean().optional(),
    metaKey: z.boolean().optional(),
    altKey: z.boolean().optional(),
    shiftKey: z.boolean().optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('press', args, 30_000)),
);

server.tool(
  'chrome_bridge_select',
  'Select an option in a select element. Requires confirmed=true.',
  {
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    value: z.string().optional(),
    label: z.string().optional(),
    index: selectIndexSchema.optional(),
    tabId: chromeIdSchema.optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    requireElementTarget(args, 'chrome_bridge_select');
    requireSelectTarget(args);
    return textResult(await bridgeCommand('select', args, 30_000));
  },
);

server.tool(
  'chrome_bridge_select_options',
  'Read options from a select element without changing page state.',
  {
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    tabId: chromeIdSchema.optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    requireElementTarget(args, 'chrome_bridge_select_options');
    return textResult(await bridgeCommand('listSelectOptions', args, 30_000));
  },
);

server.tool(
  'chrome_bridge_fill_form',
  'Preview or apply field values to form controls. Defaults to dryRun; applying values requires confirmed=true.',
  {
    fields: z.record(z.union([z.string(), z.number(), z.boolean()])),
    dryRun: z.boolean().optional(),
    tabId: chromeIdSchema.optional(),
    confirmed: z.boolean().optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('fillForm', {
    ...args,
    dryRun: args.dryRun !== false,
  }, 30_000)),
);

server.tool(
  'chrome_bridge_handle_dialog',
  'Accept or dismiss the currently open JavaScript dialog in the selected tab. Requires confirmed=true.',
  {
    tabId: chromeIdSchema.optional(),
    accept: z.boolean().optional(),
    promptText: z.string().optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('handleDialog', args, 30_000)),
);

server.tool(
  'chrome_bridge_upload_file',
  'Set local file paths on a file input element via Chrome Debugger. Requires confirmed=true.',
  {
    selector: z.string().optional(),
    elementRef: z.string().optional(),
    file: z.string().optional(),
    files: z.array(z.string()).optional(),
    tabId: chromeIdSchema.optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => {
    requireElementTarget(args, 'chrome_bridge_upload_file');
    return textResult(await bridgeCommand('uploadFile', args, 60_000));
  },
);

server.tool(
  'chrome_bridge_scroll',
  'Scroll a Chrome tab. This is a local navigation action and should be used only on the selected work tab.',
  {
    tabId: chromeIdSchema.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('scroll', args, 10_000)),
);

server.tool(
  'chrome_bridge_trace_start',
  'Start bounded console/network tracing for the selected tab. Requires confirmed=true; headers and bodies are not captured.',
  {
    tabId: chromeIdSchema.optional(),
    maxEvents: z.number().min(50).max(2000).optional(),
    network: z.boolean().optional(),
    console: z.boolean().optional(),
    includeExtensionEvents: z.boolean().optional(),
    confirmed: z.boolean(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('traceStart', args, 30_000)),
);

server.tool(
  'chrome_bridge_trace_summary',
  'Read trace session metadata without returning console or network event logs.',
  {
    tabId: chromeIdSchema.optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('traceSummary', args, 30_000)),
);

server.tool(
  'chrome_bridge_trace_events',
  'Read recent bounded console/network trace events for the selected tab.',
  {
    tabId: chromeIdSchema.optional(),
    limit: z.number().min(1).max(2000).optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('traceEvents', args, 30_000)),
);

server.tool(
  'chrome_bridge_diagnostics',
  'Read bounded page, trace, network-count, resource, and performance diagnostics without returning raw event logs, resource URLs, or request/response bodies.',
  {
    tabId: chromeIdSchema.optional(),
    out: z.string().optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await diagnostics(args)),
);

server.tool(
  'chrome_bridge_network_export',
  'Write redacted local network-export artifacts from recent trace events, returning summary metadata and artifact paths without dumping raw network logs to stdout.',
  {
    tabId: chromeIdSchema.optional(),
    limit: z.number().min(1).max(2000).optional(),
    allowExternal: z.boolean().optional(),
    artifactDir: z.string().optional(),
    out: z.string().optional(),
    requestsOut: z.string().optional(),
    harOut: z.string().optional(),
    includeHeaders: z.boolean().optional(),
    includeBodies: z.boolean().optional(),
    confirmSensitive: z.boolean().optional(),
  },
  async (args) => {
    const trace = await bridgeCommand('traceEvents', {
      tabId: args.tabId,
      allowExternal: args.allowExternal,
      limit: args.limit ?? 200,
    }, 30_000);
    return textResult(await buildNetworkExport(trace, args));
  },
);

server.tool(
  'chrome_bridge_trace_stop',
  'Stop console/network tracing for the selected tab and return recent events.',
  {
    tabId: chromeIdSchema.optional(),
    limit: z.number().min(1).max(2000).optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('traceStop', args, 30_000)),
);

server.tool(
  'chrome_bridge_history_search',
  'Search Chrome history. Requires confirmed=true because history is private browser data.',
  {
    query: z.string().optional(),
    limit: z.number().min(1).max(200).optional(),
    startTime: timestampSchema.optional(),
    endTime: timestampSchema.optional(),
    confirmed: z.boolean(),
  },
  async (args) => textResult(await bridgeCommand('historySearch', args, 30_000)),
);

server.tool(
  'chrome_bridge_bookmarks_search',
  'Search Chrome bookmarks. Requires confirmed=true because bookmarks are private browser data.',
  {
    query: z.string().optional(),
    limit: z.number().min(1).max(200).optional(),
    confirmed: z.boolean(),
  },
  async (args) => textResult(await bridgeCommand('bookmarksSearch', args, 30_000)),
);

server.tool(
  'chrome_bridge_cookies_list',
  'List Chrome cookies metadata for a URL/domain. Requires confirmed=true; cookie values require includeValues and confirmSensitive.',
  {
    url: webUrlSchema.optional(),
    domain: z.string().optional(),
    name: z.string().optional(),
    limit: z.number().min(1).max(500).optional(),
    includeValues: z.boolean().optional(),
    confirmed: z.boolean(),
    confirmSensitive: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('cookiesList', args, 30_000)),
);

server.tool(
  'chrome_bridge_storage_snapshot',
  'Read localStorage/sessionStorage keys for the selected page. Requires confirmed=true; values require includeValues and confirmSensitive.',
  {
    tabId: chromeIdSchema.optional(),
    includeValues: z.boolean().optional(),
    maxValueChars: z.number().min(50).max(5000).optional(),
    confirmed: z.boolean(),
    confirmSensitive: z.boolean().optional(),
    allowExternal: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('storageSnapshot', args, 30_000)),
);

server.tool(
  'chrome_bridge_request',
  'Run a bounded fetch from the extension context. Requires confirmed=true; credentials=include requires confirmSensitive.',
  {
    url: webUrlSchema,
    method: z.enum(HTTP_METHODS).optional(),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
    credentials: z.enum(['omit', 'include']).optional(),
    maxChars: z.number().min(100).max(200000).optional(),
    requestTimeoutMs: z.number().min(1000).max(60000).optional(),
    confirmed: z.boolean(),
    confirmSensitive: z.boolean().optional(),
  },
  async (args) => textResult(await bridgeCommand('fetchUrl', args, 60_000)),
);

server.tool(
  'chrome_bridge_ask_user',
  'Open a local Codex Bridge prompt tab and wait for the user to answer. Use when the agent needs human-in-the-loop confirmation, clarification, or CAPTCHA/manual-step coordination.',
  {
    question: z.string(),
    choices: z.array(z.union([
      z.string(),
      z.object({
        value: z.string(),
        label: z.string(),
      }),
    ])).max(8).optional(),
    allowText: z.boolean().optional(),
    closeOnAnswer: z.boolean().optional(),
    timeoutMs: z.number().min(5000).max(1800000).optional(),
  },
  async (args) => textResult(await bridgeCommand('askUser', args, args.timeoutMs ? args.timeoutMs + 5_000 : 305_000)),
);

server.tool(
  'chrome_bridge_session_summary',
  'Return a safe local session summary: bridge health, extension state, scoped group status, and version mismatch signals.',
  {},
  async () => textResult(await sessionSummary()),
);

server.tool(
  'chrome_bridge_recording_summary',
  'Summarize an opt-in local action recording JSONL file and return a human-reviewed replay-lite checklist without executing recorded actions.',
  {
    recording: z.string(),
    limit: z.number().min(1).max(10000).optional(),
  },
  async (args) => textResult(await summarizeActionRecording({
    path: args.recording,
    limit: args.limit ?? 500,
  })),
);

server.tool(
  'chrome_bridge_debug_bundle',
  'Write a redacted local debug bundle with health, session summary, and trace summary metadata. Page artifacts and full trace events require explicit opt-in flags.',
  {
    out: z.string(),
    tabId: chromeIdSchema.optional(),
    allowExternal: z.boolean().optional(),
    includeSnapshot: z.boolean().optional(),
    includeObserve: z.boolean().optional(),
    includeScreenshot: z.boolean().optional(),
    includeTraceEvents: z.boolean().optional(),
  },
  async (args) => textResult(await debugBundle(args)),
);

server.tool(
  'chrome_bridge_lighthouse_plan',
  'Print the exact local Lighthouse command to run plus the follow-up chrome_bridge_lighthouse_ingest command, without running Lighthouse directly.',
  {
    url: z.string(),
    out: z.string().optional(),
    summaryOut: z.string().optional(),
    chromePath: z.string().optional(),
    chromeFlags: z.string().optional(),
    emulatedFormFactor: z.enum(['desktop', 'mobile']).optional(),
    onlyCategories: z.string().optional(),
  },
  async (args) => textResult(buildLighthousePlan(args)),
);

server.tool(
  'chrome_bridge_lighthouse_ingest',
  'Ingest a local Lighthouse JSON report and return scores plus failing audits without inlining the raw report.',
  {
    report: z.string(),
    out: z.string().optional(),
    maxAudits: z.number().int().min(1).max(100).optional(),
  },
  async (args) => textResult(await ingestLighthouseReportFile({
    reportPath: args.report,
    out: args.out,
    maxAudits: args.maxAudits ?? 25,
  })),
);

server.tool(
  'chrome_bridge_command_catalog',
  'Return local Chrome Bridge command metadata from the shared registry, including actions, risk tiers, default timeouts, CLI aliases, MCP tools, and confirmation requirements.',
  {},
  async () => textResult({
    ...commandCatalog(),
    mcpProfile: currentMcpProfileSummary(),
  }),
);

server.tool(
  'chrome_bridge_tool_advisor',
  'Recommend the safest next Chrome Bridge tools for a task without contacting Chrome. Uses deterministic local rules, active MCP profile metadata, and no LLM calls.',
  {
    task: z.string(),
    surface: z.enum(['cli', 'mcp', 'both']).optional(),
    riskTolerance: z.enum(['read-only', 'confirmed-interaction', 'private-read']).optional(),
    client: z.enum(['all', 'claude-code', 'cursor', 'codex', 'vscode', 'windsurf', 'hermes', 'generic']).optional(),
    hasLiveBridge: z.boolean().optional(),
  },
  async (args) => textResult(buildToolAdvisor({
    ...args,
    mcpProfile: mcpToolProfile,
    availableMcpTools: currentMcpProfileSummary().enabledTools,
  })),
);

export async function main() {
  await server.connect(new StdioServerTransport());
}
