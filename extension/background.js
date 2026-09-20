import { extensionErrorCode, extensionErrorDetails } from './extension-errors.js';
import { startBridge } from './offscreen-lifecycle.js';
import { printPdf, screenshot } from './page-artifacts.js';
import {
  activateTab,
  adoptTab,
  clearWorkspace,
  closeGroup,
  closeTab,
  ensureCodexTab,
  goBack,
  goForward,
  groupStatus,
  listTabs,
  listWindows,
  openTab,
  reloadTab,
  setWorkspace,
  workspaceStatus,
} from './navigation-actions.js';
import {
  diagnostics,
  extractPage,
  findElements,
  listSelectOptions,
  observe,
  pageHTML,
  pageText,
  snapshot,
  storageSnapshot,
  waitForSelector,
} from './page-read-actions.js';
import {
  click,
  clickAt,
  dragDrop,
  fillForm,
  handleDialog,
  hover,
  pressKey,
  scroll,
  selectOption,
  typeInto,
  uploadFile,
} from './page-interactions.js';
import {
  recordDebuggerDetach,
  recordDebuggerEvent,
} from './debugger-session.js';
import { reloadExtension } from './runtime-actions.js';
import {
  enforceManagedTabGroupPersistence,
  installTabGroupPersistenceListeners,
} from './tab-group-persistence.js';
import {
  traceEvents,
  traceStart,
  traceStop,
  traceSummaryCommand,
} from './trace-actions.js';
import {
  askUser,
  completeUserPrompt,
  handlePromptTabRemoved,
  userPromptResponse,
} from './user-prompts.js';
import {
  bookmarksSearch,
  cookiesList,
  fetchUrl,
  historySearch,
} from './browser-data.js';
import { download } from './download-actions.js';
import {
  clearEmulation,
  emulateNetwork,
  setViewport,
} from './emulation-actions.js';
chrome.runtime.onInstalled.addListener(startBridge);
chrome.runtime.onStartup.addListener(startBridge);
chrome.action.onClicked.addListener(startBridge);
chrome.alarms.create('codex-bridge-ensure-offscreen', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'codex-bridge-ensure-offscreen') startBridge();
});
const NATIVE_HOST_NAME = 'com.codex.chrome_bridge';
const EXTENSION_NAME = 'Chrome MCP Bridge';
const EXTENSION_VERSION = '0.4.1';
const SOCKET_PATH = '/tmp/codex-chrome-bridge.sock';
const RECONNECT_MS = 1500;
let nativePort = null;
let reconnectTimer = null;
let nativeClientIdPromise = null;
let nativeProfileIdPromise = null;
let latestBridgeStatus = null;
connectNativeHost();

installTabGroupPersistenceListeners();
enforceManagedTabGroupPersistence().catch(() => {});
startBridge();

if (chrome.debugger?.onEvent) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    recordDebuggerEvent(source, method, params);
  });

  chrome.debugger.onDetach.addListener((source, reason) => {
    recordDebuggerDetach(source, reason);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'codex-bridge-status') {
    updateActionStatus(message.status || {});
    sendResponse({ ok: true });
    return undefined;
  }

  if (message?.type === 'codex-bridge-get-status') {
    sendResponse({ ok: true, status: latestBridgeStatus });
    return undefined;
  }

  if (message?.type === 'codex-bridge-get-user-prompt') {
    sendResponse(userPromptResponse(message.requestId));
    return undefined;
  }

  if (message?.type === 'codex-bridge-user-answer') {
    completeUserPrompt(message.requestId, {
      value: message.value,
      text: message.text,
      choice: message.choice,
      canceled: Boolean(message.canceled),
      reason: message.reason,
    });
    sendResponse({ ok: true });
    return undefined;
  }

  if (message?.type !== 'codex-bridge-command') return undefined;

  dispatch(message.action, message.payload || {})
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({
      ok: false,
      code: extensionErrorCode(error),
      error: String(error?.message || error),
      details: extensionErrorDetails(error),
    }));

  return true;
});

function updateActionStatus(status) {
  const state = status.state || 'idle';
  const badge = state === 'connected' ? 'OK' : state === 'error' ? 'ERR' : '';
  const color = state === 'connected' ? '#188038' : state === 'error' ? '#d93025' : '#5f6368';

  chrome.action.setBadgeText({ text: badge }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
  chrome.action.setTitle({
    title: status.detail ? `Chrome MCP Bridge：${status.detail}` : 'Chrome MCP Bridge',
  }).catch(() => {});
}

function nativeStorageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, (value) => resolve(value || {})));
}

function nativeStorageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, () => resolve()));
}

function nativeClientId() {
  if (nativeClientIdPromise) return nativeClientIdPromise;
  nativeClientIdPromise = nativeStorageGet(['codexBridgeClientId']).then(async (stored) => {
    if (stored.codexBridgeClientId) return stored.codexBridgeClientId;
    const generated = crypto.randomUUID();
    await nativeStorageSet({ codexBridgeClientId: generated });
    return generated;
  });
  return nativeClientIdPromise;
}

function nativeProfileId() {
  if (nativeProfileIdPromise) return nativeProfileIdPromise;
  nativeProfileIdPromise = nativeStorageGet(['codexBridgeProfileId']).then(async (stored) => {
    if (stored.codexBridgeProfileId) return stored.codexBridgeProfileId;
    const generated = await nativeClientId();
    await nativeStorageSet({ codexBridgeProfileId: generated });
    return generated;
  });
  return nativeProfileIdPromise;
}

async function nativeHello() {
  return {
    type: 'hello',
    info: {
      clientId: await nativeClientId(),
      profileId: await nativeProfileId(),
      extensionId: chrome.runtime.id,
      version: EXTENSION_VERSION,
      name: EXTENSION_NAME,
      context: 'service-worker',
      transport: 'native-messaging',
    },
  };
}

function publishBridgeStatus(status) {
  const nextStatus = { ...status, updatedAt: Date.now(), transport: 'native-messaging+unix-socket', socketPath: SOCKET_PATH };
  latestBridgeStatus = nextStatus;
  updateActionStatus(nextStatus);
  nativeStorageSet({ codexBridgeStatus: nextStatus }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'codex-bridge-status', status: nextStatus }).catch(() => {});
}

async function handleNativeCommand(command) {
  if (!command?.id || !command.action || !nativePort) return;
  publishBridgeStatus({ state: 'working', detail: `正在执行：${command.action}`, action: command.action });
  try {
    const result = await dispatch(command.action, command.payload || {});
    nativePort?.postMessage({ id: command.id, ok: true, result, info: (await nativeHello()).info });
    publishBridgeStatus({ state: 'connected', detail: `已完成：${command.action}`, action: command.action, response: { ok: true } });
  } catch (error) {
    nativePort?.postMessage({ id: command.id, ok: false, code: extensionErrorCode(error), error: String(error?.message || error), details: extensionErrorDetails(error), info: (await nativeHello()).info });
    publishBridgeStatus({ state: 'error', detail: `执行失败：${command.action}`, action: command.action, response: { ok: false, error: String(error?.message || error) } });
  }
}

function reconnectNativeHost() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectNativeHost(); }, RECONNECT_MS);
}

function connectNativeHost() {
  if (nativePort) return;
  publishBridgeStatus({ state: 'connecting', detail: '正在连接 Native Messaging Host' });
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    nativePort.onMessage.addListener((message) => handleNativeCommand(message).catch(reconnectNativeHost));
    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      nativePort = null;
      publishBridgeStatus({ state: 'disconnected', detail: error?.message || 'Native Messaging Host 已断开' });
      reconnectNativeHost();
    });
    publishBridgeStatus({ state: 'connected', detail: '已连接 Native Messaging Host' });
    nativeHello().then((message) => nativePort?.postMessage(message)).catch(reconnectNativeHost);
  } catch (error) {
    nativePort = null;
    publishBridgeStatus({ state: 'error', detail: `Native Messaging Host 连接失败：${String(error?.message || error)}` });
    reconnectNativeHost();
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  handlePromptTabRemoved(tabId);
});

async function dispatch(action, payload) {
  switch (action) {
    case 'windows':
      return listWindows(payload);
    case 'tabs':
      return listTabs(payload);
    case 'group':
      return groupStatus(payload);
    case 'workspace':
      return workspaceStatus(payload);
    case 'setWorkspace':
      return setWorkspace(payload);
    case 'clearWorkspace':
      return clearWorkspace(payload);
    case 'ensureTab':
      return ensureCodexTab(payload);
    case 'adoptTab':
      return adoptTab(payload);
    case 'open':
      return openTab(payload);
    case 'activateTab':
      return activateTab(payload);
    case 'closeTab':
      return closeTab(payload);
    case 'closeGroup':
      return closeGroup(payload);
    case 'goBack':
      return goBack(payload);
    case 'goForward':
      return goForward(payload);
    case 'reloadTab':
      return reloadTab(payload);
    case 'waitForSelector':
      return waitForSelector(payload);
    case 'observe':
      return observe(payload);
    case 'findElements':
      return findElements(payload);
    case 'extractPage':
      return extractPage(payload);
    case 'snapshot':
      return snapshot(payload);
    case 'text':
      return pageText(payload);
    case 'html':
      return pageHTML(payload);
    case 'diagnostics':
      return diagnostics(payload);
    case 'screenshot':
      return screenshot(payload);
    case 'printPdf':
      return printPdf(payload);
    case 'listSelectOptions':
      return listSelectOptions(payload);
    case 'scroll':
      return scroll(payload);
    case 'setViewport':
      return setViewport(payload);
    case 'emulateNetwork':
      return emulateNetwork(payload);
    case 'clearEmulation':
      return clearEmulation(payload);
    case 'click':
      return click(payload);
    case 'download':
      return download(payload);
    case 'clickAt':
      return clickAt(payload);
    case 'hover':
      return hover(payload);
    case 'dragDrop':
      return dragDrop(payload);
    case 'type':
      return typeInto(payload);
    case 'press':
      return pressKey(payload);
    case 'select':
      return selectOption(payload);
    case 'fillForm':
      return fillForm(payload);
    case 'handleDialog':
      return handleDialog(payload);
    case 'uploadFile':
      return uploadFile(payload);
    case 'traceStart':
      return traceStart(payload);
    case 'traceSummary':
      return traceSummaryCommand(payload);
    case 'traceEvents':
      return traceEvents(payload);
    case 'traceStop':
      return traceStop(payload);
    case 'historySearch':
      return historySearch(payload);
    case 'bookmarksSearch':
      return bookmarksSearch(payload);
    case 'cookiesList':
      return cookiesList(payload);
    case 'storageSnapshot':
      return storageSnapshot(payload);
    case 'fetchUrl':
      return fetchUrl(payload);
    case 'askUser':
      return askUser(payload);
    case 'reloadExtension':
      return reloadExtension(payload);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
