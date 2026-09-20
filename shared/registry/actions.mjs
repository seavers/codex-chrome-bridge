export const BRIDGE_VERSION = '0.4.1';
export const NETWORK_EMULATION_PROFILES = Object.freeze(['offline', 'slow-3g', 'fast-3g', 'slow-4g', 'wifi', 'no-throttling', 'custom']);

export const MANIFEST_PERMISSIONS = [
  'activeTab',
  'alarms',
  'bookmarks',
  'cookies',
  'debugger',
  'downloads',
  'history',
  'nativeMessaging',
  'scripting',
  'storage',
  'tabGroups',
  'tabs',
];

export const TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
export const GROUP_SCOPE_KEYS = ['groupTitle', 'groupColor'];
export const TARGET_KEYS = ['tabId', 'allowExternal', ...GROUP_SCOPE_KEYS];
export const CONFIRMATION_KEYS = ['confirmed', 'confirmSensitive'];

const base = [...TARGET_KEYS];
const confirmed = [...TARGET_KEYS, 'confirmed'];
const sensitiveConfirmed = [...TARGET_KEYS, ...CONFIRMATION_KEYS];
const elementTarget = [...base, 'selector', 'elementRef'];
const maxChars = [...base, 'maxChars'];

function freezeSchemaMap(schemas) {
  return Object.freeze(Object.fromEntries(
    Object.entries(schemas).map(([action, keys]) => [action, Object.freeze([...keys])]),
  ));
}

export const COMMAND_PAYLOAD_SCHEMAS = freezeSchemaMap({
  windows: ['includeAll', 'groupTitle', 'groupColor', 'confirmed'],
  tabs: ['includeAll', 'groupTitle', 'groupColor', 'confirmed'],
  group: ['includeTabs', 'groupTitle', 'groupColor'],
  workspace: ['includeTabs'],
  setWorkspace: ['name', 'groupTitle', 'groupColor', 'policyMode', 'confirmed'],
  clearWorkspace: ['confirmed'],
  ensureTab: ['url', 'active', 'groupTitle', 'groupColor'],
  adoptTab: ['tabId', 'confirmed', 'groupTitle', 'groupColor'],
  open: [...base, 'url', 'active', 'newTab'],
  activateTab: [...base, 'focusWindow'],
  closeTab: confirmed,
  closeGroup: ['confirmed', 'groupTitle', 'groupColor'],
  goBack: [...base, 'timeoutMs'],
  goForward: [...base, 'timeoutMs'],
  reloadTab: [...base, 'bypassCache', 'timeoutMs'],
  waitForSelector: [...elementTarget, 'timeoutMs', 'visible'],
  observe: [...base, 'limit', 'maxTextChars', 'role', 'text', 'nearText', 'placeholder', 'href', 'actionKind', 'risk'],
  findElements: [...base, 'limit', 'maxTextChars', 'role', 'text', 'nearText', 'placeholder', 'href', 'actionKind', 'risk'],
  extractPage: [...base, 'kind', 'maxItems', 'maxTextChars'],
  snapshot: [...maxChars, 'fullPage', 'waitForText', 'waitForPattern', 'scrollStepPx', 'maxScrollSteps', 'scrollDelayMs'],
  text: [...maxChars, 'fullPage', 'waitForText', 'waitForPattern', 'scrollStepPx', 'maxScrollSteps', 'scrollDelayMs'],
  html: [...maxChars, 'selector', 'elementRef', 'outer'],
  diagnostics: base,
  screenshot: [...base, 'fullPage', 'selector', 'elementRef', 'maxPixels', 'fallback'],
  printPdf: [...base, 'landscape', 'printBackground', 'preferCssPageSize', 'pageRanges', 'scale'],
  listSelectOptions: elementTarget,
  scroll: [...base, 'x', 'y'],
  setViewport: [...confirmed, 'width', 'height', 'deviceScaleFactor', 'mobile'],
  emulateNetwork: [...confirmed, 'networkProfile', 'latencyMs', 'downloadKbps', 'uploadKbps'],
  clearEmulation: confirmed,
  click: [...confirmed, 'selector', 'elementRef'],
  download: [...confirmed, 'selector', 'elementRef', 'downloadTimeoutMs'],
  clickAt: [...confirmed, 'x', 'y', 'button', 'trusted'],
  hover: [...base, 'selector', 'elementRef', 'x', 'y', 'trusted'],
  dragDrop: [...confirmed, 'selector', 'elementRef', 'targetSelector', 'targetElementRef', 'x', 'y', 'targetX', 'targetY', 'trusted'],
  type: [...confirmed, 'selector', 'elementRef', 'text', 'trusted'],
  press: [...confirmed, 'selector', 'elementRef', 'key', 'code', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'trusted'],
  select: [...confirmed, 'selector', 'elementRef', 'value', 'label', 'index'],
  fillForm: [...confirmed, 'fields', 'dryRun'],
  handleDialog: [...confirmed, 'accept', 'promptText'],
  uploadFile: [...confirmed, 'selector', 'elementRef', 'file', 'files'],
  traceStart: [...confirmed, 'maxEvents', 'network', 'console', 'includeExtensionEvents'],
  traceSummary: base,
  traceEvents: [...base, 'limit'],
  traceStop: [...base, 'limit'],
  historySearch: ['query', 'limit', 'startTime', 'endTime', 'confirmed'],
  bookmarksSearch: ['query', 'limit', 'confirmed'],
  cookiesList: ['url', 'domain', 'name', 'limit', 'includeValues', 'confirmed', 'confirmSensitive'],
  storageSnapshot: [...sensitiveConfirmed, 'includeValues', 'maxValueChars'],
  fetchUrl: ['url', 'method', 'headers', 'body', 'credentials', 'maxChars', 'requestTimeoutMs', 'confirmed', 'confirmSensitive'],
  askUser: ['question', 'choices', 'allowText', 'closeOnAnswer', 'timeoutMs'],
  reloadExtension: ['confirmed'],
});

export const EXTENSION_ACTIONS = Object.freeze(Object.keys(COMMAND_PAYLOAD_SCHEMAS));

export const DEBUGGER_SERIALIZED_ACTIONS = Object.freeze([
  'screenshot',
  'printPdf',
  'setViewport',
  'emulateNetwork',
  'clearEmulation',
  'clickAt',
  'hover',
  'dragDrop',
  'type',
  'press',
  'handleDialog',
  'uploadFile',
  'traceStart',
  'traceStop',
]);

const PRIVATE_READ_ACTIONS = new Set([
  'historySearch',
  'bookmarksSearch',
  'cookiesList',
  'storageSnapshot',
  'fetchUrl',
]);

export const HTTP_METHODS = Object.freeze([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

const INTERACTION_ACTIONS = new Set([
  'adoptTab',
  'open',
  'activateTab',
  'closeTab',
  'closeGroup',
  'goBack',
  'goForward',
  'reloadTab',
  'scroll',
  'setViewport',
  'emulateNetwork',
  'clearEmulation',
  'click',
  'download',
  'clickAt',
  'hover',
  'dragDrop',
  'type',
  'press',
  'select',
  'fillForm',
  'handleDialog',
  'uploadFile',
]);

const SYSTEM_ACTIONS = new Set([
  'ensureTab',
  'setWorkspace',
  'clearWorkspace',
  'setViewport',
  'emulateNetwork',
  'clearEmulation',
  'traceStart',
  'traceStop',
  'askUser',
  'reloadExtension',
]);

export const ACTION_DEFAULT_TIMEOUT_MS = Object.freeze({
  reloadExtension: 5_000,
  windows: 10_000,
  tabs: 10_000,
  group: 10_000,
  workspace: 10_000,
  setWorkspace: 10_000,
  clearWorkspace: 10_000,
  activateTab: 10_000,
  closeTab: 10_000,
  closeGroup: 10_000,
  scroll: 10_000,
  askUser: 305_000,
  screenshot: 30_000,
  printPdf: 60_000,
  fetchUrl: 60_000,
  uploadFile: 60_000,
  download: 60_000,
  setViewport: 10_000,
  emulateNetwork: 10_000,
  clearEmulation: 10_000,
});

export function commandRiskTier(action) {
  if (PRIVATE_READ_ACTIONS.has(action)) return 'private-read';
  if (INTERACTION_ACTIONS.has(action)) return 'interaction';
  if (SYSTEM_ACTIONS.has(action)) return 'system';
  return 'read';
}

export function commandDefaultTimeoutMs(action) {
  return ACTION_DEFAULT_TIMEOUT_MS[action] || 30_000;
}
