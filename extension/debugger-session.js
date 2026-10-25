import { tabInfo } from './tab-info.js';
import { chromeId } from './workspace-tabs.js';

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const MAX_TRACE_EVENTS = 500;
const MAX_RESPONSE_BODIES = 20;
const MAX_RESPONSE_BODY_BYTES = 64 * 1024;

const traceSessions = new Map();
const debuggerLocks = new Map();

function debuggerTarget(tabId) {
  return { tabId };
}

async function detachDebugger(tabId) {
  await chrome.debugger.detach(debuggerTarget(tabId));
}

export async function sendDebuggerCommand(tabId, method, params = {}) {
  return chrome.debugger.sendCommand(debuggerTarget(tabId), method, params);
}

async function withTabLock(tabId, fn) {
  const previous = debuggerLocks.get(tabId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => current, () => current);
  debuggerLocks.set(tabId, next);

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (debuggerLocks.get(tabId) === next) {
      debuggerLocks.delete(tabId);
    }
  }
}

export async function withDebugger(tabId, fn) {
  if (!chrome.debugger) throw new Error('chrome.debugger API is unavailable; reload the extension after granting the debugger permission');
  return withTabLock(tabId, async () => {
    const session = traceSessions.get(tabId);
    const detachAfter = !(session?.active && session?.attached);
    if (detachAfter) {
      await chrome.debugger.attach(debuggerTarget(tabId), DEBUGGER_PROTOCOL_VERSION);
    }
    try {
      return await fn();
    } finally {
      if (detachAfter) {
        await detachDebugger(tabId).catch(() => {});
      }
    }
  });
}

function pushTraceEvent(tabId, event) {
  const session = traceSessions.get(tabId);
  if (!session?.active || !event) return;
  if (!session.includeExtensionEvents && String(event.url || '').startsWith('chrome-extension://')) return;
  session.events.push({
    ...event,
    capturedAt: new Date().toISOString(),
  });
  if (session.events.length > session.maxEvents) {
    session.events.splice(0, session.events.length - session.maxEvents);
  }
}

async function captureJsonResponseBody(tabId, requestId, session) {
  const response = session.responses.get(requestId);
  if (!response || !session.active || !session.includeResponseBodies) return;
  if (session.responseBodyCount >= MAX_RESPONSE_BODIES) return;
  if (session.responseUrlIncludes && !response.url.includes(session.responseUrlIncludes)) return;
  if (!/(?:application|text)\/(?:[\w.-]+\+)?json\b/i.test(response.mimeType || '')) return;

  session.responseBodyCount += 1;
  try {
    const result = await sendDebuggerCommand(tabId, 'Network.getResponseBody', { requestId });
    const encodedBody = String(result?.body || '');
    const bodyTooLarge = result?.base64Encoded
      ? encodedBody.length > Math.ceil(MAX_RESPONSE_BODY_BYTES / 3) * 4
      : encodedBody.length > MAX_RESPONSE_BODY_BYTES;
    if (bodyTooLarge) {
      pushTraceEvent(tabId, {
        kind: 'network.responseBodySkipped',
        requestId,
        url: response.url,
        reason: 'body_too_large',
        maxBytes: MAX_RESPONSE_BODY_BYTES,
      });
      return;
    }

    // CDP 只在响应完成后提供正文；先限制大小，再解码和解析 JSON。
    const rawBody = result?.base64Encoded
      ? new TextDecoder().decode(Uint8Array.from(atob(encodedBody), (character) => character.charCodeAt(0)))
      : encodedBody;
    if (new TextEncoder().encode(rawBody).byteLength > MAX_RESPONSE_BODY_BYTES) {
      pushTraceEvent(tabId, {
        kind: 'network.responseBodySkipped',
        requestId,
        url: response.url,
        reason: 'body_too_large',
        maxBytes: MAX_RESPONSE_BODY_BYTES,
      });
      return;
    }

    let json;
    try {
      json = JSON.parse(rawBody);
    } catch {
      pushTraceEvent(tabId, { kind: 'network.responseBodySkipped', requestId, url: response.url, reason: 'invalid_json' });
      return;
    }

    pushTraceEvent(tabId, {
      kind: 'network.responseBody',
      requestId,
      url: response.url,
      status: response.status,
      mimeType: response.mimeType,
      body: json,
    });
  } catch (error) {
    pushTraceEvent(tabId, {
      kind: 'network.responseBodySkipped',
      requestId,
      url: response.url,
      reason: 'body_unavailable',
      error: String(error?.message || error).slice(0, 200),
    });
  } finally {
    session.responses.delete(requestId);
  }
}

export async function recordDebuggerEvent(source, method, params = {}) {
  const tabId = source?.tabId;
  if (chromeId(tabId) === null) return;
  const session = traceSessions.get(tabId);

  if (method === 'Runtime.consoleAPICalled') {
    pushTraceEvent(tabId, {
      kind: 'console',
      level: params.type,
      text: (params.args || []).map((arg) => arg.description || arg.value || arg.type).join(' '),
      url: params.stackTrace?.callFrames?.[0]?.url,
      lineNumber: params.stackTrace?.callFrames?.[0]?.lineNumber,
    });
    return;
  }

  if (method === 'Log.entryAdded') {
    const entry = params.entry || {};
    pushTraceEvent(tabId, {
      kind: 'log',
      level: entry.level,
      source: entry.source,
      text: entry.text,
      url: entry.url,
      lineNumber: entry.lineNumber,
    });
    return;
  }

  if (method === 'Network.requestWillBeSent') {
    const request = params.request || {};
    pushTraceEvent(tabId, {
      kind: 'network.request',
      requestId: params.requestId,
      method: request.method,
      url: request.url,
      resourceType: params.type,
      initiatorType: params.initiator?.type,
    });
    return;
  }

  if (method === 'Network.responseReceived') {
    const response = params.response || {};
    if (session?.active && session.includeResponseBodies) {
      session.responses.set(params.requestId, {
        url: response.url,
        status: response.status,
        mimeType: response.mimeType,
      });
    }
    pushTraceEvent(tabId, {
      kind: 'network.response',
      requestId: params.requestId,
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      mimeType: response.mimeType,
      resourceType: params.type,
      fromDiskCache: response.fromDiskCache,
      fromServiceWorker: response.fromServiceWorker,
    });
    return;
  }

  if (method === 'Network.loadingFinished') {
    if (session?.active && session.includeResponseBodies) {
      await captureJsonResponseBody(tabId, params.requestId, session);
    }
    session?.responses.delete(params.requestId);
    return;
  }

  if (method === 'Network.loadingFailed') {
    session?.responses.delete(params.requestId);
    pushTraceEvent(tabId, {
      kind: 'network.failed',
      requestId: params.requestId,
      resourceType: params.type,
      errorText: params.errorText,
      canceled: params.canceled,
    });
  }
}

export function recordDebuggerDetach(source, reason) {
  const session = source?.tabId ? traceSessions.get(source.tabId) : null;
  if (!session) return;
  session.active = false;
  session.attached = false;
  session.detachedAt = new Date().toISOString();
  session.detachReason = reason;
}

export async function startTraceForTab(tab, payload = {}) {
  return withTabLock(tab.id, async () => {
    if (traceSessions.get(tab.id)?.active) {
      return traceSummaryForTab(tab.id, tab);
    }

    await chrome.debugger.attach(debuggerTarget(tab.id), DEBUGGER_PROTOCOL_VERSION);
    const session = {
      tabId: tab.id,
      attached: true,
      active: true,
      startedAt: new Date().toISOString(),
      maxEvents: Math.min(Math.max(Number(payload.maxEvents || MAX_TRACE_EVENTS), 50), 2_000),
      includeExtensionEvents: Boolean(payload.includeExtensionEvents),
      includeResponseBodies: Boolean(payload.includeResponseBodies),
      responseUrlIncludes: typeof payload.responseUrlIncludes === 'string' ? payload.responseUrlIncludes : '',
      responseBodyCount: 0,
      responses: new Map(),
      events: [],
    };
    traceSessions.set(tab.id, session);

    try {
      await sendDebuggerCommand(tab.id, 'Page.enable');
      if (payload.network !== false) await sendDebuggerCommand(tab.id, 'Network.enable');
      if (payload.console !== false) {
        await sendDebuggerCommand(tab.id, 'Runtime.enable');
        await sendDebuggerCommand(tab.id, 'Log.enable');
      }
    } catch (error) {
      traceSessions.delete(tab.id);
      await detachDebugger(tab.id).catch(() => {});
      throw error;
    }

    return traceSummaryForTab(tab.id, tab);
  });
}

export function traceSummaryForTab(tabId, tab = null) {
  const session = traceSessions.get(tabId);
  return {
    active: Boolean(session?.active),
    tab: tab ? tabInfo(tab) : { id: tabId },
    startedAt: session?.startedAt,
    eventCount: session?.events?.length || 0,
    maxEvents: session?.maxEvents || MAX_TRACE_EVENTS,
    eventSummary: traceEventSummary(session?.events || []),
  };
}

export function traceEventSummary(events = []) {
  const summary = {
    console: {
      count: 0,
      byLevel: {},
    },
    network: {
      requestCount: 0,
      responseCount: 0,
      failedCount: 0,
      statusCounts: {},
      resourceTypes: {},
    },
  };

  for (const event of events) {
    if (event.kind === 'console' || event.kind === 'log') {
      summary.console.count += 1;
      const level = String(event.level || 'unknown');
      summary.console.byLevel[level] = (summary.console.byLevel[level] || 0) + 1;
      continue;
    }

    if (event.kind === 'network.request') summary.network.requestCount += 1;
    if (event.kind === 'network.response') {
      summary.network.responseCount += 1;
      const status = String(event.status || 'unknown');
      summary.network.statusCounts[status] = (summary.network.statusCounts[status] || 0) + 1;
    }
    if (event.kind === 'network.failed') summary.network.failedCount += 1;

    if (String(event.kind || '').startsWith('network.')) {
      const resourceType = String(event.resourceType || 'unknown');
      summary.network.resourceTypes[resourceType] = (summary.network.resourceTypes[resourceType] || 0) + 1;
    }
  }

  return summary;
}

export function traceEventsForTab(tab, payload = {}) {
  const session = traceSessions.get(tab.id);
  if (!session) return { active: false, tab: tabInfo(tab), events: [] };
  const limit = Math.min(Math.max(Number(payload.limit || 100), 1), session.maxEvents);
  return {
    ...traceSummaryForTab(tab.id, tab),
    events: session.events.slice(-limit),
  };
}

export async function stopTraceForTab(tab, payload = {}) {
  return withTabLock(tab.id, async () => {
    const session = traceSessions.get(tab.id);
    if (!session) return { active: false, tab: tabInfo(tab), events: [] };
    session.active = false;
    session.attached = false;
    session.stoppedAt = new Date().toISOString();
    await detachDebugger(tab.id).catch(() => {});
    traceSessions.delete(tab.id);
    const limit = Math.min(Math.max(Number(payload.limit || 100), 1), session.maxEvents);
    return {
      active: false,
      tab: tabInfo(tab),
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt,
      eventCount: session.events.length,
      events: session.events.slice(-limit),
    };
  });
}
