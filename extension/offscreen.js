const BRIDGE_WS = 'ws://127.0.0.1:17376/extension';
const RECONNECT_MS = 1500;
const EXTENSION_NAME = 'Chrome MCP Bridge';
const EXTENSION_VERSION = '0.4.1';
const BRIDGE_STATUS_KEY = 'codexBridgeStatus';
const ACTION_LABELS = {
  tabs: '读取标签页',
  windows: '读取窗口',
  open: '打开页面',
  click: '点击元素',
  type: '输入文字',
  snapshot: '获取页面快照',
  text: '读取页面文字',
  screenshot: '截图',
  observe: '观察页面变化',
  diagnostics: '读取页面诊断',
};

let socket = null;
let reconnectTimer = null;
let clientIdPromise = null;
let profileIdPromise = null;
let statusWrite = Promise.resolve();
let latestStatus = null;

function storageLocalGet(keys) {
  if (!chrome?.storage?.local) return Promise.resolve({});
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (value) => resolve(value || {}));
  });
}

function storageLocalSet(value) {
  if (!chrome?.storage?.local) return Promise.resolve();
  return new Promise((resolve) => {
    chrome.storage.local.set(value, () => resolve());
  });
}

function publishStatus(status) {
  const nextStatus = {
    ...status,
    updatedAt: Date.now(),
    bridgeUrl: BRIDGE_WS,
  };
  latestStatus = nextStatus;
  // 按状态产生顺序写入，避免“已连接”先产生却被较早的“未连接”覆盖。
  statusWrite = statusWrite
    .then(() => storageLocalSet({ [BRIDGE_STATUS_KEY]: nextStatus }))
    .catch(() => {});
  chrome.runtime.sendMessage({ type: 'codex-bridge-status', status: nextStatus }).catch(() => {});
}

function actionLabel(action) {
  return ACTION_LABELS[action] || action || '未知动作';
}

function getClientId() {
  if (clientIdPromise) return clientIdPromise;
  clientIdPromise = Promise.resolve().then(() => {
    const clientId = localStorage.getItem('clientId');
    if (clientId) return clientId;
    const generated = crypto.randomUUID();
    localStorage.setItem('clientId', generated);
    return generated;
  });
  return clientIdPromise;
}

function getProfileId() {
  if (profileIdPromise) return profileIdPromise;
  profileIdPromise = Promise.resolve().then(async () => {
    const stored = await storageLocalGet(['codexBridgeProfileId']);
    if (typeof stored.codexBridgeProfileId === 'string' && stored.codexBridgeProfileId) {
      return stored.codexBridgeProfileId;
    }
    const generated = await getClientId();
    await storageLocalSet({ codexBridgeProfileId: generated });
    return generated;
  }).catch(() => getClientId());
  return profileIdPromise;
}

async function helloPayload() {
  return {
    clientId: await getClientId(),
    profileId: await getProfileId(),
    extensionId: chrome.runtime.id,
    version: EXTENSION_VERSION,
    name: EXTENSION_NAME,
    context: 'offscreen',
  };
}

function safeSocketSend(value) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(value));
    return true;
  } catch {
    scheduleReconnect();
    return false;
  }
}

function handleSocketError() {
  scheduleReconnect();
}

async function sendHello() {
  safeSocketSend({
    type: 'hello',
    info: await helloPayload(),
  });
}

async function handleSocketMessage(event) {
  let command;
  try {
    command = JSON.parse(event.data);
  } catch {
    return;
  }

  if (!command.id || !command.action) return;

  publishStatus({ state: 'working', detail: `正在执行：${actionLabel(command.action)}`, action: command.action });

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'codex-bridge-command',
      action: command.action,
      payload: command.payload || {},
    });

    if (response?.ok) {
      publishStatus({
        state: 'connected',
        detail: `已完成：${actionLabel(command.action)}`,
        action: command.action,
        response: { ok: true },
      });
      safeSocketSend({
        id: command.id,
        ok: true,
        result: response.result,
        info: await helloPayload(),
      });
    } else {
      publishStatus({
        state: 'error',
        detail: `执行失败：${actionLabel(command.action)}`,
        action: command.action,
        response: { ok: false, error: response?.error || 'Background command failed' },
      });
      safeSocketSend({
        id: command.id,
        ok: false,
        code: response?.code || 'BACKGROUND_COMMAND_FAILED',
        error: response?.error || 'Background command failed',
        details: response?.details,
        info: await helloPayload(),
      });
    }
  } catch (error) {
    publishStatus({
      state: 'error',
      detail: `响应失败：${actionLabel(command.action)}`,
      action: command.action,
      response: { ok: false, error: String(error?.message || error) },
    });
    safeSocketSend({
      id: command.id,
      ok: false,
      code: 'BACKGROUND_UNAVAILABLE',
      error: String(error?.message || error),
      info: await helloPayload(),
    });
  }
}

function handleSocketOpen() {
  publishStatus({ state: 'connected', detail: '已连接，正在监听 Codex 请求' });
  sendHello().catch(handleSocketError);
}

function handleSocketMessageEvent(event) {
  handleSocketMessage(event).catch(handleSocketError);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'codex-bridge-get-status') return undefined;
  sendResponse({ ok: true, status: latestStatus });
  return undefined;
});

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  publishStatus({ state: 'connecting', detail: '正在连接本地监听地址' });
  socket = new WebSocket(BRIDGE_WS);

  socket.addEventListener('open', handleSocketOpen);
  socket.addEventListener('message', handleSocketMessageEvent);

  socket.addEventListener('close', scheduleReconnect);
  socket.addEventListener('error', scheduleReconnect);
}

function scheduleReconnect() {
  publishStatus({ state: 'disconnected', detail: '未连接，等待本地服务后自动重试' });
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

connect();
