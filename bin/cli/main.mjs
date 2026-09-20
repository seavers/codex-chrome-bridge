import fs from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { bridgeSocketPath, nativeBridgeCommand, nativeBridgeHealth } from '../../shared/native-bridge.mjs';
import { buildCpaOfferExtraction } from '../../shared/cpa-offer-extract.mjs';
import { buildStructuredPresetExtraction } from '../../shared/structured-extract.mjs';
import { buildDownloadDiscovery } from '../../shared/download-discovery.mjs';
import { ingestLighthouseReportFile } from '../../shared/lighthouse-ingest.mjs';
import { buildLighthousePlan } from '../../shared/lighthouse-plan.mjs';
import { buildNetworkExport } from '../../shared/network-export.mjs';
import { actionRecordForCandidate, buildActPreviewPlan } from '../../shared/act-preview.mjs';
import { buildPageSearch } from '../../shared/page-search.mjs';
import {
  createPreviewActionId,
  DEFAULT_ACT_PREVIEW_TTL_MS,
  markPreviewActionUsed,
  previewActionIsExpired,
  readPreviewAction,
  writePreviewAction,
} from '../../shared/act-preview-state.mjs';
import { buildToolAdvisor } from '../../shared/tool-advisor.mjs';
import { appendActionRecording, summarizeActionRecording } from '../../shared/action-recording.mjs';
import {
  formatReadOutput,
  lastArtifact,
  readArtifactPreview,
} from '../../shared/output-envelope.mjs';
import { summarizeDiagnosticsOutput } from '../../shared/diagnostics-output.mjs';
import {
  createRunId,
  readRunState,
  recordOwnedTab,
  removeOwnedTabs,
} from '../../shared/run-tabs.mjs';
import { withSessionGroupTitle } from '../../shared/session-group-title.mjs';
import {
  BRIDGE_VERSION,
  CLI_COMMANDS,
  CLI_USAGE_GROUPS,
  CLI_USAGE_LINES,
  COMMAND_CATALOG,
  COMMAND_METADATA,
  DEBUGGER_SERIALIZED_ACTIONS,
  EXTENSION_ACTIONS,
  HTTP_METHODS,
  MANIFEST_PERMISSIONS,
  MCP_TOOLS,
  commandCatalog,
  commandCatalogMarkdown,
  commandDefaultTimeoutMs,
} from '../../shared/command-registry.mjs';

const BRIDGE_TRANSPORT = 'native-messaging+unix-socket';
const EXPECTED_EXTENSION_VERSION = BRIDGE_VERSION;
let suppressSessionGroupTitle = false;

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

function usage() {
  return [
    'Usage:',
    ...CLI_USAGE_LINES.map((line) => `  ${line}`),
  ].join('\n');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) {
      args._.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function toolAdvisorInput(args) {
  const task = typeof args.task === 'string' ? args.task : args._.slice(1).join(' ').trim();
  return {
    task,
    surface: args.surface,
    riskTolerance: args.risk,
    client: args.client,
    hasLiveBridge: args['live-bridge'] ? true : (args.offline ? false : undefined),
    mcpProfile: process.env.CHROME_BRIDGE_MCP_TOOL_PROFILE || 'full',
    availableMcpTools: MCP_TOOLS,
  };
}

function actPreviewInput(args, observed) {
  const intent = typeof args.intent === 'string' ? args.intent : args._.slice(1).join(' ').trim();
  return {
    intent,
    observed,
    tabId: observed?.tab?.id || parseChromeIdArg(args.tab, '--tab'),
    maxCandidates: parseNumberRangeArg(args['max-candidates'], '--max-candidates', 1, 20) ?? 5,
    riskTolerance: args.risk || 'confirmed-interaction',
    selectorPreference: args['selector-preference'] || 'stable',
  };
}

async function persistedActPreviewPlan(input, options = {}) {
  const plan = buildActPreviewPlan(input);
  const createdAt = new Date().toISOString();
  const ttlMs = DEFAULT_ACT_PREVIEW_TTL_MS;
  const candidates = await Promise.all(plan.candidates.map(async (candidate) => {
    const previewActionId = createPreviewActionId();
    const record = await writePreviewAction({
      previewActionId,
      createdAt,
      ttlMs,
      intent: plan.intent,
      page: {
        tabId: plan.page?.tabId,
        url: plan.page?.url,
        title: plan.page?.title,
      },
      action: actionRecordForCandidate(plan, candidate),
    });
    return {
      ...candidate,
      id: previewActionId,
      previewExpiresAt: record.expiresAt,
      previewTtlMs: ttlMs,
    };
  }));
  const recommended = candidates.find((candidate) => candidate.id === plan.recommended?.id)
    || candidates[0]
    || null;
  return {
    ...plan,
    createdAt,
    previewTtlMs: ttlMs,
    candidates,
    recommended,
  };
}

function currentPageMeta(result = {}) {
  return {
    tabId: result?.tab?.id ?? result?.tabId ?? null,
    url: result?.url || result?.tab?.url || null,
    title: result?.title || result?.tab?.title || null,
  };
}

function nextReadForAppliedAction(kind) {
  return kind === 'type' || kind === 'select'
    ? {
      cli: 'chrome-bridge snapshot',
      mcp: { tool: 'chrome_bridge_snapshot', arguments: {} },
    }
    : {
      cli: 'chrome-bridge observe',
      mcp: { tool: 'chrome_bridge_observe', arguments: {} },
    };
}

async function actApply(args = {}) {
  if (!args['preview-id']) throw new Error('act-apply requires --preview-id <id>');
  if (!args.confirm) throw new Error('act-apply requires --confirm');

  const record = await readPreviewAction({ previewActionId: args['preview-id'] });
  if (!record) throw new Error('Preview action not found or already expired from local state');
  if (record.usedAt) throw new Error('Preview action was already used');
  if (previewActionIsExpired(record)) throw new Error('Preview action is stale or expired');

  const expectedTabId = Number.isInteger(record.page?.tabId) ? record.page.tabId : null;
  if (!Number.isInteger(expectedTabId)) throw new Error('Preview action is missing a target tab id');

  const beforeObserve = await command('observe', {
    tabId: expectedTabId,
    limit: 20,
    maxTextChars: 120,
  }, 30_000);
  const beforePage = currentPageMeta(beforeObserve);
  if (record.page?.url && beforePage.url !== record.page.url) {
    throw new Error(`Preview action is stale: expected URL ${record.page.url}, got ${beforePage.url || '<none>'}`);
  }
  if (record.page?.title && beforePage.title !== record.page.title) {
    throw new Error(`Preview action is stale: expected title ${record.page.title}, got ${beforePage.title || '<none>'}`);
  }

  const actionKind = record.action?.kind;
  const selector = record.action?.selector;
  if (!selector) throw new Error('Preview action is missing selector data');

  const baseArguments = {
    tabId: expectedTabId,
    confirmed: true,
  };
  let actionName;
  let actionArguments;

  if (actionKind === 'click') {
    actionName = 'click';
    actionArguments = {
      ...baseArguments,
      selector,
    };
  } else if (actionKind === 'type') {
    const text = typeof args.text === 'string' ? args.text : record.action?.baseArguments?.text;
    if (typeof text !== 'string' || !text.length) {
      throw new Error('This previewed type action still needs --text <value> before apply');
    }
    actionName = 'type';
    actionArguments = {
      ...baseArguments,
      selector,
      text,
    };
  } else if (actionKind === 'select') {
    const value = args.value;
    const label = args.label;
    const index = parseNonNegativeIntegerArg(args.index, '--index');
    if (value === undefined && label === undefined && index === undefined) {
      throw new Error('This previewed select action needs --value, --label, or --index before apply');
    }
    actionName = 'select';
    actionArguments = {
      ...baseArguments,
      selector,
      value,
      label,
      index,
    };
  } else {
    throw new Error(`Unsupported preview action kind: ${actionKind}`);
  }

  const actionResult = await command(actionName, actionArguments, 30_000);
  const afterObserve = await command('observe', {
    tabId: expectedTabId,
    limit: 20,
    maxTextChars: 120,
  }, 30_000).catch(() => null);
  const afterPage = afterObserve ? currentPageMeta(afterObserve) : {
    tabId: expectedTabId,
    url: actionResult?.url || actionResult?.tab?.url || null,
    title: actionResult?.title || actionResult?.tab?.title || null,
  };

  const nextRead = nextReadForAppliedAction(actionKind);
  const result = {
    ok: true,
    action: 'act-apply',
    previewId: record.previewActionId,
    appliedAction: {
      kind: actionKind,
      selector,
      label: record.action?.label || null,
      risk: record.action?.risk || null,
    },
    before: beforePage,
    after: afterPage,
    evidence: {
      previewCreatedAt: record.createdAt,
      previewExpiresAt: record.expiresAt,
      usedAt: new Date().toISOString(),
      exactCommand: record.action?.exactCommand || null,
      exactMcpCall: record.action?.exactMcpCall || null,
    },
    nextRead,
    notes: [
      'act-apply executed exactly one low-level action.',
      'Read the page again before attempting another mutation.',
    ],
  };
  await markPreviewActionUsed({
    previewActionId: record.previewActionId,
    usedAt: result.evidence.usedAt,
    result: {
      before: beforePage,
      after: afterPage,
      action: result.appliedAction,
    },
  });
  return result;
}

async function bridgeFetch(pathname, options = {}, timeoutMs = 30_000) {
  if (pathname === '/health') return nativeBridgeHealth(timeoutMs);
  if (pathname !== '/command') throw new Error(`Unsupported native bridge path: ${pathname}`);
  let body;
  try { body = JSON.parse(options.body || '{}'); } catch { throw new Error('Invalid bridge command body'); }
  return nativeBridgeCommand(body.action, body.payload || {}, timeoutMs);
}

async function command(action, payload = {}, timeoutMs) {
  const effectiveTimeoutMs = timeoutMs ?? commandDefaultTimeoutMs(action);
  const scopedPayload = suppressSessionGroupTitle ? payload : withSessionGroupTitle(action, payload);
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

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseNonNegativeIntegerArg(value, name) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseFiniteNumberArg(value, name) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be numeric`);
  }
  return parsed;
}

function parseRequiredFiniteNumberArg(value, name, message) {
  let parsed;
  try {
    parsed = parseFiniteNumberArg(value, name);
  } catch {
    throw new Error(message);
  }
  if (parsed === undefined) throw new Error(message);
  return parsed;
}

function parseFiniteNumberArgWithMessage(value, name, message) {
  try {
    return parseFiniteNumberArg(value, name);
  } catch {
    throw new Error(message);
  }
}

function parseNumberRangeArg(value, name, min, max) {
  let parsed;
  try {
    parsed = parseFiniteNumberArg(value, name);
  } catch {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  if (parsed === undefined) return undefined;
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseChromeIdArg(value, name) {
  return parseNonNegativeIntegerArg(value, name);
}

function targetPayload(args) {
  return {
    tabId: parseChromeIdArg(args.tab, '--tab'),
    allowExternal: Boolean(args['allow-external']),
    ...groupScopePayload(args),
  };
}

function groupScopePayload(args) {
  return {
    groupTitle: args['group-title'],
    groupColor: args['group-color'],
  };
}

function confirmationPayload(args) {
  const payload = {
    confirmed: Boolean(args.confirm),
  };
  if (args['confirm-sensitive']) payload.confirmSensitive = true;
  return payload;
}

function readOutputOptions(args) {
  return {
    out: typeof args.out === 'string' ? args.out : undefined,
    artifactDir: typeof args['artifact-dir'] === 'string' ? args['artifact-dir'] : undefined,
    summaryOnly: Boolean(args['summary-only']),
    noContent: Boolean(args['no-content']),
    includeContent: Boolean(args['include-content']),
    maxInlineChars: parseNumberRangeArg(args['max-inline-chars'], '--max-inline-chars', 0, 500_000),
  };
}

function fullPageReadPayload(args) {
  return {
    fullPage: Boolean(args['full-page']),
    waitForText: args['wait-for-text'],
    waitForPattern: args['wait-for-pattern'],
    scrollStepPx: parseNumberRangeArg(args['scroll-step-px'], '--scroll-step-px', 100, 5_000),
    maxScrollSteps: parseNumberRangeArg(args['max-scroll-steps'], '--max-scroll-steps', 1, 200),
    scrollDelayMs: parseNumberRangeArg(args['scroll-delay-ms'], '--scroll-delay-ms', 0, 2_000),
  };
}

function screenshotFallbackArg(value) {
  if (value === undefined) return undefined;
  if (!['viewport', 'error'].includes(value)) {
    throw new Error('--fallback must be one of: viewport, error');
  }
  return value;
}

function screenshotPayload(args) {
  return {
    ...targetPayload(args),
    fullPage: Boolean(args['full-page']),
    selector: args.selector,
    elementRef: args.ref,
    maxPixels: parseNumberRangeArg(args['max-pixels'], '--max-pixels', 1, 1_000_000_000),
    fallback: screenshotFallbackArg(args.fallback),
  };
}

function screenshotTimeoutMs(args) {
  return parseNumberRangeArg(args['timeout-ms'], '--timeout-ms', 0, 300_000)
    ?? (args['full-page'] || args.selector || args.ref ? 60_000 : 30_000);
}

function elementTargetPayload(args) {
  return {
    selector: args.selector,
    elementRef: args.ref,
  };
}

function requireElementTarget(args, commandName) {
  if (!args.selector && !args.ref) {
    throw new Error(`${commandName} requires --selector <css> or --ref <ref>`);
  }
}

function dragDropPayload(args) {
  const sourceHasElement = Boolean(args.selector || args.ref);
  const sourceHasPoint = args.x !== undefined || args.y !== undefined;
  const targetHasElement = Boolean(args['target-selector'] || args['target-ref']);
  const targetHasPoint = args['target-x'] !== undefined || args['target-y'] !== undefined;
  if (!sourceHasElement && !sourceHasPoint) {
    throw new Error('drag-drop requires --selector, --ref, or --x/--y');
  }
  if (!targetHasElement && !targetHasPoint) {
    throw new Error('drag-drop requires --target-selector, --target-ref, or --target-x/--target-y');
  }
  return {
    selector: args.selector,
    elementRef: args.ref,
    x: sourceHasPoint ? parseRequiredFiniteNumberArg(args.x, '--x', 'drag-drop requires numeric --x and --y') : undefined,
    y: sourceHasPoint ? parseRequiredFiniteNumberArg(args.y, '--y', 'drag-drop requires numeric --x and --y') : undefined,
    targetSelector: args['target-selector'],
    targetElementRef: args['target-ref'],
    targetX: targetHasPoint ? parseRequiredFiniteNumberArg(args['target-x'], '--target-x', 'drag-drop requires numeric --target-x and --target-y') : undefined,
    targetY: targetHasPoint ? parseRequiredFiniteNumberArg(args['target-y'], '--target-y', 'drag-drop requires numeric --target-x and --target-y') : undefined,
  };
}

function truncateText(value, maxChars = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 3))}...` : text;
}

function summarizeTabs(result = {}) {
  const tabs = Array.isArray(result.tabs) ? result.tabs : [];
  return {
    ok: result.ok !== false,
    scope: result.scope || null,
    summaryOnly: true,
    counts: {
      tabs: tabs.length,
      active: tabs.filter((tab) => tab.active).length,
    },
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: truncateText(tab.title, 120),
      url: truncateText(tab.url, 160),
      active: Boolean(tab.active),
      status: tab.status || null,
    })),
  };
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function htmlLinks(html = '', baseUrl = '') {
  const links = [];
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    try {
      links.push({
        href: new URL(decodeHtmlEntities(match[2]), baseUrl || undefined).href,
        text: stripHtml(match[3]).slice(0, 300),
      });
    } catch {
      // Ignore malformed links in helper output.
    }
  }
  return [...new Map(links.map((link) => [link.href, link])).values()];
}

function htmlTables(html = '') {
  return [...String(html || '').matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((tableMatch, tableIndex) => {
    const rows = [...tableMatch[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((rowMatch) => (
      [...rowMatch[0].matchAll(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi)].map((cellMatch) => stripHtml(cellMatch[0]))
    )).filter((row) => row.length);
    return {
      index: tableIndex,
      rows,
    };
  }).filter((table) => table.rows.length);
}

function grepLines(text = '', pattern, maxMatches = 20) {
  if (!pattern) throw new Error('grep-page requires --pattern <regex>');
  const matcher = new RegExp(String(pattern), 'i');
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((entry) => entry.text && matcher.test(entry.text))
    .slice(0, maxMatches);
}

async function tokenBudgetStatus() {
  const [health, group, workspace, latestArtifact] = await Promise.all([
    bridgeFetch('/health').catch((error) => ({ ok: false, error: String(error?.message || error) })),
    command('group', {}, 10_000).catch((error) => ({ ok: false, error: String(error?.message || error), tabs: [] })),
    command('workspace', { includeTabs: true }, 10_000).catch((error) => ({ ok: false, error: String(error?.message || error), tabs: [] })),
    lastArtifact().catch(() => null),
  ]);
  const tabs = Array.isArray(group?.tabs) ? group.tabs : (Array.isArray(workspace?.tabs) ? workspace.tabs : []);
  return {
    ok: health.ok !== false,
    generatedAt: new Date().toISOString(),
    tokenBudget: {
      mode: 'cheap-first',
      defaultReadFlow: [
        'status --token-budget',
        'tabs --summary-only',
        'grep-page --pattern <regex>',
        'links --selector main',
        'tables --selector main',
        'read-artifact --head <n> --grep <pattern>',
      ],
      stdoutPolicy: 'metadata, snippets, links, and tables only; raw text/html stays in local artifacts',
    },
    health: {
      bridgeVersion: health.bridge?.version || null,
      extensionConnected: Boolean(health.extension?.connected),
      extensionVersion: health.extension?.info?.version || null,
    },
    workspace: {
      title: workspace?.workspace?.title || group?.group?.title || null,
      policyMode: workspace?.policy?.mode || null,
    },
    counts: {
      tabs: tabs.length || workspace?.counts?.tabs || 0,
    },
    tabs: summarizeTabs({ tabs }).tabs,
    lastArtifact: latestArtifact?.ok ? {
      action: latestArtifact.action,
      artifactPath: latestArtifact.artifactPath,
      generatedAt: latestArtifact.generatedAt,
    } : null,
    recommendations: [
      'Start with `tabs --summary-only` before reading page content.',
      'Use `grep-page --pattern <regex>` for snippets instead of full `text --include-content`.',
      'Use `read-artifact --head <n> --grep <pattern>` to inspect saved raw artifacts in small slices.',
    ],
  };
}

function errorJson(error) {
  return {
    message: String(error?.message || error),
    code: error?.code || null,
    details: error?.details || null,
  };
}

function closedTabIdsFromCloseResult(result, fallbackTabId) {
  const candidates = [
    result?.closedTabIds,
    result?.tabGroupPersistenceMitigation?.closedTabIds,
  ].find(Array.isArray);
  if (candidates) return candidates;
  return Number.isInteger(fallbackTabId) ? [fallbackTabId] : [];
}

function missingTabIdsFromCloseResult(result) {
  const candidates = [
    result?.missingTabIds,
    result?.tabGroupPersistenceMitigation?.missingTabIds,
  ].find(Array.isArray);
  return candidates || [];
}

async function cleanupRunTabsById(runId) {
  const before = await readRunState({ runId });
  const cleanupResults = [];
  const closedTabIds = [];
  const missingTabIds = [];

  for (const tabId of before.ownedTabIds) {
    try {
      const result = await command('closeTab', {
        tabId,
        confirmed: true,
        allowExternal: true,
      }, 30_000);
      const closed = closedTabIdsFromCloseResult(result, tabId);
      const missing = missingTabIdsFromCloseResult(result);
      cleanupResults.push({ tabId, ok: true, closedTabIds: closed, missingTabIds: missing, result });
      closedTabIds.push(...closed);
      missingTabIds.push(...missing);
    } catch (error) {
      cleanupResults.push({ tabId, ok: false, error: errorJson(error) });
    }
  }

  const removableTabIds = [...new Set([...closedTabIds, ...missingTabIds])];
  const afterState = removableTabIds.length
    ? await removeOwnedTabs({ runId: before.runId, tabIds: removableTabIds })
    : before;
  const after = removableTabIds.length
    ? afterState
    : await readRunState({ runId: before.runId });

  return {
    ok: cleanupResults.every((result) => result.ok),
    runId: before.runId,
    ownedTabsBefore: before.ownedTabIds,
    closedTabIds: [...new Set(closedTabIds)].sort((a, b) => a - b),
    missingTabIds: [...new Set(missingTabIds)].sort((a, b) => a - b),
    ownedTabsAfter: after.ownedTabIds,
    cleanupResults,
  };
}

async function runNestedTempTabCommand(argv, tabId) {
  const args = parseArgs(argv);
  const [cmd] = args._;
  const scopedArgs = {
    ...args,
    tab: String(tabId),
  };

  if (cmd === 'snapshot' || cmd === 'text') {
    const result = await command(cmd, {
      ...targetPayload(scopedArgs),
      maxChars: parseNumberRangeArg(scopedArgs['max-chars'], '--max-chars', 1_000, 200_000) ?? 200_000,
      ...fullPageReadPayload(scopedArgs),
    }, 30_000);
    return formatReadOutput({
      action: cmd,
      result,
      options: readOutputOptions(scopedArgs),
    });
  }

  if (cmd === 'html') {
    const result = await command('html', {
      ...targetPayload(scopedArgs),
      ...elementTargetPayload(scopedArgs),
      maxChars: parseNumberRangeArg(scopedArgs['max-chars'], '--max-chars', 1_000, 500_000) ?? 500_000,
      outer: !scopedArgs.inner,
    }, 30_000);
    return formatReadOutput({
      action: 'html',
      result,
      options: readOutputOptions(scopedArgs),
    });
  }

  if (cmd === 'screenshot') {
    if (!scopedArgs.out) throw new Error('nested screenshot requires --out <file>');
    const result = await command('screenshot', screenshotPayload(scopedArgs), screenshotTimeoutMs(scopedArgs));
    return formatReadOutput({
      action: 'screenshot',
      result,
      options: readOutputOptions(scopedArgs),
    });
  }

  throw new Error('with-temp-tab currently supports nested text, snapshot, html, or screenshot commands');
}

function parseWithTempTabArgs(argv) {
  const separatorIndex = argv.indexOf('--');
  if (separatorIndex < 0) {
    throw new Error('with-temp-tab requires -- before the nested command');
  }
  const setupArgs = parseArgs(argv.slice(0, separatorIndex));
  const nestedArgv = argv.slice(separatorIndex + 1);
  const [url, ...extraPositionals] = setupArgs._;
  if (!url) throw new Error('with-temp-tab requires a URL');
  if (extraPositionals.length) throw new Error(`Unexpected with-temp-tab argument: ${extraPositionals[0]}`);
  if (!nestedArgv.length) throw new Error('with-temp-tab requires a nested command after --');
  return { setupArgs, nestedArgv, url };
}

async function withTempTab(rawArgv) {
  const { setupArgs, nestedArgv, url } = parseWithTempTabArgs(rawArgv);
  const runId = setupArgs['run-id'] || createRunId('run');
  const before = await readRunState({ runId });
  let opened = null;

  try {
    opened = await command('open', {
      url,
      active: Boolean(setupArgs.active),
      newTab: true,
      ...groupScopePayload(setupArgs),
    }, 30_000);
    const tabId = opened?.id ?? opened?.tab?.id;
    if (!Number.isInteger(tabId)) throw new Error('open did not return a tab id for with-temp-tab');

    await recordOwnedTab({
      runId,
      tabId,
      meta: {
        url: opened.url || url,
        title: opened.title || null,
        groupId: opened.groupId ?? opened.group?.id ?? null,
      },
    });

    const result = await runNestedTempTabCommand(nestedArgv, tabId);
    const cleanup = setupArgs['keep-tab']
      ? {
        ok: true,
        runId,
        ownedTabsBefore: (await readRunState({ runId })).ownedTabIds,
        closedTabIds: [],
        missingTabIds: [],
        ownedTabsAfter: (await readRunState({ runId })).ownedTabIds,
        cleanupResults: [],
      }
      : await cleanupRunTabsById(runId);

    return {
      ok: cleanup.ok,
      runId,
      tempTab: { id: tabId, url: opened.url || url, title: opened.title || null },
      keepTab: Boolean(setupArgs['keep-tab']),
      ownedTabsBefore: before.ownedTabIds,
      ownedTabsAfter: cleanup.ownedTabsAfter,
      closedTabIds: cleanup.closedTabIds,
      missingTabIds: cleanup.missingTabIds,
      cleanupResults: cleanup.cleanupResults,
      result,
    };
  } catch (error) {
    const cleanup = opened && !setupArgs['keep-tab']
      ? await cleanupRunTabsById(runId).catch((cleanupError) => ({
        ok: false,
        runId,
        ownedTabsBefore: [],
        closedTabIds: [],
        missingTabIds: [],
        ownedTabsAfter: [],
        cleanupResults: [{ ok: false, error: errorJson(cleanupError) }],
      }))
      : { ok: true, closedTabIds: [], missingTabIds: [], ownedTabsAfter: before.ownedTabIds, cleanupResults: [] };

    return {
      ok: false,
      runId,
      tempTab: opened ? { id: opened.id ?? opened?.tab?.id ?? null, url: opened.url || url, title: opened.title || null } : null,
      keepTab: Boolean(setupArgs['keep-tab']),
      ownedTabsBefore: before.ownedTabIds,
      ownedTabsAfter: cleanup.ownedTabsAfter,
      closedTabIds: cleanup.closedTabIds,
      missingTabIds: cleanup.missingTabIds,
      cleanupResults: cleanup.cleanupResults,
      result: null,
      error: errorJson(error),
    };
  }
}

function hoverCoordinatePayload(args) {
  const message = 'hover requires --selector or numeric --x and --y';
  const x = parseFiniteNumberArgWithMessage(args.x, '--x', message);
  const y = parseFiniteNumberArgWithMessage(args.y, '--y', message);

  if (args.trusted || (!args.selector && !args.ref)) {
    return {
      x: parseRequiredFiniteNumberArg(args.x, '--x', message),
      y: parseRequiredFiniteNumberArg(args.y, '--y', message),
    };
  }

  return { x, y };
}

function parseJsonOption(value, name) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${String(error?.message || error)}`);
  }
}

function normalizeHttpMethod(value) {
  if (value === undefined) return undefined;
  const method = String(value).toUpperCase();
  if (!HTTP_METHODS.includes(method)) {
    throw new Error(`--method must be one of: ${HTTP_METHODS.join(', ')}`);
  }
  return method;
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function mcpServerPath() {
  return path.join(rootDir, 'mcp/chrome-bridge-mcp.mjs');
}

function stdioJsonServerConfig(options = {}) {
  const config = {
    command: process.execPath,
    args: [mcpServerPath()],
  };
  if (options.toolProfile) {
    config.env = {
      CHROME_BRIDGE_MCP_TOOL_PROFILE: options.toolProfile,
    };
  }
  return config;
}

function mcpServersJsonConfig(options = {}) {
  return {
    mcpServers: {
      'chrome-bridge': stdioJsonServerConfig(options),
    },
  };
}

function vscodeMcpJsonConfig() {
  return {
    servers: {
      chromeBridge: {
        type: 'stdio',
        ...stdioJsonServerConfig(),
      },
    },
  };
}

function codexTomlConfig() {
  return `[mcp_servers.chrome-bridge]
command = ${tomlString(process.execPath)}
args = [${tomlString(mcpServerPath())}]
startup_timeout_sec = 20
tool_timeout_sec = 60
`;
}

function hermesYamlConfig() {
  return [
    'mcp_servers:',
    '  chrome_bridge:',
    `    command: ${JSON.stringify(process.execPath)}`,
    `    args: [${JSON.stringify(mcpServerPath())}]`,
    '',
  ].join('\n');
}

function normalizeMcpClient(value) {
  const normalized = String(value || 'all').toLowerCase().replace(/[_\s]+/g, '-');
  const aliases = {
    claude: 'claude-code',
    anthropic: 'claude-code',
    vscode: 'vscode',
    'vs-code': 'vscode',
    'visual-studio-code': 'vscode',
    cascade: 'windsurf',
    json: 'generic',
    'mcp-json': 'generic',
  };
  return aliases[normalized] || normalized;
}

function recommendedMcpProfile(client) {
  switch (client) {
    case 'cursor':
    case 'windsurf':
      return 'core';
    case 'generic':
      return 'read';
    case 'all':
      return 'full';
    default:
      return 'full';
  }
}

function mcpProfileGuidanceText(profile) {
  if (profile === 'core') {
    return 'Use `CHROME_BRIDGE_MCP_TOOL_PROFILE=core` first. It keeps high-value browser tools available while omitting sensitive private-browser tools such as cookies, storage values, and extension-context requests.';
  }
  if (profile === 'read') {
    return 'Use `CHROME_BRIDGE_MCP_TOOL_PROFILE=read` when the client should inspect and export before any mutation. It keeps the surface conservative and read-mostly.';
  }
  return 'Use `CHROME_BRIDGE_MCP_TOOL_PROFILE=full` when the client can handle the full tool surface or explicitly needs private browser-data tools.';
}

function mcpConfigSections(client) {
  const jsonConfig = JSON.stringify(mcpServersJsonConfig(), null, 2);
  const coreJsonConfig = JSON.stringify(mcpServersJsonConfig({ toolProfile: 'core' }), null, 2);
  const readJsonConfig = JSON.stringify(mcpServersJsonConfig({ toolProfile: 'read' }), null, 2);
  const stdioEntry = JSON.stringify(stdioJsonServerConfig());
  const sections = {
    'claude-code': [
      '## Claude Code',
      '',
      'Recommended profile: `full`.',
      mcpProfileGuidanceText('full'),
      '',
      'Project `.mcp.json` or user config:',
      '',
      '```json',
      jsonConfig,
      '```',
      '',
      'Or add it with Claude Code CLI:',
      '',
      '```bash',
      `claude mcp add-json chrome-bridge ${shellSingleQuote(stdioEntry)}`,
      '```',
    ].join('\n'),
    cursor: [
      '## Cursor',
      '',
      'Recommended profile: `core`.',
      mcpProfileGuidanceText('core'),
      '',
      'Use `.cursor/mcp.json` in a project or `~/.cursor/mcp.json` globally. The `core` tool profile keeps the active tool list below common IDE-agent limits:',
      '',
      '```json',
      coreJsonConfig,
      '```',
    ].join('\n'),
    codex: [
      '## Codex',
      '',
      'Recommended profile: `full`.',
      mcpProfileGuidanceText('full'),
      '',
      'Use `.codex/config.toml` or `~/.codex/config.toml`:',
      '',
      '```toml',
      codexTomlConfig().trimEnd(),
      '```',
    ].join('\n'),
    vscode: [
      '## VS Code',
      '',
      'Recommended profile: `full` first, then `core` only if your VS Code agent warns about tool count.',
      mcpProfileGuidanceText('full'),
      '',
      'Use `.vscode/mcp.json` in a workspace or the user MCP config:',
      '',
      '```json',
      JSON.stringify(vscodeMcpJsonConfig(), null, 2),
      '```',
    ].join('\n'),
    windsurf: [
      '## Windsurf / Cascade',
      '',
      'Recommended profile: `core`.',
      mcpProfileGuidanceText('core'),
      '',
      'Use Windsurf Settings / Cascade or raw `~/.codeium/windsurf/mcp_config.json`. The `core` tool profile keeps the active tool list compact for IDE agents:',
      '',
      '```json',
      coreJsonConfig,
      '```',
    ].join('\n'),
    hermes: [
      '## Hermes Agent',
      '',
      'Recommended profile: `full`.',
      mcpProfileGuidanceText('full'),
      '',
      'Add this under `mcp_servers` in `~/.hermes/config.yaml`:',
      '',
      '```yaml',
      hermesYamlConfig().trimEnd(),
      '```',
    ].join('\n'),
    generic: [
      '## Generic stdio MCP client',
      '',
      'Recommended profile: `read` or `full`, depending on whether the host should stay read-mostly or needs the full browser surface.',
      mcpProfileGuidanceText('read'),
      '',
      'Use this command/args pair wherever the client accepts local stdio servers:',
      '',
      '```json',
      readJsonConfig,
      '```',
    ].join('\n'),
  };
  if (client === 'all') return Object.values(sections);
  if (!sections[client]) {
    throw new Error(`Unsupported --client ${client}. Use all, claude-code, cursor, codex, vscode, windsurf, hermes, or generic.`);
  }
  return [sections[client]];
}

function mcpConfigText(args = {}) {
  const client = normalizeMcpClient(args.client);
  const recommendedProfile = recommendedMcpProfile(client);
  return [
    '# Chrome MCP Bridge client configuration',
    '',
    'These snippets start the local stdio MCP server with the current Node executable.',
    'Install and load the Chrome extension, then install the Native Messaging Host before using live browser tools.',
    client === 'all'
      ? 'Default recommendations: `full` for Claude Code, Codex, VS Code, and Hermes; `core` for Cursor and Windsurf; `read` as the conservative generic fallback.'
      : `Recommended profile for this client: \`${recommendedProfile}\`.`,
    'If a client needs private browser-data tools such as cookies, storage values, or credentialed requests, switch it to `CHROME_BRIDGE_MCP_TOOL_PROFILE=full`.',
    'For local workflow guidance after install, use `chrome_bridge_read_first`, `chrome_bridge_existing_tab`, `chrome_bridge_debug_page`, `chrome_bridge_tool_advisor`, and the `chrome-bridge://profiles/current` resource.',
    '',
    ...mcpConfigSections(client),
    '',
  ].join('\n');
}

function mcpClientFileTemplate(client) {
  switch (client) {
    case 'claude-code':
      return {
        format: 'json',
        content: `${JSON.stringify(mcpServersJsonConfig(), null, 2)}\n`,
      };
    case 'cursor':
      return {
        format: 'json',
        content: `${JSON.stringify(mcpServersJsonConfig({ toolProfile: 'core' }), null, 2)}\n`,
      };
    case 'codex':
      return {
        format: 'toml',
        content: codexTomlConfig(),
      };
    case 'vscode':
      return {
        format: 'json',
        content: `${JSON.stringify(vscodeMcpJsonConfig(), null, 2)}\n`,
      };
    case 'windsurf':
      return {
        format: 'json',
        content: `${JSON.stringify(mcpServersJsonConfig({ toolProfile: 'core' }), null, 2)}\n`,
      };
    case 'hermes':
      return {
        format: 'yaml',
        content: hermesYamlConfig(),
      };
    case 'generic':
      return {
        format: 'json',
        content: `${JSON.stringify(mcpServersJsonConfig({ toolProfile: 'read' }), null, 2)}\n`,
      };
    default:
      throw new Error(`Unsupported --client ${client}. Use claude-code, cursor, codex, vscode, windsurf, hermes, or generic.`);
  }
}

function mcpClientDefaultInstallRelativePath(client) {
  switch (client) {
    case 'claude-code':
      return '.mcp.json';
    case 'cursor':
      return '.cursor/mcp.json';
    case 'codex':
      return '.codex/config.toml';
    case 'vscode':
      return '.vscode/mcp.json';
    default:
      return null;
  }
}

function resolveMcpWriteTarget(client, args = {}) {
  if (args.out) {
    return {
      path: path.resolve(String(args.out)),
      projectLocal: false,
      root: null,
    };
  }
  const relativePath = mcpClientDefaultInstallRelativePath(client);
  if (!relativePath) {
    throw new Error(`Client ${client} has no built-in project-local config path. Pass --out <file> to render a file explicitly.`);
  }
  const root = path.resolve(String(args.root || process.cwd()));
  return {
    path: path.join(root, relativePath),
    projectLocal: true,
    root,
  };
}

async function readOptionalUtf8(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function upsertChromeBridgeJsonConfig(existingText, client) {
  const parsed = existingText ? JSON.parse(existingText) : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('existing config must be a JSON object');
  }

  if (client === 'vscode') {
    const servers = (
      parsed.servers && typeof parsed.servers === 'object' && !Array.isArray(parsed.servers)
    ) ? { ...parsed.servers } : {};
    servers.chromeBridge = {
      type: 'stdio',
      ...stdioJsonServerConfig(),
    };
    return {
      merged: {
        ...parsed,
        servers,
      },
      serverKey: 'servers.chromeBridge',
    };
  }

  const toolProfile = client === 'cursor' || client === 'windsurf'
    ? 'core'
    : client === 'generic'
      ? 'read'
      : null;
  const mcpServers = (
    parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)
  ) ? { ...parsed.mcpServers } : {};
  mcpServers['chrome-bridge'] = stdioJsonServerConfig(toolProfile ? { toolProfile } : {});
  return {
    merged: {
      ...parsed,
      mcpServers,
    },
    serverKey: 'mcpServers.chrome-bridge',
  };
}

function upsertCodexTomlConfig(existingText) {
  const sectionName = 'mcp_servers.chrome-bridge';
  const sectionText = codexTomlConfig().trimEnd();
  const pattern = /^\[mcp_servers\.chrome-bridge\]\n[\s\S]*?(?=^\[[^\]]+\]\n?|$)/m;

  if (!existingText || !existingText.trim()) {
    return `${sectionText}\n`;
  }

  if (pattern.test(existingText)) {
    return `${existingText.replace(pattern, `${sectionText}\n`).replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  }

  const separator = existingText.endsWith('\n') ? '\n' : '\n\n';
  return `${existingText}${separator}${sectionText}\n`;
}

async function writeMcpClientConfig(args = {}) {
  const client = normalizeMcpClient(args.client);
  if (!args.client) throw new Error('mcp-write requires --client <name>');
  if (client === 'all') throw new Error('mcp-write requires one concrete client, not --client all');

  const target = resolveMcpWriteTarget(client, args);
  const template = mcpClientFileTemplate(client);
  const existingText = await readOptionalUtf8(target.path);
  const existed = existingText !== null;
  let nextText = template.content;
  let mergeStrategy = existed ? 'replace-on-force' : 'create';

  if (template.format === 'json') {
    const { merged, serverKey } = upsertChromeBridgeJsonConfig(existingText, client);
    nextText = `${JSON.stringify(merged, null, 2)}\n`;
    mergeStrategy = existed ? `merge:${serverKey}` : `create:${serverKey}`;
  } else if (client === 'codex') {
    nextText = upsertCodexTomlConfig(existingText);
    mergeStrategy = existed ? 'merge:[mcp_servers.chrome-bridge]' : 'create:[mcp_servers.chrome-bridge]';
  } else if (existed && existingText !== template.content && !args.force) {
    throw new Error(`Refusing to overwrite existing ${client} config at ${target.path} without --force`);
  }

  if (existingText === nextText) {
    return {
      ok: true,
      action: 'mcp-write',
      client,
      path: target.path,
      projectLocal: target.projectLocal,
      root: target.root,
      existed,
      changed: false,
      unchanged: true,
      mergeStrategy,
      nextActions: [
        'Run chrome-bridge doctor for offline setup guidance.',
        'When the bridge is free, run chrome-bridge doctor --live-checks.',
      ],
    };
  }

  await fs.mkdir(path.dirname(target.path), { recursive: true });
  await fs.writeFile(target.path, nextText, 'utf8');
  return {
    ok: true,
    action: 'mcp-write',
    client,
    path: target.path,
    projectLocal: target.projectLocal,
    root: target.root,
    existed,
    changed: true,
    created: !existed,
    updated: existed,
    mergeStrategy,
    recommendedProfile: recommendedMcpProfile(client),
    nextActions: [
      target.projectLocal
        ? `Open ${target.path} in your client or workspace settings if it does not auto-discover project-local MCP config.`
        : `Import or copy ${target.path} into the target client config location.`,
      'Run chrome-bridge doctor for offline setup guidance.',
      'When the bridge is free, run chrome-bridge doctor --live-checks.',
    ],
  };
}

const EXPECTED_MANIFEST_PERMISSIONS = MANIFEST_PERMISSIONS;
const EXPECTED_EXTENSION_ACTIONS = EXTENSION_ACTIONS;
const EXPECTED_CLI_COMMANDS = CLI_COMMANDS;
const EXPECTED_MCP_TOOLS = MCP_TOOLS;

async function tryExec(commandName, args, options = {}) {
  if (typeof options.input === 'string') {
    return trySpawnWithInput(commandName, args, options);
  }

  try {
    const result = await execFileAsync(commandName, args, {
      timeout: options.timeout || 5_000,
    });
    return {
      ok: true,
      stdout: result.stdout?.trim() || '',
      stderr: result.stderr?.trim() || '',
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error),
      stdout: error?.stdout?.trim?.() || '',
      stderr: error?.stderr?.trim?.() || '',
    };
  }
}

function trySpawnWithInput(commandName, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(commandName, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeout || 5_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        code,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: code === 0 ? null : `${commandName} exited with code ${code ?? signal}`,
      });
    });
    child.stdin.end(options.input);
  });
}

async function doctor(args) {
  const extensionPath = path.join(rootDir, 'extension');
  const includeLiveChecks = Boolean(args['live-checks']);
  const health = includeLiveChecks
    ? await bridgeFetch('/health').catch((error) => ({
      ok: false,
      error: String(error?.message || error),
    }))
    : {
      ok: null,
      skipped: true,
      reason: 'Pass --live-checks when no other session is using the bridge.',
    };

  const appleEvents = includeLiveChecks
    ? await tryExec('osascript', [
      '-e',
      'tell application "Google Chrome" to execute active tab of front window javascript "document.title"',
    ], { timeout: 3_000 })
    : {
      ok: null,
      skipped: true,
      reason: 'Pass --live-checks to probe real Chrome Apple Events settings.',
    };

  const actions = [];
  if (args['copy-path']) {
    actions.push({
      action: 'copy-path',
      result: await tryExec('pbcopy', [], { input: extensionPath }),
    });
  }

  if (args['open-extensions']) {
    actions.push({
      action: 'open-extensions',
      result: await tryExec('open', ['-a', 'Google Chrome', 'chrome://extensions/']),
    });
  }

  const extensionConnected = includeLiveChecks ? Boolean(health?.extension?.connected) : null;
  const bridgeVersion = health?.bridge?.version || health?.extension?.info?.version || null;
  const bridgeCurrent = includeLiveChecks ? bridgeVersion === EXPECTED_EXTENSION_VERSION : null;
  const extensionVersion = health?.extension?.info?.version || null;
  const extensionCurrent = includeLiveChecks ? extensionVersion === EXPECTED_EXTENSION_VERSION : null;
  const appleEventsJsEnabled = includeLiveChecks ? appleEvents.ok : null;
  const profileRecommendations = {
    claudeCode: 'full',
    cursor: 'core',
    codex: 'full',
    vscode: 'full',
    windsurf: 'core',
    hermes: 'full',
    generic: 'read',
  };

  return {
    bridgeTransport: BRIDGE_TRANSPORT,
    socketPath: bridgeSocketPath(),
    extensionPath,
    liveChecks: includeLiveChecks,
    health,
    checks: {
      expectedBridgeVersion: EXPECTED_EXTENSION_VERSION,
      bridgeVersion,
      bridgeCurrent,
      extensionConnected,
      expectedExtensionVersion: EXPECTED_EXTENSION_VERSION,
      extensionVersion,
      extensionCurrent,
      appleEventsJsEnabled,
      appleEventsError: appleEvents.ok ? null : appleEvents.error,
    },
    mcpProfiles: profileRecommendations,
    actions,
    nextActions: !includeLiveChecks ? [
      'Run chrome-bridge self-test for offline project verification.',
      'Run chrome-bridge runtime-smoke --coverage-plan for the offline live-smoke checklist.',
      'Run chrome-bridge advise --task "configure Cursor MCP setup" or another install goal for the safest next setup commands.',
      'Run chrome-bridge mcp-config --client claude-code|cursor|codex|vscode|windsurf|hermes|generic for a ready-to-paste client snippet.',
      'Pass --live-checks only when no other Codex session is actively using the bridge.',
      'Run chrome-bridge health and runtime-smoke later for final live verification.',
    ] : bridgeCurrent === false ? [
      `Restart the Native Messaging Host; expected ${EXPECTED_EXTENSION_VERSION}, got ${bridgeVersion || 'unknown'}.`,
      'Run chrome-bridge doctor --live-checks again after restarting the Native Messaging Host.',
    ] : extensionConnected && extensionCurrent ? [
      'Run chrome-bridge runtime-smoke for full local runtime verification.',
      'Run ensure-tab/open/snapshot/screenshot commands for task-specific work.',
      'For future extension file edits, run chrome-bridge reload-extension --confirm.',
    ] : extensionConnected ? [
      'Reload the unpacked Chrome MCP Bridge extension in chrome://extensions/.',
      `Confirm chrome-bridge health reports extension.info.version ${EXPECTED_EXTENSION_VERSION}.`,
    ] : [
      'Open chrome://extensions/ in the real Google Chrome profile.',
      'Enable Developer mode.',
      `Load unpacked extension from ${extensionPath}.`,
      'Run chrome-bridge health and confirm extension.connected is true.',
    ],
  };
}

function checkIncludes(text, needles, label) {
  return needles.map((needle) => ({
    label,
    item: needle,
    ok: text.includes(needle),
  }));
}

async function readSelfTestRegistrySource(paths) {
  const files = [
    paths.registry,
    paths.registryActions,
    paths.registryMetadata,
    paths.registryCliUsage,
    paths.registrySurfaces,
    paths.registryGeneratedDocs,
    paths.registryValidation,
    paths.registryIndex,
  ];
  const parts = await Promise.all(files.map((filePath) => fs.readFile(filePath, 'utf8').catch(() => '')));
  return parts.join('\n');
}

async function readSelfTestCliSource(paths) {
  const files = [
    paths.cli,
    paths.cliMain,
  ];
  const parts = await Promise.all(files.map((filePath) => fs.readFile(filePath, 'utf8').catch(() => '')));
  return parts.join('\n');
}

async function readSelfTestMcpSource(paths) {
  const files = [
    paths.mcp,
    paths.mcpMain,
  ];
  const parts = await Promise.all(files.map((filePath) => fs.readFile(filePath, 'utf8').catch(() => '')));
  return parts.join('\n');
}

async function readSelfTestPageScriptsSource(paths) {
  const files = [
    paths.pageScripts,
    paths.pageScriptsMain,
  ];
  const parts = await Promise.all(files.map((filePath) => fs.readFile(filePath, 'utf8').catch(() => '')));
  return parts.join('\n');
}

async function selfTest() {
  const paths = {
    manifest: path.join(rootDir, 'extension/manifest.json'),
    background: path.join(rootDir, 'extension/background.js'),
    browserData: path.join(rootDir, 'extension/browser-data.js'),
    debuggerSession: path.join(rootDir, 'extension/debugger-session.js'),
    extensionErrors: path.join(rootDir, 'extension/extension-errors.js'),
    keyboardEvents: path.join(rootDir, 'extension/keyboard-events.js'),
    navigationActions: path.join(rootDir, 'extension/navigation-actions.js'),
    pageExecution: path.join(rootDir, 'extension/page-execution.js'),
    pageArtifacts: path.join(rootDir, 'extension/page-artifacts.js'),
    pageReadActions: path.join(rootDir, 'extension/page-read-actions.js'),
    pageInteractions: path.join(rootDir, 'extension/page-interactions.js'),
    pageScripts: path.join(rootDir, 'extension/page-scripts.js'),
    pageScriptsMain: path.join(rootDir, 'extension/page-scripts/main.js'),
    runtimeActions: path.join(rootDir, 'extension/runtime-actions.js'),
    safetyGates: path.join(rootDir, 'extension/safety-gates.js'),
    tabCleanup: path.join(rootDir, 'extension/tab-cleanup.js'),
    tabGroupPersistence: path.join(rootDir, 'extension/tab-group-persistence.js'),
    tabInfo: path.join(rootDir, 'extension/tab-info.js'),
    tabLoading: path.join(rootDir, 'extension/tab-loading.js'),
    traceActions: path.join(rootDir, 'extension/trace-actions.js'),
    userPrompts: path.join(rootDir, 'extension/user-prompts.js'),
    workspacePolicy: path.join(rootDir, 'extension/workspace-policy.js'),
    workspaceTabs: path.join(rootDir, 'extension/workspace-tabs.js'),
    ask: path.join(rootDir, 'extension/ask.js'),
    nativeHost: path.join(rootDir, 'native/host.mjs'),
    cli: path.join(rootDir, 'bin/chrome-bridge.mjs'),
    cliMain: path.join(rootDir, 'bin/cli/main.mjs'),
    mcp: path.join(rootDir, 'mcp/chrome-bridge-mcp.mjs'),
    mcpMain: path.join(rootDir, 'mcp/server/main.mjs'),
    registry: path.join(rootDir, 'shared/command-registry.mjs'),
    registryActions: path.join(rootDir, 'shared/registry/actions.mjs'),
    registryMetadata: path.join(rootDir, 'shared/registry/metadata.mjs'),
    registryCliUsage: path.join(rootDir, 'shared/registry/cli-usage.mjs'),
    registrySurfaces: path.join(rootDir, 'shared/registry/surfaces.mjs'),
    registryGeneratedDocs: path.join(rootDir, 'shared/registry/generated-docs.mjs'),
    registryValidation: path.join(rootDir, 'shared/registry/validation.mjs'),
    registryIndex: path.join(rootDir, 'shared/registry/index.mjs'),
    outputEnvelope: path.join(rootDir, 'shared/output-envelope.mjs'),
    runTabs: path.join(rootDir, 'shared/run-tabs.mjs'),
    structuredExtract: path.join(rootDir, 'shared/structured-extract.mjs'),
    downloadDiscovery: path.join(rootDir, 'shared/download-discovery.mjs'),
    lighthouseIngest: path.join(rootDir, 'shared/lighthouse-ingest.mjs'),
    fetchTimeout: path.join(rootDir, 'shared/fetch-timeout.mjs'),
    safeRecord: path.join(rootDir, 'shared/safe-record.mjs'),
    sessionGroupTitle: path.join(rootDir, 'shared/session-group-title.mjs'),
    commandCatalogDoc: path.join(rootDir, 'docs/COMMAND-CATALOG.md'),
    commandCatalogGenerator: path.join(rootDir, 'scripts/docs/generate-command-catalog.mjs'),
    docsCoverageChecker: path.join(rootDir, 'scripts/docs/check-docs-coverage.mjs'),
    packageContentsChecker: path.join(rootDir, 'scripts/package/check-package-contents.mjs'),
    registrySourceHelper: path.join(rootDir, 'scripts/checks/lib/registry-source.mjs'),
    privacyScanner: path.join(rootDir, 'scripts/checks/release/check-privacy-scan.mjs'),
    roadmapNextSliceChecker: path.join(rootDir, 'scripts/checks/features/check-roadmap-next-slice.mjs'),
    packageJson: path.join(rootDir, 'package.json'),
    packageLock: path.join(rootDir, 'package-lock.json'),
  };

  const [
    manifestText,
    background,
    browserData,
    debuggerSession,
    extensionErrors,
    keyboardEvents,
    navigationActions,
    pageExecution,
    pageArtifacts,
    pageReadActions,
    pageInteractions,
    pageScripts,
    runtimeActions,
    safetyGates,
    tabCleanup,
    tabGroupPersistence,
    tabInfo,
    tabLoading,
    traceActions,
    userPrompts,
    workspacePolicy,
    workspaceTabs,
    ask,
    server,
    cli,
    mcp,
    registry,
    runTabs,
    structuredExtract,
    downloadDiscovery,
    lighthouseIngest,
    fetchTimeout,
    safeRecord,
    commandCatalogDoc,
    packageJsonText,
    packageLockText,
  ] = await Promise.all([
    fs.readFile(paths.manifest, 'utf8'),
    fs.readFile(paths.background, 'utf8'),
    fs.readFile(paths.browserData, 'utf8'),
    fs.readFile(paths.debuggerSession, 'utf8'),
    fs.readFile(paths.extensionErrors, 'utf8'),
    fs.readFile(paths.keyboardEvents, 'utf8'),
    fs.readFile(paths.navigationActions, 'utf8'),
    fs.readFile(paths.pageExecution, 'utf8'),
    fs.readFile(paths.pageArtifacts, 'utf8'),
    fs.readFile(paths.pageReadActions, 'utf8'),
    fs.readFile(paths.pageInteractions, 'utf8'),
    readSelfTestPageScriptsSource(paths),
    fs.readFile(paths.runtimeActions, 'utf8'),
    fs.readFile(paths.safetyGates, 'utf8'),
    fs.readFile(paths.tabCleanup, 'utf8'),
    fs.readFile(paths.tabGroupPersistence, 'utf8'),
    fs.readFile(paths.tabInfo, 'utf8'),
    fs.readFile(paths.tabLoading, 'utf8'),
    fs.readFile(paths.traceActions, 'utf8'),
    fs.readFile(paths.userPrompts, 'utf8'),
    fs.readFile(paths.workspacePolicy, 'utf8'),
    fs.readFile(paths.workspaceTabs, 'utf8'),
    fs.readFile(paths.ask, 'utf8'),
    fs.readFile(paths.nativeHost, 'utf8'),
    readSelfTestCliSource(paths),
    readSelfTestMcpSource(paths),
    readSelfTestRegistrySource(paths),
    fs.readFile(paths.runTabs, 'utf8'),
    fs.readFile(paths.structuredExtract, 'utf8'),
    fs.readFile(paths.downloadDiscovery, 'utf8'),
    fs.readFile(paths.lighthouseIngest, 'utf8'),
    fs.readFile(paths.fetchTimeout, 'utf8'),
    fs.readFile(paths.safeRecord, 'utf8'),
    fs.readFile(paths.commandCatalogDoc, 'utf8'),
    fs.readFile(paths.packageJson, 'utf8'),
    fs.readFile(paths.packageLock, 'utf8'),
  ]);

  const manifest = JSON.parse(manifestText);
  const packageJson = JSON.parse(packageJsonText);
  const packageLock = JSON.parse(packageLockText);

  const syntaxChecks = await Promise.all([
    tryExec(process.execPath, ['--check', paths.background]),
    tryExec(process.execPath, ['--check', paths.browserData]),
    tryExec(process.execPath, ['--check', paths.debuggerSession]),
    tryExec(process.execPath, ['--check', paths.extensionErrors]),
    tryExec(process.execPath, ['--check', paths.keyboardEvents]),
    tryExec(process.execPath, ['--check', paths.navigationActions]),
    tryExec(process.execPath, ['--check', paths.pageExecution]),
    tryExec(process.execPath, ['--check', paths.pageArtifacts]),
    tryExec(process.execPath, ['--check', paths.pageReadActions]),
    tryExec(process.execPath, ['--check', paths.pageInteractions]),
    tryExec(process.execPath, ['--check', paths.pageScripts]),
    tryExec(process.execPath, ['--check', paths.pageScriptsMain]),
    tryExec(process.execPath, ['--check', paths.runtimeActions]),
    tryExec(process.execPath, ['--check', paths.safetyGates]),
    tryExec(process.execPath, ['--check', paths.tabCleanup]),
    tryExec(process.execPath, ['--check', paths.tabGroupPersistence]),
    tryExec(process.execPath, ['--check', paths.tabInfo]),
    tryExec(process.execPath, ['--check', paths.tabLoading]),
    tryExec(process.execPath, ['--check', paths.traceActions]),
    tryExec(process.execPath, ['--check', paths.userPrompts]),
    tryExec(process.execPath, ['--check', paths.workspacePolicy]),
    tryExec(process.execPath, ['--check', paths.workspaceTabs]),
    tryExec(process.execPath, ['--check', paths.ask]),
    tryExec(process.execPath, ['--check', paths.nativeHost]),
    tryExec(process.execPath, ['--check', paths.cli]),
    tryExec(process.execPath, ['--check', paths.cliMain]),
    tryExec(process.execPath, ['--check', paths.mcp]),
    tryExec(process.execPath, ['--check', paths.mcpMain]),
    tryExec(process.execPath, ['--check', paths.registry]),
    tryExec(process.execPath, ['--check', paths.registryActions]),
    tryExec(process.execPath, ['--check', paths.registryMetadata]),
    tryExec(process.execPath, ['--check', paths.registryCliUsage]),
    tryExec(process.execPath, ['--check', paths.registrySurfaces]),
    tryExec(process.execPath, ['--check', paths.registryGeneratedDocs]),
    tryExec(process.execPath, ['--check', paths.registryValidation]),
    tryExec(process.execPath, ['--check', paths.registryIndex]),
    tryExec(process.execPath, ['--check', paths.outputEnvelope]),
    tryExec(process.execPath, ['--check', paths.runTabs]),
    tryExec(process.execPath, ['--check', paths.structuredExtract]),
    tryExec(process.execPath, ['--check', paths.downloadDiscovery]),
    tryExec(process.execPath, ['--check', paths.lighthouseIngest]),
    tryExec(process.execPath, ['--check', paths.fetchTimeout]),
    tryExec(process.execPath, ['--check', paths.safeRecord]),
    tryExec(process.execPath, ['--check', paths.sessionGroupTitle]),
    tryExec(process.execPath, ['--check', paths.commandCatalogGenerator]),
    tryExec(process.execPath, ['--check', paths.docsCoverageChecker]),
    tryExec(process.execPath, ['--check', paths.packageContentsChecker]),
    tryExec(process.execPath, ['--check', paths.registrySourceHelper]),
    tryExec(process.execPath, ['--check', paths.privacyScanner]),
    tryExec(process.execPath, ['--check', paths.roadmapNextSliceChecker]),
  ]);

  const permissionChecks = EXPECTED_MANIFEST_PERMISSIONS.map((permission) => ({
    label: 'manifest permission',
    item: permission,
    ok: manifest.permissions?.includes(permission),
  }));

  const versionChecks = [
    { label: 'manifest version', item: EXPECTED_EXTENSION_VERSION, ok: manifest.version === EXPECTED_EXTENSION_VERSION },
    { label: 'ask page script', item: 'codex-bridge-user-answer', ok: ask.includes('codex-bridge-user-answer') },
    { label: 'extension module', item: 'browser data imports', ok: background.includes("from './browser-data.js'") },
    { label: 'extension module', item: 'browser data exports', ok: browserData.includes('export async function historySearch') && browserData.includes('export async function cookiesList') },
    { label: 'extension module', item: 'debugger session imports', ok: background.includes("from './debugger-session.js'") },
    { label: 'extension module', item: 'debugger session exports', ok: debuggerSession.includes('export async function withDebugger') && debuggerSession.includes('export function recordDebuggerEvent') },
    { label: 'extension module', item: 'extension error imports', ok: background.includes("from './extension-errors.js'") },
    { label: 'extension module', item: 'extension error exports', ok: extensionErrors.includes('export function extensionErrorCode') },
    { label: 'extension module', item: 'keyboard events imports', ok: pageInteractions.includes("from './keyboard-events.js'") },
    { label: 'extension module', item: 'keyboard events exports', ok: keyboardEvents.includes('export function keyEventPayload') },
    { label: 'extension module', item: 'navigation action imports', ok: background.includes("from './navigation-actions.js'") },
    { label: 'extension module', item: 'navigation action exports', ok: navigationActions.includes('export async function openTab') && navigationActions.includes('export async function closeGroup') },
    { label: 'extension module', item: 'page execution imports', ok: pageInteractions.includes("from './page-execution.js'") },
    { label: 'extension module', item: 'page execution exports', ok: pageExecution.includes('export async function execute') },
    { label: 'extension module', item: 'page artifact imports', ok: background.includes("from './page-artifacts.js'") },
    { label: 'extension module', item: 'page artifact exports', ok: pageArtifacts.includes('export async function screenshot') && pageArtifacts.includes('export async function printPdf') },
    { label: 'extension module', item: 'page read action imports', ok: background.includes("from './page-read-actions.js'") },
    { label: 'extension module', item: 'page read action exports', ok: pageReadActions.includes('export async function observe') && pageReadActions.includes('export async function storageSnapshot') },
    { label: 'extension module', item: 'page interaction imports', ok: background.includes("from './page-interactions.js'") },
    { label: 'extension module', item: 'page interaction exports', ok: pageInteractions.includes('export async function click') && pageInteractions.includes('export async function uploadFile') },
    { label: 'extension module', item: 'page script imports', ok: pageReadActions.includes("from './page-scripts.js'") && pageInteractions.includes("from './page-scripts.js'") },
    { label: 'extension module', item: 'page script exports', ok: pageScripts.includes('function collectSnapshot') },
    { label: 'extension module', item: 'runtime action imports', ok: background.includes("from './runtime-actions.js'") },
    { label: 'extension module', item: 'runtime action exports', ok: runtimeActions.includes('export function reloadExtension') },
    { label: 'extension module', item: 'safety gates imports', ok: runtimeActions.includes("from './safety-gates.js'") },
    { label: 'extension module', item: 'safety gates exports', ok: safetyGates.includes('export function requireConfirmed') },
    { label: 'extension module', item: 'tab cleanup imports', ok: navigationActions.includes("from './tab-cleanup.js'") },
    { label: 'extension module', item: 'tab cleanup exports', ok: tabCleanup.includes('export async function closeTabsWithGroupPersistenceMitigation') },
    { label: 'extension module', item: 'tab cleanup fail closed', ok: tabCleanup.includes('throw new Error') && tabCleanup.includes('before close') },
    { label: 'extension module', item: 'tab group persistence imports', ok: tabCleanup.includes("from './tab-group-persistence.js'") && workspaceTabs.includes("from './tab-group-persistence.js'") },
    { label: 'extension module', item: 'tab group persistence exports', ok: tabGroupPersistence.includes('export async function disableSavedTabGroupIfSupported') && tabGroupPersistence.includes('export async function disableSavedTabGroupsForTabs') },
    { label: 'extension module', item: 'tab info imports', ok: pageInteractions.includes("from './tab-info.js'") && navigationActions.includes("from './tab-info.js'") },
    { label: 'extension module', item: 'tab info exports', ok: tabInfo.includes('export function tabInfo') && tabInfo.includes('export function groupInfo') },
    { label: 'extension module', item: 'tab loading imports', ok: navigationActions.includes("from './tab-loading.js'") },
    { label: 'extension module', item: 'tab loading exports', ok: tabLoading.includes('export async function waitForTabComplete') },
    { label: 'extension module', item: 'trace action imports', ok: background.includes("from './trace-actions.js'") },
    { label: 'extension module', item: 'trace action exports', ok: traceActions.includes('export async function traceStart') && traceActions.includes('export async function traceStop') },
    { label: 'extension module', item: 'user prompt imports', ok: background.includes("from './user-prompts.js'") },
    { label: 'extension module', item: 'user prompt exports', ok: userPrompts.includes('export async function askUser') && userPrompts.includes('export function completeUserPrompt') },
    { label: 'extension module', item: 'workspace policy imports', ok: navigationActions.includes("from './workspace-policy.js'") },
    { label: 'extension module', item: 'workspace policy exports', ok: workspacePolicy.includes('export async function groupOptions') },
    { label: 'extension module', item: 'workspace tabs imports', ok: navigationActions.includes("from './workspace-tabs.js'") && pageInteractions.includes("from './workspace-tabs.js'") && traceActions.includes("from './workspace-tabs.js'") },
    { label: 'extension module', item: 'workspace tabs exports', ok: workspaceTabs.includes('export async function getTargetTab') && workspaceTabs.includes('export async function ensureCodexGroupForTab') },
    { label: 'registry version', item: EXPECTED_EXTENSION_VERSION, ok: registry.includes(`BRIDGE_VERSION = '${EXPECTED_EXTENSION_VERSION}'`) },
    { label: 'server registry version', item: EXPECTED_EXTENSION_VERSION, ok: server.includes('BRIDGE_VERSION') },
    { label: 'cli registry version', item: EXPECTED_EXTENSION_VERSION, ok: cli.includes('EXPECTED_EXTENSION_VERSION = BRIDGE_VERSION') },
    { label: 'mcp registry version', item: EXPECTED_EXTENSION_VERSION, ok: mcp.includes('version: BRIDGE_VERSION') },
    { label: 'session group title imports', item: 'CLI and MCP', ok: cli.includes("from '../../shared/session-group-title.mjs'") && mcp.includes("from '../../shared/session-group-title.mjs'") },
    { label: 'package version', item: EXPECTED_EXTENSION_VERSION, ok: packageJson.version === EXPECTED_EXTENSION_VERSION },
    { label: 'package-lock root version', item: EXPECTED_EXTENSION_VERSION, ok: packageLock.version === EXPECTED_EXTENSION_VERSION && packageLock.packages?.['']?.version === EXPECTED_EXTENSION_VERSION },
  ];

  const actionChecks = EXPECTED_EXTENSION_ACTIONS.flatMap((action) => [
    { label: 'background dispatch', item: action, ok: background.includes(`case '${action}':`) },
  ]);

  const cliChecks = checkIncludes(usage(), EXPECTED_CLI_COMMANDS, 'cli usage');
  const mcpChecks = checkIncludes(mcp, EXPECTED_MCP_TOOLS, 'mcp tool');
  const registryChecks = [
    {
      label: 'registry',
      item: 'command metadata parity',
      ok: Object.keys(COMMAND_METADATA).length === EXPECTED_EXTENSION_ACTIONS.length,
    },
    {
      label: 'registry',
      item: 'command risk tiers',
      ok: EXPECTED_EXTENSION_ACTIONS.every((action) => typeof COMMAND_METADATA[action]?.riskTier === 'string'),
    },
    {
      label: 'registry',
      item: 'command default timeouts',
      ok: EXPECTED_EXTENSION_ACTIONS.every((action) => Number.isFinite(COMMAND_METADATA[action]?.defaultTimeoutMs)),
    },
    {
      label: 'registry',
      item: 'command catalog metadata',
      ok: COMMAND_CATALOG.length === EXPECTED_EXTENSION_ACTIONS.length
        && COMMAND_CATALOG.every((entry) => entry.summary && Array.isArray(entry.cli) && Array.isArray(entry.mcp)),
    },
    {
      label: 'registry',
      item: 'generated command catalog doc',
      ok: commandCatalogDoc === commandCatalogMarkdown(),
    },
    {
      label: 'registry',
      item: 'find-elements nearText contract',
      ok: COMMAND_METADATA.findElements?.allowedKeys?.includes('nearText')
        && usage().includes('--near-text <text>')
        && mcp.includes('nearText: z.string().optional()')
        && pageScripts.includes('nearTextNeedle'),
    },
    {
      label: 'registry',
      item: 'strict workspace policy mode',
      ok: workspacePolicy.includes("['open', 'scoped', 'strict']")
        && usage().includes('--policy-mode open|scoped|strict')
        && mcp.includes("z.enum(['open', 'scoped', 'strict'])")
        && workspaceTabs.includes("policyMode === 'strict'"),
    },
    {
      label: 'registry',
      item: 'upload-file files contract',
      ok: registry.includes('function ensureStringArray')
        && registry.includes("ensureStringArray(normalizedPayload, 'files', action)")
        && mcp.includes('files: z.array(z.string()).optional()')
        && usage().includes('--files-json <json>'),
    },
    {
      label: 'registry',
      item: 'docs coverage checker',
      ok: packageJson.scripts?.['check:docs'] === 'node ./scripts/docs/check-docs-coverage.mjs'
        && packageJson.scripts?.check?.includes('npm run check:docs')
        && cli.includes('docsCoverageChecker'),
    },
    {
      label: 'registry',
      item: 'package contents checker',
      ok: packageJson.scripts?.['check:pack'] === 'node ./scripts/package/check-package-contents.mjs'
        && packageJson.scripts?.check?.includes('check-package-contents.mjs')
        && cli.includes('packageContentsChecker'),
    },
    {
      label: 'registry',
      item: 'privacy scanner',
      ok: packageJson.scripts?.['check:privacy'] === 'node ./scripts/checks/release/check-privacy-scan.mjs'
        && packageJson.scripts?.check?.includes('npm run check:privacy')
        && cli.includes('privacyScanner'),
    },
    {
      label: 'registry',
      item: 'runtime timeout defaults',
      ok: cli.includes('timeoutMs ?? commandDefaultTimeoutMs(action)')
        && mcp.includes('timeoutMs ?? commandDefaultTimeoutMs(action)'),
    },
    {
      label: 'shared helper',
      item: 'unsafe object key stripping',
      ok: safeRecord.includes('stripUnsafeObjectKeys')
        && runTabs.includes('stripUnsafeObjectKeys(meta'),
    },
    {
      label: 'shared helper',
      item: 'structured extraction presets',
      ok: structuredExtract.includes('STRUCTURED_EXTRACTION_PRESETS')
        && structuredExtract.includes("'article'")
        && structuredExtract.includes("'product-page'")
        && structuredExtract.includes("'pricing-table'")
        && cli.includes('buildStructuredPresetExtraction')
        && mcp.includes('buildStructuredPresetExtraction'),
    },
    {
      label: 'shared helper',
      item: 'download discovery',
      ok: downloadDiscovery.includes('DOWNLOAD_DISCOVERY_OUTPUT_CONTRACT_VERSION')
        && cli.includes("cmd === 'download-discovery'")
        && mcp.includes("'chrome_bridge_download_discovery'"),
    },
    {
      label: 'shared helper',
      item: 'lighthouse ingest',
      ok: lighthouseIngest.includes('LIGHTHOUSE_INGEST_OUTPUT_CONTRACT_VERSION')
        && cli.includes("cmd === 'lighthouse-ingest'")
        && mcp.includes("'chrome_bridge_lighthouse_ingest'"),
    },
    {
      label: 'registry',
      item: 'CLI usage signatures',
      ok: registry.includes('CLI_USAGE_LINES')
        && registry.includes('CLI_USAGE_GROUPS')
        && CLI_USAGE_LINES.length === EXPECTED_CLI_COMMANDS.length
        && CLI_USAGE_GROUPS.reduce((sum, group) => sum + group.commands.length, 0) === EXPECTED_CLI_COMMANDS.length
        && CLI_USAGE_LINES.every((line) => usage().includes(line))
        && commandCatalogMarkdown().includes('## CLI Usage Signatures'),
    },
  ];

  const pressBlock = /if \(cmd === 'press'\) \{[\s\S]*?\n  \}/.exec(cli)?.[0] || '';

  const safetyChecks = [
    { label: 'safety gate', item: 'requireConfirmed', ok: safetyGates.includes('function requireConfirmed') },
    { label: 'safety gate', item: 'requireSensitiveConfirmed', ok: safetyGates.includes('function requireSensitiveConfirmed') },
    { label: 'safety gate', item: 'whole cookie jar confirmSensitive', ok: browserData.includes("cookiesList without url/domain/name") },
    { label: 'safety gate', item: 'credentialed request confirmSensitive', ok: browserData.includes("credentials === 'include'") },
    { label: 'safety gate', item: 'extension request method allowlist', ok: registry.includes('HTTP_METHODS') && cli.includes('normalizeHttpMethod') && mcp.includes('z.enum(HTTP_METHODS)') },
    {
      label: 'bridge guard',
      item: 'debugger actions serialized per tab',
      ok: registry.includes('DEBUGGER_SERIALIZED_ACTIONS')
        && DEBUGGER_SERIALIZED_ACTIONS.length >= 10
        && debuggerSession.includes('const debuggerLocks = new Map()')
        && debuggerSession.includes('async function withTabLock')
        && debuggerSession.includes('export async function withDebugger')
        && debuggerSession.includes('return withTabLock(tabId')
        && traceActions.includes('startTraceForTab')
        && traceActions.includes('stopTraceForTab'),
    },
    { label: 'trace privacy', item: 'no response body capture', ok: !background.includes('Network.getResponseBody') },
    {
      label: 'safety gate',
      item: 'press trusted input is opt-in',
      ok: pressBlock.includes('trusted: Boolean(args.trusted)')
        && pageInteractions.includes('if (payload.trusted === true)')
        && usage().includes('press --key <key> --confirm [--selector <css> | --ref <ref>] [--trusted]'),
    },
    {
      label: 'observability',
      item: 'session summary includes workspace policy state',
      ok: cli.includes("command('workspace', { includeTabs: true }, 10_000)")
        && cli.includes('summaryRecommendations(health, group, workspace)')
        && mcp.includes("bridgeCommand('workspace', { includeTabs: true }, 10_000)")
        && mcp.includes('summaryRecommendations(health, group, workspace)'),
    },
    {
      label: 'observability',
      item: 'debug bundle page artifacts are opt-in',
      ok: cli.includes("args['include-snapshot']")
        && cli.includes("args['include-observe']")
        && cli.includes("args['include-screenshot']")
        && cli.includes("args['include-trace-events']")
        && mcp.includes('includeSnapshot: z.boolean().optional()')
        && mcp.includes('includeObserve: z.boolean().optional()')
        && mcp.includes('includeScreenshot: z.boolean().optional()')
        && mcp.includes('includeTraceEvents: z.boolean().optional()')
        && cli.includes('trace-summary.json'),
    },
    {
      label: 'observability',
      item: 'extension error codes propagate through bridge',
      ok: extensionErrors.includes('function extensionErrorCode')
        && background.includes('code: extensionErrorCode(error)')
        && cli.includes('nativeBridgeCommand')
        && mcp.includes('nativeBridgeCommand'),
    },
  ];

  const checks = [
    ...syntaxChecks.map((result, index) => ({
      label: 'syntax',
      item: [
        paths.background,
        paths.browserData,
        paths.debuggerSession,
        paths.extensionErrors,
        paths.keyboardEvents,
        paths.navigationActions,
        paths.pageExecution,
        paths.pageArtifacts,
        paths.pageReadActions,
        paths.pageInteractions,
        paths.pageScripts,
        paths.runtimeActions,
        paths.safetyGates,
        paths.tabCleanup,
        paths.tabGroupPersistence,
        paths.tabInfo,
        paths.tabLoading,
        paths.traceActions,
        paths.userPrompts,
        paths.workspacePolicy,
        paths.workspaceTabs,
        paths.ask,
        paths.nativeHost,
        paths.cli,
        paths.mcp,
        paths.registry,
        paths.outputEnvelope,
        paths.runTabs,
        paths.structuredExtract,
        paths.downloadDiscovery,
        paths.lighthouseIngest,
        paths.fetchTimeout,
        paths.safeRecord,
        paths.commandCatalogGenerator,
        paths.bridgeContractChecker,
        paths.docsCoverageChecker,
        paths.packageContentsChecker,
        paths.privacyScanner,
        paths.roadmapNextSliceChecker,
      ][index],
      ok: result.ok,
      error: result.ok ? undefined : result.error || result.stderr,
    })),
    ...permissionChecks,
    ...versionChecks,
    ...actionChecks,
    ...cliChecks,
    ...mcpChecks,
    ...registryChecks,
    ...safetyChecks,
  ];

  const failures = checks.filter((check) => !check.ok);
  return {
    ok: failures.length === 0,
    expectedVersion: EXPECTED_EXTENSION_VERSION,
    counts: {
      checks: checks.length,
      failures: failures.length,
      extensionActions: EXPECTED_EXTENSION_ACTIONS.length,
      cliCommands: EXPECTED_CLI_COMMANDS.length,
      mcpTools: EXPECTED_MCP_TOOLS.length,
    },
    failures,
  };
}

function smokeHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Codex Bridge Smoke</title>
    <style>
      body { font-family: system-ui, sans-serif; min-height: 1800px; padding: 24px; }
      main { max-width: 720px; }
      button, input, select { display: block; margin: 12px 0; padding: 8px; }
      #spacer { height: 1200px; }
    </style>
  </head>
  <body>
    <main id="fixture">
      <h1>Codex Bridge Smoke</h1>
      <p id="ready">Ready</p>
      <input id="smoke-input" value="">
      <p id="typed"></p>
      <p id="pressed"></p>
      <select id="smoke-select">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </select>
      <p id="selected"></p>
      <button id="action" type="button">Action</button>
      <p id="clicked"></p>
      <button type="button">Anonymous fallback target</button>
      <button id="coord" type="button">Coordinate Target</button>
      <p id="coord-clicked"></p>
      <button id="dialog-button" type="button">Dialog Target</button>
      <p id="dialog-result"></p>
      <input id="smoke-file" type="file">
      <p id="uploaded"></p>
      <button id="hover-target" type="button">Hover Target</button>
      <p id="hovered"></p>
      <div id="spacer">Full page capture area</div>
    </main>
    <script>
      localStorage.setItem('codexBridgeSmokeLocal', 'local-ok');
      sessionStorage.setItem('codexBridgeSmokeSession', 'session-ok');
      const typed = document.querySelector('#typed');
      const pressed = document.querySelector('#pressed');
      const selected = document.querySelector('#selected');
      const clicked = document.querySelector('#clicked');
      const coordClicked = document.querySelector('#coord-clicked');
      const dialogResult = document.querySelector('#dialog-result');
      const uploaded = document.querySelector('#uploaded');
      const hovered = document.querySelector('#hovered');
      document.querySelector('#smoke-input').addEventListener('input', (event) => {
        typed.textContent = event.target.value;
        typed.dataset.value = event.target.value;
      });
      document.querySelector('#smoke-input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          pressed.textContent = 'Enter';
          pressed.dataset.key = 'Enter';
          console.log('smoke press enter');
        }
      });
      document.querySelector('#smoke-select').addEventListener('change', (event) => {
        selected.textContent = event.target.value;
        selected.dataset.value = event.target.value;
      });
      document.querySelector('#action').addEventListener('click', () => {
        clicked.textContent = 'clicked';
        clicked.dataset.value = 'clicked';
        console.log('smoke action clicked');
        fetch('/ping?source=action').catch(() => {});
      });
      document.querySelector('#coord').addEventListener('click', () => {
        coordClicked.textContent = 'coord';
        coordClicked.dataset.value = 'coord';
      });
      document.querySelector('#dialog-button').addEventListener('click', () => {
        setTimeout(() => {
          const value = window.prompt('Codex Bridge smoke prompt', '');
          dialogResult.textContent = value || 'empty';
          dialogResult.dataset.value = value || 'empty';
        }, 50);
      });
      document.querySelector('#smoke-file').addEventListener('change', (event) => {
        const files = Array.from(event.target.files || []);
        uploaded.textContent = String(files.length);
        uploaded.dataset.count = String(files.length);
        uploaded.dataset.name = files[0]?.name || '';
      });
      document.querySelector('#hover-target').addEventListener('mouseover', () => {
        hovered.textContent = 'hovered';
        hovered.dataset.value = 'hovered';
      });
    </script>
  </body>
</html>`;
}

function startSmokeServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/ping') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify({ ok: true, source: url.searchParams.get('source') || 'direct' }));
        return;
      }

      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': 'codex_bridge_smoke=ok; SameSite=Lax; Path=/',
      });
      res.end(smokeHtml());
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind smoke server'));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/`,
        pingUrl: `http://127.0.0.1:${address.port}/ping?source=request`,
      });
    });
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeStepResult(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.dataUrl) {
    const mediaType = /^data:([^;,]+);base64,/.exec(value.dataUrl)?.[1] || 'unknown';
    return {
      ...value,
      dataUrl: `data:${mediaType};base64,<${value.dataUrl.length} chars>`,
    };
  }
  if (typeof value.text === 'string' && value.text.length > 500) {
    return {
      ...value,
      text: `${value.text.slice(0, 500)}...`,
    };
  }
  if (typeof value.html === 'string' && value.html.length > 500) {
    return {
      ...value,
      html: `${value.html.slice(0, 500)}...`,
    };
  }
  return value;
}

async function sessionSummary() {
  const health = await bridgeFetch('/health').catch((error) => ({
    ok: false,
    code: error.code || null,
    error: String(error?.message || error),
  }));
  const group = await command('group', {}, 10_000).catch((error) => ({
    ok: false,
    code: error.code || null,
    error: String(error?.message || error),
  }));
  const workspace = await command('workspace', { includeTabs: true }, 10_000).catch((error) => ({
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
    nextActions: summaryNextActions(health, group, workspace),
    recommendations: summaryRecommendations(health, group, workspace),
  };
}

function summaryRecommendations(health, group, workspace) {
  const recommendations = [];
  const bridgeVersion = health?.bridge?.version || health?.extension?.info?.version;
  const extensionVersion = health?.extension?.info?.version;
  const policyMode = workspace?.policy?.mode || workspace?.workspace?.policyMode;
  if (bridgeVersion && bridgeVersion !== EXPECTED_EXTENSION_VERSION) {
    recommendations.push(`Restart the Native Messaging Host; expected ${EXPECTED_EXTENSION_VERSION}, got ${bridgeVersion}.`);
  }
  if (extensionVersion && extensionVersion !== EXPECTED_EXTENSION_VERSION) {
    recommendations.push(`Reload the unpacked extension; expected ${EXPECTED_EXTENSION_VERSION}, got ${extensionVersion}.`);
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

  if (bridgeVersion && bridgeVersion !== EXPECTED_EXTENSION_VERSION) {
    actions.push('Restart the Native Messaging Host, then run chrome-bridge doctor --live-checks.');
    return actions;
  }
  if (extensionVersion && extensionVersion !== EXPECTED_EXTENSION_VERSION) {
    actions.push('Run chrome-bridge reload-extension --confirm, then rerun chrome-bridge doctor --live-checks.');
    return actions;
  }
  if (!extensionConnected) {
    actions.push('Load or reload the unpacked Chrome MCP Bridge extension in chrome://extensions/.');
    actions.push('After that, run chrome-bridge health and confirm extension.connected is true.');
    return actions;
  }
  if (!hasScopedTabs) {
    actions.push('Run chrome-bridge ensure-tab or chrome-bridge adopt-tab --confirm before browser work.');
  } else {
    actions.push('Start with chrome-bridge observe or chrome-bridge snapshot before any interaction.');
  }
  if (policyMode === 'strict') {
    actions.push('Strict workspace policy is active, so keep browser work inside the scoped group or change the workspace policy first.');
  }
  actions.push('If you need the safest next command for a goal, run chrome-bridge advise --task "<goal>".');
  return actions;
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeDataUrlFile(filePath, dataUrl, expectedPrefix) {
  const match = new RegExp(`^${expectedPrefix},(.+)$`).exec(dataUrl || '');
  if (!match) throw new Error(`Invalid data URL for ${filePath}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(match[1], 'base64'));
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

const RUNTIME_SMOKE_REQUIRED_COVERAGE = Object.freeze([
  'adopt existing smoke tab',
  'set strict smoke workspace',
  'workspace includes smoke tab',
  'session summary covers strict policy',
  'debug bundle default redaction',
  'tabs scoped includes smoke tab',
  'observe actionable elements',
  'observe nth-of-type selector fallback',
  'find-elements filtered',
  'find-elements near text filtered',
  'extract forms',
  'viewport screenshot',
  'selector screenshot',
  'pdf export',
  'handle dialog prompt',
  'upload file input',
  'wait for type side-effect',
  'wait for press side-effect',
  'wait for select side-effect',
  'wait for click side-effect',
  'wait for coordinate click side-effect',
  'trace events',
  'storage keys',
  'cookies metadata by url',
  'extension-context request',
  'history search scoped to fixture url',
  'safety: cookies whole jar requires confirmSensitive',
  'safety: storage values require confirmSensitive',
  'safety: credentialed request requires confirmSensitive',
  'strict policy rejects outside tab even with allowExternal',
  'cleanup close outside smoke group',
  'cleanup close smoke tab',
]);

const RUNTIME_SMOKE_FINAL_COMMANDS = Object.freeze([
  'chrome-bridge reload-extension --confirm',
  'chrome-bridge doctor --live-checks',
  'chrome-bridge runtime-smoke',
]);

const RUNTIME_SMOKE_FINAL_MCP_CALLS = Object.freeze([
  { tool: 'chrome_bridge_reload_extension', arguments: { confirmed: true } },
  { tool: 'chrome_bridge_doctor', arguments: { liveChecks: true } },
  { tool: 'chrome_bridge_runtime_smoke', arguments: {} },
]);

const RUNTIME_SMOKE_RELOAD_EXTENSION_ACTION = 'Reload the unpacked Chrome MCP Bridge extension, then run chrome-bridge doctor --live-checks.';
const RUNTIME_SMOKE_RESTART_BRIDGE_ACTION = 'Restart the Native Messaging Host, then run chrome-bridge doctor --live-checks.';
const RUNTIME_SMOKE_RERUN_ACTION = 'Review the smoke failures, fix the issue, then run chrome-bridge runtime-smoke again.';

function runtimeSmokeFinalMcpCalls() {
  return RUNTIME_SMOKE_FINAL_MCP_CALLS.map((call) => ({
    tool: call.tool,
    arguments: { ...call.arguments },
  }));
}

function runtimeSmokeNextStep({ status, bridgeVersion, extensionVersion } = {}) {
  if (status === 'passed') return { nextCommand: null, nextAction: null };
  if (bridgeVersion && bridgeVersion !== EXPECTED_EXTENSION_VERSION) {
    return {
      nextCommand: 'chrome-bridge doctor --live-checks',
      nextAction: RUNTIME_SMOKE_RESTART_BRIDGE_ACTION,
    };
  }
  if (extensionVersion && extensionVersion !== EXPECTED_EXTENSION_VERSION) {
    return {
      nextCommand: 'chrome-bridge reload-extension --confirm',
      nextAction: RUNTIME_SMOKE_RELOAD_EXTENSION_ACTION,
    };
  }
  return {
    nextCommand: 'chrome-bridge runtime-smoke',
    nextAction: RUNTIME_SMOKE_RERUN_ACTION,
  };
}

function redactDebugBundleValue(value) {
  if (Array.isArray(value)) return value.map((item) => redactDebugBundleValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    DEBUG_BUNDLE_REDACTED_KEYS.has(key) ? '[redacted]' : redactDebugBundleValue(entry),
  ]));
}

function runtimeSmokeCoverage(steps) {
  const successfulSteps = new Set(steps
    .filter((step) => step.ok)
    .map((step) => step.name));
  const covered = RUNTIME_SMOKE_REQUIRED_COVERAGE.filter((name) => successfulSteps.has(name));
  const missing = RUNTIME_SMOKE_REQUIRED_COVERAGE.filter((name) => !successfulSteps.has(name));
  return {
    ok: missing.length === 0,
    requiredCount: RUNTIME_SMOKE_REQUIRED_COVERAGE.length,
    coveredCount: covered.length,
    missingCount: missing.length,
    required: RUNTIME_SMOKE_REQUIRED_COVERAGE,
    covered,
    missing,
  };
}

function runtimeSmokeCoveragePlan(startedAt) {
  return {
    ok: true,
    mode: 'coverage-plan',
    liveBridge: false,
    finalVerificationComplete: false,
    skipped: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    expectedVersion: EXPECTED_EXTENSION_VERSION,
    reason: 'Coverage plan only; no bridge or Chrome checks were run.',
    nextCommand: 'chrome-bridge reload-extension --confirm',
    nextAction: RUNTIME_SMOKE_RELOAD_EXTENSION_ACTION,
    verification: {
      status: 'not-run',
      liveVerificationRequired: true,
      nextCommand: 'chrome-bridge reload-extension --confirm',
      nextAction: RUNTIME_SMOKE_RELOAD_EXTENSION_ACTION,
      finalCommands: [...RUNTIME_SMOKE_FINAL_COMMANDS],
      finalMcpCalls: runtimeSmokeFinalMcpCalls(),
      successCriteria: {
        ok: true,
        coverageOk: true,
        bridgeVersion: EXPECTED_EXTENSION_VERSION,
        extensionVersion: EXPECTED_EXTENSION_VERSION,
        requiredCoverageCount: RUNTIME_SMOKE_REQUIRED_COVERAGE.length,
      },
    },
    coverage: runtimeSmokeCoverage([]),
  };
}

function runtimeSmokeLiveVerification({ status, bridgeVersion = null, extensionVersion = null, failures = [], coverage = null } = {}) {
  const effectiveStatus = status || (failures.length === 0 && coverage?.ok ? 'passed' : 'failed');
  const nextStep = runtimeSmokeNextStep({ status: effectiveStatus, bridgeVersion, extensionVersion });
  return {
    status: effectiveStatus,
    liveVerificationRequired: effectiveStatus !== 'passed',
    nextCommand: nextStep.nextCommand,
    nextAction: nextStep.nextAction,
    finalCommands: [...RUNTIME_SMOKE_FINAL_COMMANDS],
    finalMcpCalls: runtimeSmokeFinalMcpCalls(),
    successCriteria: {
      ok: true,
      coverageOk: true,
      bridgeVersion: EXPECTED_EXTENSION_VERSION,
      extensionVersion: EXPECTED_EXTENSION_VERSION,
      requiredCoverageCount: RUNTIME_SMOKE_REQUIRED_COVERAGE.length,
    },
    observed: {
      bridgeVersion,
      extensionVersion,
      failures: failures.length,
      coverageOk: coverage?.ok ?? false,
      coveredCount: coverage?.coveredCount ?? 0,
      missingCount: coverage?.missingCount ?? RUNTIME_SMOKE_REQUIRED_COVERAGE.length,
    },
  };
}

function runtimeSmokeCoverageSummary(coverage = {}) {
  return {
    ok: coverage.ok ?? false,
    requiredCount: coverage.requiredCount ?? RUNTIME_SMOKE_REQUIRED_COVERAGE.length,
    coveredCount: coverage.coveredCount ?? 0,
    missingCount: coverage.missingCount ?? RUNTIME_SMOKE_REQUIRED_COVERAGE.length,
    missing: Array.isArray(coverage.missing) ? coverage.missing : [],
  };
}

function runtimeSmokeVerificationSummary(verification = {}) {
  return {
    status: verification.status || null,
    liveVerificationRequired: verification.liveVerificationRequired ?? null,
    nextCommand: verification.nextCommand || null,
    nextAction: verification.nextAction || null,
    successCriteria: verification.successCriteria || null,
    observed: verification.observed || null,
  };
}

function runtimeSmokeFailureSummary(failures = []) {
  return failures.map((failure) => ({
    name: failure.name || null,
    error: failure.error || null,
  }));
}

function summarizeRuntimeSmokeResult(result = {}, artifactPath = null) {
  return {
    ok: result.ok === true,
    summaryOnly: true,
    artifactPath,
    startedAt: result.startedAt || null,
    finishedAt: result.finishedAt || null,
    expectedVersion: result.expectedVersion || EXPECTED_EXTENSION_VERSION,
    bridgeVersion: result.bridgeVersion || null,
    extensionVersion: result.extensionVersion || null,
    finalVerificationComplete: Boolean(result.finalVerificationComplete),
    skipped: Boolean(result.skipped),
    reason: result.reason || null,
    tabId: result.tabId ?? null,
    keptTab: Boolean(result.keptTab),
    counts: result.counts || {
      steps: Array.isArray(result.steps) ? result.steps.length : 0,
      failures: Array.isArray(result.failures) ? result.failures.length : 0,
    },
    coverage: runtimeSmokeCoverageSummary(result.coverage),
    fatalError: result.fatalError || null,
    nextCommand: result.nextCommand || null,
    nextAction: result.nextAction || null,
    verification: runtimeSmokeVerificationSummary(result.verification),
    failures: runtimeSmokeFailureSummary(result.failures || []),
    stepsOmitted: Array.isArray(result.steps) ? result.steps.length : 0,
  };
}

async function debugBundle(args = {}) {
  if (!args.out) throw new Error('debug-bundle requires --out <dir>');
  const outputDir = path.resolve(args.out);
  const target = targetPayload(args);
  const createdAt = new Date().toISOString();
  const includeSnapshot = Boolean(args['include-snapshot']);
  const includeObserve = Boolean(args['include-observe']);
  const includeScreenshot = Boolean(args['include-screenshot']);
  const includeTraceEvents = Boolean(args['include-trace-events']);
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
    const filePath = path.join(outputDir, name);
    const output = options.redact === false ? value : redactDebugBundleValue(value);
    await writeJsonFile(filePath, output);
    manifest.files.push(name);
    return output;
  };

  const summary = await sessionSummary();
  await addJson('session-summary.json', redactDebugBundleValue(summary));
  await addJson('health.json', redactDebugBundleValue(summary.health));

  if (includeSnapshot) {
    const snapshot = await command('snapshot', { ...target, maxChars: 50_000 }, 30_000).catch((error) => ({
      ok: false,
      code: error.code || null,
      error: String(error?.message || error),
    }));
    await addJson('snapshot.json', snapshot, { redact: false });
  }

  if (includeObserve) {
    const observe = await command('observe', { ...target, limit: 100 }, 30_000).catch((error) => ({
      ok: false,
      code: error.code || null,
      error: String(error?.message || error),
    }));
    await addJson('observe.json', observe, { redact: false });
  }

  const trace = await command('traceSummary', target, 30_000).catch((error) => ({
    ok: false,
    code: error.code || null,
    error: String(error?.message || error),
  }));
  await addJson('trace-summary.json', trace);
  if (includeTraceEvents) {
    const traceEvents = await command('traceEvents', { ...target, limit: 200 }, 30_000).catch((error) => ({
      ok: false,
      code: error.code || null,
      error: String(error?.message || error),
    }));
    await addJson('trace-events.json', traceEvents, { redact: false });
  }

  if (includeScreenshot) {
    const screenshot = await command('screenshot', target, 30_000).catch((error) => ({
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

async function runtimeSmoke(args = {}) {
  const startedAt = new Date().toISOString();
  if (!RUNTIME_SMOKE_REQUIRED_COVERAGE.length) {
    throw new Error('runtime-smoke required coverage list must not be empty');
  }
  if (args['coverage-plan']) {
    return runtimeSmokeCoveragePlan(startedAt);
  }
  const health = await bridgeFetch('/health');
  const bridgeVersion = health?.bridge?.version || health?.extension?.info?.version || null;
  if (bridgeVersion !== EXPECTED_EXTENSION_VERSION) {
    const verification = runtimeSmokeLiveVerification({ status: 'skipped', bridgeVersion });
    return {
      ok: false,
      startedAt,
      expectedVersion: EXPECTED_EXTENSION_VERSION,
      bridgeVersion,
      finalVerificationComplete: false,
      skipped: true,
      reason: `Restart the Native Messaging Host first; live bridge version is ${bridgeVersion || 'unknown'}`,
      nextCommand: verification.nextCommand,
      nextAction: verification.nextAction,
      verification,
    };
  }
  const extensionVersion = health?.extension?.info?.version || null;
  if (extensionVersion !== EXPECTED_EXTENSION_VERSION) {
    const verification = runtimeSmokeLiveVerification({ status: 'skipped', bridgeVersion, extensionVersion });
    return {
      ok: false,
      startedAt,
      expectedVersion: EXPECTED_EXTENSION_VERSION,
      extensionVersion,
      finalVerificationComplete: false,
      skipped: true,
      reason: `Reload the unpacked extension first; live extension version is ${extensionVersion || 'unknown'}`,
      nextCommand: verification.nextCommand,
      nextAction: verification.nextAction,
      verification,
    };
  }

  const fixture = await startSmokeServer();
  const steps = [];
  let tabId = null;
  let outsideTabId = null;
  let strictWorkspaceSet = false;
  let debugBundleDir = null;
  let smokeUploadFile = null;
  let fatalError = null;
  const smokeId = String(Date.now());
  const adoptSourceGroupTitle = `Codex Bridge Smoke Adopt Source ${smokeId}`;
  const strictGroupTitle = `Codex Bridge Smoke Strict ${smokeId}`;
  const outsideGroupTitle = `Codex Bridge Smoke Outside ${smokeId}`;

  const run = async (name, fn, options = {}) => {
    try {
      const result = await fn();
      if (options.assert) await options.assert(result);
      steps.push({ name, ok: true, result: summarizeStepResult(result) });
      return result;
    } catch (error) {
      steps.push({ name, ok: false, error: String(error?.message || error) });
      if (options.required !== false) throw error;
      return null;
    }
  };

  const expectReject = async (name, fn) => {
    try {
      const result = await fn();
      steps.push({ name, ok: false, error: 'Expected command to fail but it succeeded', result: summarizeStepResult(result) });
    } catch (error) {
      steps.push({ name, ok: true, expectedFailure: String(error?.message || error) });
    }
  };

  const assertTabCleanupMitigation = (result) => {
    const cleanup = result?.tabGroupPersistenceMitigation;
    if (!cleanup) throw new Error('cleanup result did not include tabGroupPersistenceMitigation metadata');
    if (!Array.isArray(cleanup.savedGroupPersistence)) throw new Error('cleanup metadata did not include savedGroupPersistence results');
    if (!cleanup.ungroupedBeforeClose) throw new Error('cleanup did not ungroup grouped tabs before close');
    if (!Array.isArray(cleanup.ungroupedTabIds) || !cleanup.ungroupedTabIds.length) {
      throw new Error('cleanup did not report ungrouped grouped tab ids');
    }
    if (cleanup.savedClosedGroupChipPrevention?.prevented !== true) {
      throw new Error('cleanup did not report saved closed group chip prevention');
    }
    if (cleanup.savedClosedGroupChipPrevention?.method !== 'ungroup-before-close') {
      throw new Error('cleanup did not report ungroup-before-close chip prevention');
    }
  };

  const previousSuppressSessionGroupTitle = suppressSessionGroupTitle;
  suppressSessionGroupTitle = true;

  try {
    const opened = await run('open adoption source smoke tab', () => command('open', {
      url: fixture.url,
      newTab: true,
      groupTitle: adoptSourceGroupTitle,
      groupColor: 'grey',
    }, 30_000), {
      assert: (result) => {
        if (!result?.id) throw new Error('open did not return a tab id');
        if (result.group?.title !== adoptSourceGroupTitle) throw new Error('adoption source tab was not placed in the source group');
      },
    });
    tabId = opened.id;

    const adopted = await run('adopt existing smoke tab', () => command('adoptTab', {
      tabId,
      confirmed: true,
      groupTitle: 'Codex Bridge',
      groupColor: 'purple',
    }, 30_000), {
      assert: (result) => {
        if (!result?.adopted) throw new Error('adoptTab did not report adoption');
        if (result.tab?.id !== tabId) throw new Error('adoptTab changed the adopted tab id');
        if (result.tab?.group?.title !== 'Codex Bridge') throw new Error('adopted tab was not placed in Codex Bridge group');
      },
    });
    tabId = adopted.tab.id;

    await run('set strict smoke workspace', () => command('setWorkspace', {
      name: `smoke-${smokeId}`,
      groupTitle: strictGroupTitle,
      groupColor: 'cyan',
      policyMode: 'strict',
      confirmed: true,
    }, 10_000), {
      assert: (result) => {
        if (result.workspace?.title !== strictGroupTitle) throw new Error('strict workspace title was not applied');
        if (result.policy?.mode !== 'strict') throw new Error('strict workspace policy was not applied');
      },
    });
    strictWorkspaceSet = true;

    await run('workspace includes smoke tab', () => command('workspace', { includeTabs: true }, 10_000), {
      assert: (result) => {
        if (result.workspace?.title !== strictGroupTitle) throw new Error('workspace did not report strict smoke group title');
        if (result.policy?.mode !== 'strict') throw new Error('workspace did not report strict policy');
        if (!result.tabs?.some((tab) => tab.id === tabId)) throw new Error('workspace tabs did not include smoke tab');
      },
    });

    await run('session summary covers strict policy', () => sessionSummary(), {
      assert: (result) => {
        if (result.workspace?.policy?.mode !== 'strict') throw new Error('session summary did not report strict policy');
        if (!result.workspace?.tabs?.some((tab) => tab.id === tabId)) throw new Error('session summary did not include smoke tab');
        if (!result.recommendations?.some((item) => item.includes('Strict workspace policy is active'))) {
          throw new Error('session summary did not recommend strict-policy awareness');
        }
      },
    });

    debugBundleDir = await fs.mkdtemp(path.join(tmpdir(), 'chrome-bridge-smoke-bundle-'));
    await run('debug bundle default redaction', () => debugBundle({
      out: debugBundleDir,
      tab: tabId,
      'allow-external': true,
      groupTitle: strictGroupTitle,
      groupColor: 'cyan',
    }), {
      assert: async (result) => {
        const expectedFiles = ['session-summary.json', 'health.json', 'trace-summary.json', 'manifest.json'];
        for (const expectedFile of expectedFiles) {
          if (!result.files?.includes(expectedFile)) throw new Error(`debug bundle omitted ${expectedFile}`);
        }
        for (const omittedFile of ['snapshot.json', 'observe.json', 'screenshot.json', 'screenshot.png', 'trace-events.json']) {
          if (result.files?.includes(omittedFile)) throw new Error(`debug bundle included ${omittedFile} by default`);
        }

        const manifest = await readJsonFile(path.join(debugBundleDir, 'manifest.json'));
        if (manifest.privacy?.pageArtifacts?.snapshot !== 'omitted-by-default') throw new Error('debug bundle snapshot artifact was not omitted by default');
        if (manifest.privacy?.pageArtifacts?.observe !== 'omitted-by-default') throw new Error('debug bundle observe artifact was not omitted by default');
        if (manifest.privacy?.pageArtifacts?.screenshot !== 'omitted-by-default') throw new Error('debug bundle screenshot artifact was not omitted by default');
        if (manifest.privacy?.traceEvents !== 'summarized-by-default') throw new Error('debug bundle trace events were not summarized by default');

        const summaryJson = await readJsonFile(path.join(debugBundleDir, 'session-summary.json'));
        const serializedSummary = JSON.stringify(summaryJson);
        if (serializedSummary.includes(fixture.url)) throw new Error('debug bundle leaked the fixture URL in redacted summary');
        if (!serializedSummary.includes('[redacted]')) throw new Error('debug bundle summary did not redact page metadata');
      },
    });

    await run('group includes smoke tab', () => command('group', {
      groupTitle: strictGroupTitle,
      groupColor: 'cyan',
    }, 10_000), {
      assert: (result) => {
        if (!result.tabs?.some((tab) => tab.id === tabId)) throw new Error('group does not include smoke tab');
      },
    });
    await run('tabs scoped includes smoke tab', () => command('tabs', {
      groupTitle: strictGroupTitle,
      groupColor: 'cyan',
    }, 10_000), {
      assert: (result) => {
        if (result.scope !== 'codex-group') throw new Error('tabs is not scoped to codex-group');
        if (!result.tabs?.some((tab) => tab.id === tabId)) throw new Error('scoped tabs does not include smoke tab');
      },
    });
    await run('wait for ready selector', () => command('waitForSelector', {
      tabId,
      selector: '#ready',
    }, 30_000));
    await run('observe actionable elements', () => command('observe', {
      tabId,
      limit: 20,
    }, 30_000), {
      assert: (result) => {
        if (!result.elements?.some((element) => element.selector === '#action' && element.action === 'click')) {
          throw new Error('observe did not include action button');
        }
      },
    });
    await run('observe nth-of-type selector fallback', () => command('observe', {
      tabId,
      text: 'Anonymous fallback target',
      limit: 20,
    }, 30_000), {
      assert: (result) => {
        const fallback = result.elements?.find((element) => element.text === 'Anonymous fallback target');
        if (!fallback) throw new Error('observe did not include anonymous fallback target');
        if (!fallback.selector?.includes('nth-of-type')) {
          throw new Error(`observe fallback selector did not use nth-of-type: ${fallback.selector || '<missing>'}`);
        }
      },
    });
    await run('text extraction', () => command('text', { tabId, maxChars: 5_000 }, 30_000), {
      assert: (result) => {
        if (!result.text?.includes('Codex Bridge Smoke')) throw new Error('text did not include fixture title');
      },
    });
    await run('html extraction', () => command('html', { tabId, selector: '#fixture', maxChars: 20_000 }, 30_000), {
      assert: (result) => {
        if (!result.html?.includes('smoke-input')) throw new Error('html did not include fixture input');
      },
    });
    await run('snapshot extraction', () => command('snapshot', { tabId, maxChars: 10_000 }, 30_000), {
      assert: (result) => {
        if (!result.elements?.some((element) => element.selector === '#action')) throw new Error('snapshot did not include action button');
      },
    });
    await run('find-elements filtered', () => command('findElements', {
      tabId,
      text: 'Action',
      limit: 20,
    }, 30_000), {
      assert: (result) => {
        if (!result.elements?.some((element) => element.selector === '#action')) throw new Error('find-elements did not include action button');
      },
    });
    await run('find-elements near text filtered', () => command('findElements', {
      tabId,
      nearText: 'Codex Bridge Smoke',
      text: 'Action',
      limit: 20,
    }, 30_000), {
      assert: (result) => {
        if (!result.elements?.some((element) => element.selector === '#action')) {
          throw new Error('find-elements nearText did not include action button');
        }
      },
    });
    await run('extract forms', () => command('extractPage', {
      tabId,
      kind: 'forms',
      maxItems: 10,
    }, 30_000), {
      assert: (result) => {
        if (!Array.isArray(result.forms)) throw new Error('extract did not return forms array');
      },
    });
    await run('select options read', () => command('listSelectOptions', {
      tabId,
      selector: '#smoke-select',
    }, 30_000), {
      assert: (result) => {
        if (!result.options?.some((option) => option.value === 'b')) throw new Error('select options did not include Beta');
      },
    });
    await run('fill form dry run', () => command('fillForm', {
      tabId,
      fields: { '#smoke-input': 'preview' },
      dryRun: true,
    }, 30_000), {
      assert: (result) => {
        if (!result.dryRun || result.applied) throw new Error('fill form dry run unexpectedly applied changes');
      },
    });
    await run('activate smoke tab before dialog', () => command('activateTab', {
      tabId,
      focusWindow: true,
    }, 10_000), {
      assert: (result) => {
        if (result.id !== tabId || !result.active) throw new Error('dialog smoke tab was not activated');
      },
    });
    await run('trace start', () => command('traceStart', {
      tabId,
      confirmed: true,
      maxEvents: 100,
    }, 30_000));
    const dialogTarget = await run('wait for dialog target', () => command('waitForSelector', {
      tabId,
      selector: '#dialog-button',
    }, 30_000));
    await run('click dialog trigger', () => command('clickAt', {
      tabId,
      x: Math.round(dialogTarget.rect.x + dialogTarget.rect.width / 2),
      y: Math.round(dialogTarget.rect.y + dialogTarget.rect.height / 2),
      trusted: true,
      confirmed: true,
    }, 30_000));
    await delay(500);
    await run('handle dialog prompt', () => command('handleDialog', {
      tabId,
      confirmed: true,
      promptText: 'dialog-ok',
    }, 30_000), {
      assert: (result) => {
        if (!result.handled || !result.accepted) throw new Error('handleDialog did not accept the smoke prompt');
      },
    });
    await run('wait for dialog side-effect', () => command('waitForSelector', {
      tabId,
      selector: '#dialog-result[data-value="dialog-ok"]',
    }, 30_000));
    smokeUploadFile = path.join(tmpdir(), `chrome-bridge-smoke-upload-${smokeId}.txt`);
    await fs.writeFile(smokeUploadFile, `codex bridge smoke upload ${smokeId}\n`);
    await run('upload file input', () => command('uploadFile', {
      tabId,
      selector: '#smoke-file',
      file: smokeUploadFile,
      confirmed: true,
    }, 60_000), {
      assert: (result) => {
        if (!result.uploaded || result.fileCount !== 1) throw new Error('uploadFile did not report one uploaded file');
      },
    });
    await run('wait for upload side-effect', () => command('waitForSelector', {
      tabId,
      selector: '#uploaded[data-count="1"]',
    }, 30_000));
    await run('viewport screenshot', () => command('screenshot', { tabId }, 30_000), {
      assert: (result) => {
        if (!String(result.dataUrl || '').startsWith('data:image/png;base64,')) throw new Error('viewport screenshot was not a PNG data URL');
      },
    });
    await run('full page screenshot', () => command('screenshot', { tabId, fullPage: true }, 60_000), {
      assert: (result) => {
        if (!String(result.dataUrl || '').startsWith('data:image/png;base64,')) throw new Error('full-page screenshot was not a PNG data URL');
      },
    });
    await run('selector screenshot', () => command('screenshot', { tabId, selector: '#fixture' }, 60_000), {
      assert: (result) => {
        if (!String(result.dataUrl || '').startsWith('data:image/png;base64,')) throw new Error('selector screenshot was not a PNG data URL');
      },
    });
    await run('pdf export', () => command('printPdf', { tabId }, 60_000), {
      assert: (result) => {
        if (!String(result.dataUrl || '').startsWith('data:application/pdf;base64,')) throw new Error('pdf export was not a PDF data URL');
      },
    });

    await run('hover selector', () => command('hover', { tabId, selector: '#hover-target' }, 30_000));
    await run('wait for hover side-effect', () => command('waitForSelector', {
      tabId,
      selector: '#hovered[data-value="hovered"]',
    }, 30_000));
    await run('type trusted', () => command('type', {
      tabId,
      selector: '#smoke-input',
      text: 'hello',
      trusted: true,
      confirmed: true,
    }, 30_000));
    await run('wait for type side-effect', () => command('waitForSelector', {
      tabId,
      selector: '#typed[data-value="hello"]',
    }, 30_000));
    await run('press trusted', () => command('press', {
      tabId,
      selector: '#smoke-input',
      key: 'Enter',
      trusted: true,
      confirmed: true,
    }, 30_000));
    await run('wait for press side-effect', () => command('waitForSelector', {
      tabId,
      selector: '#pressed[data-key="Enter"]',
    }, 30_000));
    await run('select option', () => command('select', {
      tabId,
      selector: '#smoke-select',
      value: 'b',
      confirmed: true,
    }, 30_000));
    await run('wait for select side-effect', () => command('waitForSelector', {
      tabId,
      selector: '#selected[data-value="b"]',
    }, 30_000));
    await run('click selector', () => command('click', {
      tabId,
      selector: '#action',
      confirmed: true,
    }, 30_000));
    await run('wait for click side-effect', () => command('waitForSelector', {
      tabId,
      selector: '#clicked[data-value="clicked"]',
    }, 30_000));
    const coord = await run('wait for coordinate target', () => command('waitForSelector', {
      tabId,
      selector: '#coord',
    }, 30_000));
    await run('click coordinates', () => command('clickAt', {
      tabId,
      x: Math.round(coord.rect.x + coord.rect.width / 2),
      y: Math.round(coord.rect.y + coord.rect.height / 2),
      confirmed: true,
    }, 30_000));
    await run('wait for coordinate click side-effect', () => command('waitForSelector', {
      tabId,
      selector: '#coord-clicked[data-value="coord"]',
    }, 30_000));
    await run('trace events', () => command('traceEvents', { tabId, limit: 100 }, 30_000), {
      assert: (result) => {
        const events = result.events || [];
        if (!events.some((event) => event.kind === 'console')) throw new Error('trace did not capture console events');
        if (!events.some((event) => String(event.kind).startsWith('network.'))) throw new Error('trace did not capture network events');
      },
    });
    await run('trace stop', () => command('traceStop', { tabId, limit: 100 }, 30_000));

    await run('storage keys', () => command('storageSnapshot', {
      tabId,
      confirmed: true,
    }, 30_000), {
      assert: (result) => {
        if (!result.localStorage?.some((item) => item.key === 'codexBridgeSmokeLocal')) throw new Error('localStorage key missing');
        if (!result.sessionStorage?.some((item) => item.key === 'codexBridgeSmokeSession')) throw new Error('sessionStorage key missing');
      },
    });
    await run('cookies metadata by url', () => command('cookiesList', {
      url: fixture.url,
      name: 'codex_bridge_smoke',
      confirmed: true,
      limit: 20,
    }, 30_000), {
      assert: (result) => {
        if (!result.cookies?.some((cookie) => cookie.name === 'codex_bridge_smoke')) throw new Error('smoke cookie metadata missing');
      },
    });
    await run('extension-context request', () => command('fetchUrl', {
      url: fixture.pingUrl,
      confirmed: true,
      maxChars: 5_000,
    }, 30_000), {
      assert: (result) => {
        if (!result.ok || !result.text?.includes('"ok":true')) throw new Error('request did not return smoke JSON');
      },
    });
    await run('history search scoped to fixture url', () => command('historySearch', {
      query: fixture.url,
      confirmed: true,
      limit: 20,
    }, 30_000), {
      assert: (result) => {
        if (!Array.isArray(result.results)) throw new Error('history search did not return a results array');
        if (!result.results.some((item) => item.url === fixture.url)) throw new Error('history search did not include fixture URL');
      },
    });
    await run('bookmarks search unique empty query', () => command('bookmarksSearch', {
      query: `codex-bridge-smoke-${Date.now()}`,
      confirmed: true,
      limit: 5,
    }, 30_000), {
      assert: (result) => {
        if (!Array.isArray(result.results)) throw new Error('bookmarks search did not return a results array');
      },
    });

    await expectReject('safety: cookies whole jar requires confirmSensitive', () => command('cookiesList', {
      confirmed: true,
    }, 30_000));
    await expectReject('safety: storage values require confirmSensitive', () => command('storageSnapshot', {
      tabId,
      confirmed: true,
      includeValues: true,
    }, 30_000));
    await expectReject('safety: credentialed request requires confirmSensitive', () => command('fetchUrl', {
      url: fixture.pingUrl,
      confirmed: true,
      credentials: 'include',
    }, 30_000));

    const outsideOpened = await run('open outside smoke group tab', () => command('open', {
      url: `${fixture.url}?outside=1`,
      newTab: true,
      groupTitle: outsideGroupTitle,
      groupColor: 'grey',
    }, 30_000), {
      assert: (result) => {
        if (!result?.id) throw new Error('outside smoke open did not return a tab id');
        if (result.group?.title !== outsideGroupTitle) throw new Error('outside smoke tab was not placed in the alternate group');
      },
    });
    outsideTabId = outsideOpened.id;

    await expectReject('strict policy rejects outside tab even with allowExternal', () => command('text', {
      tabId: outsideTabId,
      allowExternal: true,
      maxChars: 1_000,
    }, 30_000));
  } catch (error) {
    fatalError = error;
    const message = String(error?.message || error);
    if (!steps.some((step) => step.ok === false && step.error === message)) {
      steps.push({ name: 'runtime smoke fatal error', ok: false, error: message });
    }
  } finally {
    if (outsideTabId) {
      await run('cleanup close outside smoke group', () => command('closeGroup', {
        groupTitle: outsideGroupTitle,
        confirmed: true,
      }, 30_000), {
        assert: assertTabCleanupMitigation,
        required: false,
      });
    }
    if (strictWorkspaceSet) {
      await run('clear strict smoke workspace', () => command('clearWorkspace', {
        confirmed: true,
      }, 10_000), { required: false });
    }
    if (tabId && !args['keep-tab']) {
      await run('cleanup close smoke tab', () => command('closeTab', {
        tabId,
        confirmed: true,
        allowExternal: true,
      }, 30_000), {
        assert: assertTabCleanupMitigation,
        required: false,
      });
    }
    if (debugBundleDir) {
      await fs.rm(debugBundleDir, { recursive: true, force: true }).catch(() => {});
    }
    if (smokeUploadFile) {
      await fs.rm(smokeUploadFile, { force: true }).catch(() => {});
    }
    await closeServer(fixture.server).catch((error) => {
      steps.push({ name: 'cleanup close smoke fixture server', ok: false, error: String(error?.message || error) });
    });
    suppressSessionGroupTitle = previousSuppressSessionGroupTitle;
  }

  const failures = steps.filter((step) => !step.ok);
  const coverage = runtimeSmokeCoverage(steps);
  const ok = failures.length === 0 && coverage.ok;
  const verification = runtimeSmokeLiveVerification({
    status: ok ? 'passed' : 'failed',
    bridgeVersion,
    extensionVersion,
    failures,
    coverage,
  });
  return {
    ok,
    startedAt,
    finishedAt: new Date().toISOString(),
    expectedVersion: EXPECTED_EXTENSION_VERSION,
    bridgeVersion,
    extensionVersion,
    finalVerificationComplete: verification.status === 'passed',
    fixtureUrl: fixture.url,
    tabId,
    keptTab: Boolean(args['keep-tab']),
    counts: {
      steps: steps.length,
      failures: failures.length,
    },
    coverage,
    fatalError: fatalError ? String(fatalError?.message || fatalError) : undefined,
    nextCommand: verification.nextCommand,
    nextAction: verification.nextAction,
    verification,
    failures,
    steps,
  };
}

export async function main() {
  const rawArgs = process.argv.slice(2);
  const args = parseArgs(rawArgs);
  const [cmd, first] = args._;

  if (cmd === 'with-temp-tab') {
    const result = await withTempTab(rawArgs.slice(1));
    printJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (cmd === 'extension-path') {
    process.stdout.write(`${path.join(rootDir, 'extension')}\n`);
    return;
  }

  if (cmd === 'mcp-config') {
    process.stdout.write(mcpConfigText(args));
    return;
  }

  if (cmd === 'mcp-write') {
    printJson(await writeMcpClientConfig(args));
    return;
  }

  if (cmd === 'codex-config') {
    process.stdout.write(codexTomlConfig());
    return;
  }

  if (cmd === 'doctor') {
    printJson(await doctor(args));
    return;
  }

  if (cmd === 'self-test') {
    const result = await selfTest();
    printJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'runtime-smoke') {
    const result = await runtimeSmoke(args);
    const artifactPath = typeof args.out === 'string' ? path.resolve(args.out) : null;
    if (artifactPath) {
      await writeJsonFile(artifactPath, result);
    }
    printJson(args['summary-only'] ? summarizeRuntimeSmokeResult(result, artifactPath) : result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'cleanup-run-tabs') {
    if (!args['run-id']) throw new Error('cleanup-run-tabs requires --run-id <id>');
    const result = await cleanupRunTabsById(args['run-id']);
    printJson(result);
    if (!result.ok || result.ownedTabsAfter.length) process.exitCode = 1;
    return;
  }

  if (cmd === 'last-artifact') {
    printJson(await lastArtifact({
      artifactDir: args['artifact-dir'],
    }));
    return;
  }

  if (cmd === 'read-artifact') {
    printJson(await readArtifactPreview({
      artifactPath: args.path || first,
      head: parseNumberRangeArg(args.head, '--head', 0, 10_000) ?? 20,
      grep: args.grep,
      maxMatches: parseNumberRangeArg(args['max-matches'], '--max-matches', 1, 1_000) ?? 20,
    }));
    return;
  }

  if (cmd === 'health') {
    printJson(await bridgeFetch('/health'));
    return;
  }

  if (cmd === 'status') {
    if (args['token-budget']) {
      printJson(await tokenBudgetStatus());
      return;
    }
    printJson(await sessionSummary());
    return;
  }

  if (cmd === 'reload-extension') {
    if (!args.confirm) throw new Error('reload-extension requires --confirm');
    printJson(await command('reloadExtension', confirmationPayload(args), 5_000));
    return;
  }

  if (cmd === 'tabs') {
    if (args.all && !args.confirm) throw new Error('tabs --all requires --confirm');
    const result = await command('tabs', {
      includeAll: args.all ? true : undefined,
      ...groupScopePayload(args),
      ...confirmationPayload(args),
    });
    printJson(args['summary-only'] ? summarizeTabs(result) : result);
    return;
  }

  if (cmd === 'windows') {
    if (args.all && !args.confirm) throw new Error('windows --all requires --confirm');
    printJson(await command('windows', {
      includeAll: args.all ? true : undefined,
      ...groupScopePayload(args),
      ...confirmationPayload(args),
    }));
    return;
  }

  if (cmd === 'group') {
    printJson(await command('group', {
      includeTabs: Boolean(args.tabs),
      ...groupScopePayload(args),
    }));
    return;
  }

  if (cmd === 'workspace') {
    printJson(await command('workspace', {
      includeTabs: Boolean(args.tabs),
    }));
    return;
  }

  if (cmd === 'set-workspace') {
    if (!args.confirm) throw new Error('set-workspace requires --confirm');
    printJson(await command('setWorkspace', {
      name: args.name,
      groupTitle: args['group-title'],
      groupColor: args['group-color'],
      policyMode: args['policy-mode'],
      ...confirmationPayload(args),
    }));
    return;
  }

  if (cmd === 'clear-workspace') {
    if (!args.confirm) throw new Error('clear-workspace requires --confirm');
    printJson(await command('clearWorkspace', confirmationPayload(args)));
    return;
  }

  if (cmd === 'ensure-tab') {
    printJson(await command('ensureTab', {
      url: first,
      active: Boolean(args.active),
      ...groupScopePayload(args),
    }, 30_000));
    return;
  }

  if (cmd === 'adopt-tab') {
    if (!args.confirm) throw new Error('adopt-tab requires --confirm');
    printJson(await command('adoptTab', {
      tabId: parseChromeIdArg(args.tab, '--tab'),
      ...groupScopePayload(args),
      ...confirmationPayload(args),
    }, 30_000));
    return;
  }

  if (cmd === 'open') {
    if (!first) throw new Error('open requires a URL');
    if (args.new && args.tab) throw new Error('open cannot use --new and --tab together');
    printJson(await command('open', {
      url: first,
      ...targetPayload(args),
      active: Boolean(args.active),
      newTab: Boolean(args.new),
      ...groupScopePayload(args),
    }, 30_000));
    return;
  }

  if (cmd === 'activate') {
    printJson(await command('activateTab', {
      ...targetPayload(args),
      focusWindow: Boolean(args['focus-window']),
    }));
    return;
  }

  if (cmd === 'close-tab') {
    if (!args.confirm) throw new Error('close-tab requires --confirm');
    printJson(await command('closeTab', {
      ...targetPayload(args),
      ...confirmationPayload(args),
    }));
    return;
  }

  if (cmd === 'close-group') {
    if (!args.confirm) throw new Error('close-group requires --confirm');
    printJson(await command('closeGroup', {
      ...groupScopePayload(args),
      ...confirmationPayload(args),
    }));
    return;
  }

  if (cmd === 'back' || cmd === 'forward') {
    printJson(await command(cmd === 'back' ? 'goBack' : 'goForward', targetPayload(args), 30_000));
    return;
  }

  if (cmd === 'reload') {
    printJson(await command('reloadTab', {
      ...targetPayload(args),
      bypassCache: Boolean(args['bypass-cache']),
    }, 30_000));
    return;
  }

  if (cmd === 'wait') {
    requireElementTarget(args, 'wait');
    printJson(await command('waitForSelector', {
      ...targetPayload(args),
      ...elementTargetPayload(args),
      timeoutMs: parseNumberRangeArg(args['timeout-ms'], '--timeout-ms', 0, 300_000),
      visible: !args['hidden-ok'],
    }, 30_000));
    return;
  }

  if (cmd === 'observe') {
    printJson(await command('observe', {
      ...targetPayload(args),
      limit: parseNumberRangeArg(args.limit, '--limit', 1, 300),
      maxTextChars: parseNumberRangeArg(args['max-text-chars'], '--max-text-chars', 20, 1_000),
    }, 30_000));
    return;
  }

  if (cmd === 'act-preview') {
    const observed = await command('observe', {
      ...targetPayload(args),
      limit: parseNumberRangeArg(args.limit, '--limit', 1, 300) ?? 120,
      maxTextChars: parseNumberRangeArg(args['max-text-chars'], '--max-text-chars', 20, 1_000) ?? 200,
    }, 30_000);
    printJson(await persistedActPreviewPlan(actPreviewInput(args, observed)));
    return;
  }

  if (cmd === 'act-apply') {
    printJson(await actApply(args));
    return;
  }

  if (cmd === 'find-elements') {
    printJson(await command('findElements', {
      ...targetPayload(args),
      role: args.role,
      text: args.text,
      nearText: args['near-text'],
      placeholder: args.placeholder,
      href: args.href,
      actionKind: args.action,
      risk: args.risk,
      limit: parseNumberRangeArg(args.limit, '--limit', 1, 300),
      maxTextChars: parseNumberRangeArg(args['max-text-chars'], '--max-text-chars', 20, 1_000),
    }, 30_000));
    return;
  }

  if (cmd === 'extract') {
    if (args.preset === 'cpa-offer') {
      printJson(await buildCpaOfferExtraction({
        bridgeCommand: command,
        target: targetPayload(args),
        options: {
          out: args.out,
          artifactDir: args['artifact-dir'],
          rawOut: args['raw-out'],
          rawHtmlOut: args['raw-html-out'],
          sourceNetwork: args.network,
          selector: args.selector,
          maxChars: parseNumberRangeArg(args['max-chars'], '--max-chars', 1_000, 200_000) ?? 200_000,
          maxHtmlChars: parseNumberRangeArg(args['max-html-chars'], '--max-html-chars', 1_000, 500_000) ?? 500_000,
          ...fullPageReadPayload({ ...args, 'full-page': true }),
        },
      }));
      return;
    }
    if (['article', 'product-page', 'pricing-table'].includes(args.preset)) {
      printJson(await buildStructuredPresetExtraction({
        bridgeCommand: command,
        target: targetPayload(args),
        options: {
          preset: args.preset,
          out: args.out,
          artifactDir: args['artifact-dir'],
          rawOut: args['raw-out'],
          rawHtmlOut: args['raw-html-out'],
          selector: args.selector,
          maxChars: parseNumberRangeArg(args['max-chars'], '--max-chars', 1_000, 200_000) ?? 200_000,
          maxHtmlChars: parseNumberRangeArg(args['max-html-chars'], '--max-html-chars', 1_000, 500_000) ?? 500_000,
          ...fullPageReadPayload({ ...args, 'full-page': true }),
        },
      }));
      return;
    }
    if (args.preset) {
      throw new Error(`Unsupported extract preset: ${args.preset}`);
    }

    printJson(await command('extractPage', {
      ...targetPayload(args),
      kind: args.kind,
      maxItems: parseNumberRangeArg(args['max-items'], '--max-items', 1, 500),
      maxTextChars: parseNumberRangeArg(args['max-text-chars'], '--max-text-chars', 50, 2_000),
    }, 30_000));
    return;
  }

  if (cmd === 'download-discovery') {
    printJson(await buildDownloadDiscovery({
      bridgeCommand: command,
      target: targetPayload(args),
      options: {
        out: args.out,
        artifactDir: args['artifact-dir'],
        rawHtmlOut: args['raw-html-out'],
        selector: args.selector,
        maxHtmlChars: parseNumberRangeArg(args['max-html-chars'], '--max-html-chars', 1_000, 500_000) ?? 500_000,
      },
    }));
    return;
  }

  if (cmd === 'snapshot' || cmd === 'text') {
    const result = await command(cmd, {
      ...targetPayload(args),
      maxChars: parseNumberRangeArg(args['max-chars'], '--max-chars', 1_000, 200_000) ?? 200_000,
      ...fullPageReadPayload(args),
    }, 30_000);
    printJson(await formatReadOutput({
      action: cmd,
      result,
      options: readOutputOptions(args),
    }));
    return;
  }

  if (cmd === 'html') {
    const result = await command('html', {
      ...targetPayload(args),
      ...elementTargetPayload(args),
      maxChars: parseNumberRangeArg(args['max-chars'], '--max-chars', 1_000, 500_000) ?? 500_000,
      outer: !args.inner,
    }, 30_000);
    printJson(await formatReadOutput({
      action: 'html',
      result,
      options: readOutputOptions(args),
    }));
    return;
  }

  if (cmd === 'grep-page') {
    const result = await command('text', {
      ...targetPayload(args),
      maxChars: parseNumberRangeArg(args['max-chars'], '--max-chars', 1_000, 200_000) ?? 200_000,
      ...fullPageReadPayload({ ...args, 'full-page': args['viewport-only'] ? false : true }),
    }, 30_000);
    const envelope = await formatReadOutput({
      action: 'text',
      result,
      options: {
        ...readOutputOptions(args),
        summaryOnly: true,
      },
    });
    const matches = grepLines(result.text, args.pattern, parseNumberRangeArg(args['max-matches'], '--max-matches', 1, 1_000) ?? 20);
    printJson({
      ok: true,
      action: 'grep-page',
      pattern: args.pattern,
      matchCount: matches.length,
      matches,
      artifactPath: envelope.artifactPath,
      diagnostics: envelope.diagnostics,
    });
    return;
  }

  if (cmd === 'page-search') {
    const query = args.query || first;
    if (!query) throw new Error('page-search requires --query <text>');
    const result = await command('text', {
      ...targetPayload(args),
      maxChars: parseNumberRangeArg(args['max-chars'], '--max-chars', 1_000, 200_000) ?? 200_000,
      ...fullPageReadPayload({ ...args, 'full-page': args['viewport-only'] ? false : true }),
    }, 30_000);
    const envelope = await formatReadOutput({
      action: 'text',
      result,
      options: {
        ...readOutputOptions(args),
        summaryOnly: true,
      },
    });
    printJson(await buildPageSearch({
      query,
      text: result.text,
      source: {
        url: result.url || result.tab?.url || null,
        title: result.title || result.tab?.title || null,
        tabId: result.tab?.id ?? result.tabId ?? null,
      },
      rawArtifactPath: envelope.artifactPath,
      out: args.out,
      artifactDir: args['artifact-dir'],
      maxMatches: parseNumberRangeArg(args['max-matches'], '--max-matches', 1, 50) ?? 8,
      maxSnippetChars: parseNumberRangeArg(args['max-snippet-chars'], '--max-snippet-chars', 80, 2_000) ?? 320,
    }));
    return;
  }

  if (cmd === 'links' || cmd === 'tables') {
    const result = await command('html', {
      ...targetPayload(args),
      selector: args.selector || 'main',
      maxChars: parseNumberRangeArg(args['max-chars'], '--max-chars', 1_000, 500_000) ?? 500_000,
      outer: true,
    }, 30_000);
    const envelope = await formatReadOutput({
      action: 'html',
      result,
      options: {
        ...readOutputOptions(args),
        summaryOnly: true,
      },
    });
    if (cmd === 'links') {
      const links = htmlLinks(result.html, result.url || result.tab?.url || '');
      printJson({
        ok: true,
        action: 'links',
        selector: result.selector || args.selector || 'main',
        count: links.length,
        links,
        artifactPath: envelope.artifactPath,
      });
      return;
    }
    const tables = htmlTables(result.html);
    printJson({
      ok: true,
      action: 'tables',
      selector: result.selector || args.selector || 'main',
      count: tables.length,
      tables,
      artifactPath: envelope.artifactPath,
    });
    return;
  }

  if (cmd === 'screenshot') {
    if (!args.out) throw new Error('screenshot requires --out <file>');
    const result = await command('screenshot', screenshotPayload(args), screenshotTimeoutMs(args));
    printJson(await formatReadOutput({
      action: 'screenshot',
      result,
      options: readOutputOptions(args),
    }));
    return;
  }

  if (cmd === 'pdf') {
    if (!args.out) throw new Error('pdf requires --out <file>');
    const result = await command('printPdf', {
      ...targetPayload(args),
      landscape: Boolean(args.landscape),
      printBackground: !args['omit-background'],
      pageRanges: args['page-ranges'],
      scale: parseNumberRangeArg(args.scale, '--scale', 0.1, 2),
    }, 60_000);
    const match = /^data:application\/pdf;base64,(.+)$/.exec(result.dataUrl || '');
    if (!match) throw new Error('Extension returned an invalid PDF data URL');
    await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await fs.writeFile(args.out, Buffer.from(match[1], 'base64'));
    printJson({ ...result, dataUrl: undefined, out: path.resolve(args.out) });
    return;
  }

  if (cmd === 'scroll') {
    printJson(await command('scroll', {
      ...targetPayload(args),
      x: parseFiniteNumberArg(args.x, '--x') ?? 0,
      y: parseFiniteNumberArg(args.y, '--y') ?? 0,
    }));
    return;
  }

  if (cmd === 'set-viewport') {
    if (!args.confirm) throw new Error('set-viewport requires --confirm');
    printJson(await command('setViewport', {
      ...targetPayload(args),
      ...confirmationPayload(args),
      width: parseNumberRangeArg(args.width, '--width', 200, 10_000),
      height: parseNumberRangeArg(args.height, '--height', 200, 10_000),
      deviceScaleFactor: parseNumberRangeArg(args['device-scale-factor'], '--device-scale-factor', 0.1, 5),
      mobile: Boolean(args.mobile),
    }, 10_000));
    return;
  }

  if (cmd === 'emulate-network') {
    if (!args.confirm) throw new Error('emulate-network requires --confirm');
    if (!args.profile) throw new Error('emulate-network requires --profile <name>');
    printJson(await command('emulateNetwork', {
      ...targetPayload(args),
      ...confirmationPayload(args),
      networkProfile: args.profile,
      latencyMs: parseNumberRangeArg(args['latency-ms'], '--latency-ms', 1, 120_000),
      downloadKbps: parseNumberRangeArg(args['download-kbps'], '--download-kbps', 1, 1_000_000),
      uploadKbps: parseNumberRangeArg(args['upload-kbps'], '--upload-kbps', 1, 1_000_000),
    }, 10_000));
    return;
  }

  if (cmd === 'clear-emulation') {
    if (!args.confirm) throw new Error('clear-emulation requires --confirm');
    printJson(await command('clearEmulation', {
      ...targetPayload(args),
      ...confirmationPayload(args),
    }, 10_000));
    return;
  }

  if (cmd === 'click') {
    if (!args.confirm) throw new Error('click requires --confirm');
    requireElementTarget(args, 'click');
    printJson(await command('click', {
      ...targetPayload(args),
      ...elementTargetPayload(args),
      ...confirmationPayload(args),
    }));
    return;
  }

  if (cmd === 'download') {
    if (!args.confirm) throw new Error('download requires --confirm');
    requireElementTarget(args, 'download');
    printJson(await command('download', {
      ...targetPayload(args),
      ...elementTargetPayload(args),
      downloadTimeoutMs: parseNumberRangeArg(args['download-timeout-ms'], '--download-timeout-ms', 1_000, 180_000),
      ...confirmationPayload(args),
    }, 60_000));
    return;
  }

  if (cmd === 'click-at') {
    if (!args.confirm) throw new Error('click-at requires --confirm');
    const x = parseRequiredFiniteNumberArg(args.x, '--x', 'click-at requires numeric --x and --y');
    const y = parseRequiredFiniteNumberArg(args.y, '--y', 'click-at requires numeric --x and --y');
    printJson(await command('clickAt', {
      ...targetPayload(args),
      ...confirmationPayload(args),
      x,
      y,
      button: args.button,
      trusted: Boolean(args.trusted),
    }, 30_000));
    return;
  }

  if (cmd === 'hover') {
    const coordinates = hoverCoordinatePayload(args);
    printJson(await command('hover', {
      ...targetPayload(args),
      ...elementTargetPayload(args),
      ...coordinates,
      trusted: Boolean(args.trusted),
    }, 30_000));
    return;
  }

  if (cmd === 'drag-drop') {
    if (!args.confirm) throw new Error('drag-drop requires --confirm');
    printJson(await command('dragDrop', {
      ...targetPayload(args),
      ...dragDropPayload(args),
      trusted: Boolean(args.trusted),
      ...confirmationPayload(args),
    }, 30_000));
    return;
  }

  if (cmd === 'type') {
    if (!args.confirm) throw new Error('type requires --confirm');
    requireElementTarget(args, 'type');
    if (typeof args.text !== 'string') {
      throw new Error('type requires --text <text>');
    }
    printJson(await command('type', {
      ...targetPayload(args),
      ...elementTargetPayload(args),
      text: args.text,
      trusted: Boolean(args.trusted),
      ...confirmationPayload(args),
    }));
    return;
  }

  if (cmd === 'press') {
    if (!args.confirm) throw new Error('press requires --confirm');
    if (!args.key) throw new Error('press requires --key <key>');
    printJson(await command('press', {
      ...targetPayload(args),
      ...confirmationPayload(args),
      ...elementTargetPayload(args),
      key: args.key,
      code: args.code,
      ctrlKey: Boolean(args.ctrl),
      metaKey: Boolean(args.meta),
      altKey: Boolean(args.alt),
      shiftKey: Boolean(args.shift),
      trusted: Boolean(args.trusted),
    }, 30_000));
    return;
  }

  if (cmd === 'select') {
    if (!args.confirm) throw new Error('select requires --confirm');
    requireElementTarget(args, 'select');
    if (args.value === undefined && args.label === undefined && args.index === undefined) {
      throw new Error('select requires value, label, or index');
    }
    printJson(await command('select', {
      ...targetPayload(args),
      ...confirmationPayload(args),
      ...elementTargetPayload(args),
      value: args.value,
      label: args.label,
      index: parseNonNegativeIntegerArg(args.index, '--index'),
    }, 30_000));
    return;
  }

  if (cmd === 'select-options') {
    requireElementTarget(args, 'select-options');
    printJson(await command('listSelectOptions', {
      ...targetPayload(args),
      ...elementTargetPayload(args),
    }, 30_000));
    return;
  }

  if (cmd === 'fill-form') {
    const fields = parseJsonOption(args['fields-json'], '--fields-json');
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('fill-form requires --fields-json <object>');
    if (!args['dry-run'] && !args.confirm) throw new Error('fill-form apply requires --confirm; pass --dry-run to preview');
    printJson(await command('fillForm', {
      ...targetPayload(args),
      ...confirmationPayload(args),
      fields,
      dryRun: Boolean(args['dry-run']),
    }, 30_000));
    return;
  }

  if (cmd === 'handle-dialog') {
    if (!args.confirm) throw new Error('handle-dialog requires --confirm');
    printJson(await command('handleDialog', {
      ...targetPayload(args),
      ...confirmationPayload(args),
      accept: !args.dismiss,
      promptText: args['prompt-text'],
    }, 30_000));
    return;
  }

  if (cmd === 'upload-file') {
    if (!args.confirm) throw new Error('upload-file requires --confirm');
    requireElementTarget(args, 'upload-file');
    if (!args.file && !args['files-json']) throw new Error('upload-file requires --file <path> or --files-json <json>');
    printJson(await command('uploadFile', {
      ...targetPayload(args),
      ...confirmationPayload(args),
      ...elementTargetPayload(args),
      file: args.file,
      files: parseJsonOption(args['files-json'], '--files-json'),
    }, 60_000));
    return;
  }

  if (cmd === 'trace-start') {
    if (!args.confirm) throw new Error('trace-start requires --confirm');
    printJson(await command('traceStart', {
      ...targetPayload(args),
      ...confirmationPayload(args),
      maxEvents: parseNumberRangeArg(args['max-events'], '--max-events', 50, 2_000),
      network: !args['no-network'],
      console: !args['no-console'],
      includeExtensionEvents: Boolean(args['include-extension-events']),
    }, 30_000));
    return;
  }

  if (cmd === 'trace-summary' || cmd === 'trace-events' || cmd === 'trace-stop') {
    const action = {
      'trace-summary': 'traceSummary',
      'trace-events': 'traceEvents',
      'trace-stop': 'traceStop',
    }[cmd];
    printJson(await command(action, {
      ...targetPayload(args),
      limit: parseNumberRangeArg(args.limit, '--limit', 1, 2_000),
    }, 30_000));
    return;
  }

  if (cmd === 'diagnostics') {
    const result = await command('diagnostics', targetPayload(args), 30_000);
    const artifactPath = typeof args.out === 'string' ? path.resolve(args.out) : null;
    if (artifactPath) await writeJsonFile(artifactPath, result);
    printJson(summarizeDiagnosticsOutput(result, { artifactPath }));
    return;
  }

  if (cmd === 'network-export') {
    const trace = await command('traceEvents', {
      ...targetPayload(args),
      limit: parseNumberRangeArg(args.limit, '--limit', 1, 2_000) ?? 200,
    }, 30_000);
    printJson(await buildNetworkExport(trace, {
      artifactDir: args['artifact-dir'],
      out: args.out,
      requestsOut: args['requests-out'],
      harOut: args['har-out'],
      limit: parseNumberRangeArg(args.limit, '--limit', 1, 2_000) ?? 200,
      includeHeaders: Boolean(args['include-headers']),
      includeBodies: Boolean(args['include-bodies']),
      ...(args['confirm-sensitive'] ? { confirmSensitive: true } : {}),
    }));
    return;
  }

  if (cmd === 'lighthouse-ingest') {
    printJson(await ingestLighthouseReportFile({
      reportPath: args.report,
      out: args.out,
      maxAudits: parseNumberRangeArg(args['max-audits'], '--max-audits', 1, 100) ?? 25,
    }));
    return;
  }

  if (cmd === 'lighthouse-plan') {
    printJson(buildLighthousePlan({
      url: args.url || first,
      out: args.out,
      summaryOut: args['summary-out'],
      chromePath: args['chrome-path'],
      chromeFlags: args['chrome-flags'],
      emulatedFormFactor: args['emulated-form-factor'],
      onlyCategories: args['only-categories'],
    }));
    return;
  }

  if (cmd === 'history') {
    if (!args.confirm) throw new Error('history requires --confirm');
    printJson(await command('historySearch', {
      ...confirmationPayload(args),
      query: args.query || '',
      limit: parseNumberRangeArg(args.limit, '--limit', 1, 200),
      startTime: parseNumberRangeArg(args['start-time'], '--start-time', 0, Number.MAX_SAFE_INTEGER),
      endTime: parseNumberRangeArg(args['end-time'], '--end-time', 0, Number.MAX_SAFE_INTEGER),
    }, 30_000));
    return;
  }

  if (cmd === 'bookmarks') {
    if (!args.confirm) throw new Error('bookmarks requires --confirm');
    printJson(await command('bookmarksSearch', {
      ...confirmationPayload(args),
      query: args.query || '',
      limit: parseNumberRangeArg(args.limit, '--limit', 1, 200),
    }, 30_000));
    return;
  }

  if (cmd === 'cookies') {
    if (!args.confirm) throw new Error('cookies requires --confirm');
    printJson(await command('cookiesList', {
      ...confirmationPayload(args),
      url: args.url,
      domain: args.domain,
      name: args.name,
      includeValues: Boolean(args['include-values']),
      limit: parseNumberRangeArg(args.limit, '--limit', 1, 500),
    }, 30_000));
    return;
  }

  if (cmd === 'storage') {
    if (!args.confirm) throw new Error('storage requires --confirm');
    printJson(await command('storageSnapshot', {
      ...targetPayload(args),
      ...confirmationPayload(args),
      includeValues: Boolean(args['include-values']),
      maxValueChars: parseNumberRangeArg(args['max-value-chars'], '--max-value-chars', 50, 5_000),
    }, 30_000));
    return;
  }

  if (cmd === 'request') {
    if (!first) throw new Error('request requires a URL');
    if (!args.confirm) throw new Error('request requires --confirm');
    printJson(await command('fetchUrl', {
      ...confirmationPayload(args),
      url: first,
      method: normalizeHttpMethod(args.method),
      headers: parseJsonOption(args['headers-json'], '--headers-json'),
      body: args.body,
      credentials: args.credentials,
      maxChars: parseNumberRangeArg(args['max-chars'], '--max-chars', 100, 200_000),
      requestTimeoutMs: parseNumberRangeArg(args['request-timeout-ms'], '--request-timeout-ms', 1_000, 60_000),
    }, 60_000));
    return;
  }

  if (cmd === 'ask') {
    const question = args.question || first;
    if (!question) throw new Error('ask requires --question <text>');
    const timeoutMs = parseNumberRangeArg(args['timeout-ms'], '--timeout-ms', 5_000, 1_800_000);
    printJson(await command('askUser', {
      question,
      choices: parseJsonOption(args['choices-json'], '--choices-json'),
      allowText: !args['no-text'],
      closeOnAnswer: !args['keep-tab'],
      timeoutMs,
    }, timeoutMs === undefined ? 305_000 : timeoutMs + 5_000));
    return;
  }

  if (cmd === 'session-summary') {
    printJson(await sessionSummary());
    return;
  }

  if (cmd === 'recording-summary') {
    const recordingPath = args.recording || first;
    if (!recordingPath) throw new Error('recording-summary requires --recording <file>');
    const summary = await summarizeActionRecording({
      path: recordingPath,
      limit: parseNumberRangeArg(args.limit, '--limit', 1, 10_000) ?? 500,
    });
    if (args.out) await writeJsonFile(path.resolve(args.out), summary);
    printJson(args.out ? {
      ok: true,
      contract: summary.contract,
      recordingPath: summary.recordingPath,
      artifactPath: path.resolve(args.out),
      count: summary.count,
      byAction: summary.byAction,
      replayLite: {
        autoExecute: false,
        requiresHumanReview: true,
        stepCount: summary.replayLite.steps.length,
      },
    } : summary);
    return;
  }

  if (cmd === 'debug-bundle') {
    printJson(await debugBundle(args));
    return;
  }

  if (cmd === 'command-catalog') {
    if (args.markdown) {
      process.stdout.write(commandCatalogMarkdown());
      return;
    }
    printJson(commandCatalog());
    return;
  }

  if (cmd === 'advise') {
    printJson(buildToolAdvisor(toolAdvisorInput(args)));
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}
