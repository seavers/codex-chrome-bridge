const DEFAULT_STATUS = {
  state: 'disconnected',
  detail: '尚未连接到本地服务',
  transport: 'native-messaging+unix-socket',
};

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

const elements = {
  card: document.querySelector('.status-card'),
  dot: document.querySelector('#state-dot'),
  state: document.querySelector('#state-label'),
  detail: document.querySelector('#state-detail'),
  updated: document.querySelector('#updated-at'),
  url: document.querySelector('#bridge-url'),
  action: document.querySelector('#last-action'),
  response: document.querySelector('#last-response'),
};

function actionLabel(action) {
  return ACTION_LABELS[action] || action || '未知动作';
}

function stateLabel(state) {
  return ({ connected: '已连接', working: '执行中', connecting: '连接中', disconnected: '未连接', error: '发生错误' })[state] || '等待中';
}

function render(status) {
  const next = { ...DEFAULT_STATUS, ...status };
  const state = next.state;
  elements.card.className = `status-card ${state}`;
  elements.dot.style.background = state === 'connected' ? '#188038' : state === 'working' ? '#1a73e8' : state === 'error' ? '#d93025' : '#f9ab00';
  elements.state.textContent = stateLabel(state);
  elements.detail.textContent = next.detail;
  elements.url.textContent = next.socketPath
    ? `Native Messaging + ${next.socketPath}`
    : 'Native Messaging + 本地 Unix Socket';
  elements.updated.textContent = next.updatedAt ? new Date(next.updatedAt).toLocaleTimeString() : '';

  if (next.action) {
    elements.action.className = '';
    elements.action.textContent = actionLabel(next.action);
  }
  if (next.response) {
    const ok = next.response.ok;
    elements.response.className = `response${ok ? '' : ' error'}`;
    elements.response.textContent = ok ? '✓ 已收到成功响应' : `✕ ${next.response.error || '请求失败'}`;
  }
}

function loadStatus() {
  chrome.storage.local.get(['codexBridgeStatus'], (result) => render(result.codexBridgeStatus || DEFAULT_STATUS));
  chrome.runtime.sendMessage({ type: 'codex-bridge-get-status' }, (response) => {
    if (chrome.runtime.lastError || !response?.status) return;
    render(response.status);
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'codex-bridge-status') render(message.status || DEFAULT_STATUS);
});

document.querySelector('#refresh').addEventListener('click', loadStatus);
loadStatus();
