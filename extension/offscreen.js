const NATIVE_HOST_NAME = 'com.codex.chrome_bridge';
const RECONNECT_MS = 1500;
const EXTENSION_NAME = 'Chrome MCP Bridge';
const EXTENSION_VERSION = '0.4.1';
const BRIDGE_STATUS_KEY = 'codexBridgeStatus';
const SOCKET_PATH = '/tmp/codex-chrome-bridge.sock';
const ACTION_LABELS = {
  tabs: '读取标签页', windows: '读取窗口', open: '打开页面', click: '点击元素', type: '输入文字',
  snapshot: '获取页面快照', text: '读取页面文字', screenshot: '截图', observe: '观察页面变化', diagnostics: '读取页面诊断',
};

let nativePort = null;
let reconnectTimer = null;
let clientIdPromise = null;
let profileIdPromise = null;
let statusWrite = Promise.resolve();
let latestStatus = null;

function storageLocalGet(keys) {
  if (!chrome?.storage?.local) return Promise.resolve({});
  return new Promise((resolve) => chrome.storage.local.get(keys, (value) => resolve(value || {})));
}

function storageLocalSet(value) {
  if (!chrome?.storage?.local) return Promise.resolve();
  return new Promise((resolve) => chrome.storage.local.set(value, () => resolve()));
}

function publishStatus(status) {
  const nextStatus = { ...status, updatedAt: Date.now(), transport: 'native-messaging+unix-socket', socketPath: SOCKET_PATH };
  latestStatus = nextStatus;
  statusWrite = statusWrite.then(() => storageLocalSet({ [BRIDGE_STATUS_KEY]: nextStatus })).catch(() => {});
  chrome.runtime.sendMessage({ type: 'codex-bridge-status', status: nextStatus }).catch(() => {});
}

function actionLabel(action) { return ACTION_LABELS[action] || action || '未知动作'; }

function getClientId() {
  if (clientIdPromise) return clientIdPromise;
  clientIdPromise = Promise.resolve().then(() => {
    const stored = localStorage.getItem('clientId');
    if (stored) return stored;
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
    if (typeof stored.codexBridgeProfileId === 'string' && stored.codexBridgeProfileId) return stored.codexBridgeProfileId;
    const generated = await getClientId();
    await storageLocalSet({ codexBridgeProfileId: generated });
    return generated;
  }).catch(() => getClientId());
  return profileIdPromise;
}

async function helloPayload() {
  return {
    type: 'hello',
    info: {
      clientId: await getClientId(),
      profileId: await getProfileId(),
      extensionId: chrome.runtime.id,
      version: EXTENSION_VERSION,
      name: EXTENSION_NAME,
      context: 'offscreen',
      transport: 'native-messaging',
    },
  };
}

async function sendHello() {
  if (nativePort) nativePort.postMessage(await helloPayload());
}

async function handleNativeMessage(command) {
  if (!command?.id || !command.action) return;
  publishStatus({ state: 'working', detail: `正在执行：${actionLabel(command.action)}`, action: command.action });
  try {
    const response = await chrome.runtime.sendMessage({ type: 'codex-bridge-command', action: command.action, payload: command.payload || {} });
    const info = (await helloPayload()).info;
    if (response?.ok) {
      publishStatus({ state: 'connected', detail: `已完成：${actionLabel(command.action)}`, action: command.action, response: { ok: true } });
      nativePort?.postMessage({ id: command.id, ok: true, result: response.result, info });
    } else {
      publishStatus({ state: 'error', detail: `执行失败：${actionLabel(command.action)}`, action: command.action, response: { ok: false, error: response?.error || 'Background command failed' } });
      nativePort?.postMessage({ id: command.id, ok: false, code: response?.code || 'BACKGROUND_COMMAND_FAILED', error: response?.error || 'Background command failed', details: response?.details, info });
    }
  } catch (error) {
    publishStatus({ state: 'error', detail: `响应失败：${actionLabel(command.action)}`, action: command.action, response: { ok: false, error: String(error?.message || error) } });
    nativePort?.postMessage({ id: command.id, ok: false, code: 'BACKGROUND_UNAVAILABLE', error: String(error?.message || error) });
  }
}

function scheduleReconnect() {
  publishStatus({ state: 'disconnected', detail: 'Native Messaging Host 未连接，等待自动重试' });
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, RECONNECT_MS);
}

function connect() {
  if (nativePort) return;
  publishStatus({ state: 'connecting', detail: '正在按需连接 Native Messaging Host' });
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    nativePort.onMessage.addListener((message) => handleNativeMessage(message).catch(scheduleReconnect));
    nativePort.onDisconnect.addListener(() => { nativePort = null; scheduleReconnect(); });
    publishStatus({ state: 'connected', detail: '已连接 Native Messaging Host' });
    sendHello().catch(scheduleReconnect);
  } catch (error) {
    publishStatus({ state: 'error', detail: `Native Messaging Host 连接失败：${String(error?.message || error)}` });
    scheduleReconnect();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'codex-bridge-get-status') return undefined;
  sendResponse({ ok: true, status: latestStatus });
  return undefined;
});

connect();
