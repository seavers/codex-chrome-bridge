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
