import { closeTabsWithGroupPersistenceMitigation } from './tab-cleanup.js';
import { withUserFocusPreserved } from './focus-context.js';
import { groupInfo, tabInfo } from './tab-info.js';
import { waitForTabComplete } from './tab-loading.js';
import { requireConfirmed } from './safety-gates.js';
import { groupOptions, isGroupScoped } from './workspace-policy.js';
import {
  chromeId,
  ensureCodexGroupForTab,
  getCodexGroupTabs,
  getLastFocusedTab,
  getTargetTab,
  listTabGroups,
  storageGet,
  storageRemove,
  storageSet,
} from './workspace-tabs.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForActivatedTab(tabId, timeoutMs = 2_000) {
  const started = Date.now();
  let candidate = await chrome.tabs.get(tabId);
  while (!candidate.active && Date.now() - started < timeoutMs) {
    await delay(100);
    candidate = await chrome.tabs.get(tabId);
  }
  if (!candidate.active) throw new Error('Tab did not become active after activation');
  return candidate;
}

export async function listTabs(payload = {}) {
  if (payload.includeAll) requireConfirmed(payload, 'tabs includeAll');
  const tabs = await chrome.tabs.query({});
  const groups = await listTabGroups();
  const options = await groupOptions(payload);
  const codexGroups = groups.filter((group) => group.title === options.title);
  const codexGroupIds = new Set(codexGroups.map((group) => group.id));
  const scoped = payload.includeAll === false;
  const visibleTabs = scoped
    ? tabs.filter((tab) => codexGroupIds.has(tab.groupId))
    : tabs;

  return {
    scope: scoped ? 'codex-group' : 'all-tabs',
    configuredGroup: options,
    groups: scoped ? codexGroups : groups,
    tabs: visibleTabs.map((tab) => tabInfo(tab, { groups })),
  };
}

export async function listWindows(payload = {}) {
  if (payload.includeAll) requireConfirmed(payload, 'windows includeAll');
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });
  const groups = await listTabGroups();
  const options = await groupOptions(payload);
  const scoped = payload.includeAll === false;

  const windowInfos = windows.map((window) => {
    const windowGroups = groups.filter((group) => group.windowId === window.id);
    const codexGroups = windowGroups.filter((group) => group.title === options.title);
    const visibleGroups = scoped ? codexGroups : windowGroups;
    const visibleGroupIds = new Set(visibleGroups.map((group) => group.id));
    const visibleTabs = scoped
      ? (window.tabs || []).filter((tab) => visibleGroupIds.has(tab.groupId))
      : (window.tabs || []);

    return {
      id: window.id,
      focused: window.focused,
      top: window.top,
      left: window.left,
      width: window.width,
      height: window.height,
      state: window.state,
      type: window.type,
      groups: visibleGroups.map(groupInfo),
      tabs: visibleTabs.map((tab) => tabInfo(tab, { groups: visibleGroups })),
      tabCount: visibleTabs.length,
    };
  }).filter((window) => !scoped || window.groups.length || window.tabs.length);

  return {
    scope: scoped ? 'codex-group' : 'all-windows',
    configuredGroup: options,
    windowCount: windowInfos.length,
    tabCount: windowInfos.reduce((sum, window) => sum + window.tabCount, 0),
    windows: windowInfos,
  };
}

export async function ensureCodexTab(payload) {
  const tab = await getTargetTab(payload, {
    create: true,
    url: payload.url || 'about:blank',
  });
  let group = await ensureCodexGroupForTab(tab, payload);

  if (payload.url && tab.url !== payload.url) {
    await chrome.tabs.update(tab.id, { url: payload.url, active: Boolean(payload.active) });
    const loaded = await waitForTabComplete(tab.id);
    group = await ensureCodexGroupForTab(loaded, payload);
    await storageSet({ codexTabId: loaded.id, codexWindowId: loaded.windowId });
    return tabInfo(loaded, { group });
  }

  if (payload.active) {
    await chrome.tabs.update(tab.id, { active: true });
  }

  await storageSet({ codexTabId: tab.id, codexWindowId: tab.windowId });
  return tabInfo(await chrome.tabs.get(tab.id), { group });
}

export async function adoptTab(payload = {}) {
  requireConfirmed(payload, 'adoptTab');
  const payloadTabId = chromeId(payload.tabId);
  const tab = payloadTabId !== null
    ? await chrome.tabs.get(payloadTabId)
    : await getLastFocusedTab();
  const group = await ensureCodexGroupForTab(tab, payload);
  const latest = await chrome.tabs.get(tab.id);
  await storageSet({ codexTabId: latest.id, codexWindowId: latest.windowId });
  return {
    adopted: true,
    tab: tabInfo(latest, { group }),
  };
}

export async function openTab(payload) {
  if (!payload.url) throw new Error('open requires url');
  if (payload.newTab && chromeId(payload.tabId) !== null) throw new Error('open cannot use newTab and tabId together');
  if (payload.newTab) return createGroupedTab(payload);

  const target = await getTargetTab(payload, { create: true, url: payload.url });
  let group = await ensureCodexGroupForTab(target, payload);
  await chrome.tabs.update(target.id, { url: payload.url, active: Boolean(payload.active) });
  const tab = await waitForTabComplete(target.id);
  group = await ensureCodexGroupForTab(tab, payload);
  await storageSet({ codexTabId: tab.id, codexWindowId: tab.windowId });
  return tabInfo(tab, { group });
}

async function createGroupedTab(payload) {
  if (!(await isGroupScoped(payload))) {
    const tab = await chrome.tabs.create({
      url: payload.url,
      active: Boolean(payload.active),
    });
    if (chromeId(tab?.id) === null) throw new Error('Failed to create a Chrome tab');
    const loaded = await waitForTabComplete(tab.id);
    await storageSet({ codexTabId: loaded.id, codexWindowId: loaded.windowId });
    return tabInfo(loaded);
  }

  const options = await groupOptions(payload);
  let tabs = await getCodexGroupTabs(payload);
  let tab;

  if (tabs.length) {
    const lastTab = tabs.reduce((latest, current) => (
      current.windowId === latest.windowId && current.index > latest.index ? current : latest
    ), tabs[0]);
    tab = await chrome.tabs.create({
      windowId: lastTab.windowId,
      index: lastTab.index + 1,
      url: payload.url,
      active: Boolean(payload.active),
    });
  } else {
    const createWindow = () => chrome.windows.create({
      url: payload.url,
      focused: Boolean(payload.active),
      width: 1280,
      height: 900,
      left: 80,
      top: 80,
      type: 'normal',
    });
    const created = payload.active
      ? await createWindow()
      : await withUserFocusPreserved(createWindow);
    tab = created.tabs?.[0];
  }

  if (chromeId(tab?.id) === null) throw new Error('Failed to create a grouped Codex tab');
  const group = await ensureCodexGroupForTab(tab, { ...payload, groupTitle: options.title, groupColor: options.color });
  const loaded = await waitForTabComplete(tab.id);
  await storageSet({ codexTabId: loaded.id, codexWindowId: loaded.windowId });
  return tabInfo(loaded, { group });
}

export async function groupStatus(payload = {}) {
  const options = await groupOptions(payload);
  const groups = await listTabGroups();
  const codexGroups = groups.filter((group) => group.title === options.title);
  const groupIds = new Set(codexGroups.map((group) => group.id));
  const tabs = (await chrome.tabs.query({})).filter((tab) => groupIds.has(tab.groupId));

  return {
    configuredGroup: options,
    groups: codexGroups,
    tabs: tabs.map((tab) => tabInfo(tab, { groups: codexGroups })),
  };
}

export async function workspaceStatus(payload = {}) {
  const includeTabs = Boolean(payload.includeTabs);
  const status = await groupStatus({ ...payload, includeTabs });
  return {
    workspace: status.configuredGroup,
    policy: {
      mode: status.configuredGroup.policyMode,
      externalTabs: status.configuredGroup.externalTabs,
      mutationConfirmation: 'required',
      sensitiveConfirmation: 'required',
    },
    groups: status.groups,
    tabs: includeTabs ? status.tabs : undefined,
    counts: {
      groups: status.groups.length,
      tabs: status.tabs.length,
    },
  };
}

export async function setWorkspace(payload = {}) {
  requireConfirmed(payload, 'setWorkspace');
  const options = await groupOptions(payload);
  await storageSet({
    codexWorkspaceName: options.workspace,
    codexWorkspaceGroupTitle: options.title,
    codexWorkspaceGroupColor: options.color,
    codexWorkspacePolicyMode: options.policyMode,
  });

  const { codexTabId } = await storageGet(['codexTabId']);
  const storedTabId = chromeId(codexTabId);
  if (storedTabId !== null) {
    try {
      const tab = await chrome.tabs.get(storedTabId);
      await ensureCodexGroupForTab(tab, {
        groupTitle: options.title,
        groupColor: options.color,
      });
    } catch {
      await storageRemove(['codexTabId', 'codexWindowId', 'codexGroupId', 'codexGroupWindowId']);
    }
  }

  return workspaceStatus({ includeTabs: true });
}

export async function clearWorkspace(payload = {}) {
  requireConfirmed(payload, 'clearWorkspace');
  await storageRemove([
    'codexWorkspaceName',
    'codexWorkspaceGroupTitle',
    'codexWorkspaceGroupColor',
    'codexWorkspacePolicyMode',
    'codexGroupId',
    'codexGroupWindowId',
  ]);
  return workspaceStatus({ includeTabs: true });
}

export async function activateTab(payload) {
  const tab = await getTargetTab(payload);
  await chrome.tabs.update(tab.id, { active: true });
  if (payload.focusWindow) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return tabInfo(await waitForActivatedTab(tab.id));
}

export async function closeTab(payload) {
  requireConfirmed(payload, 'closeTab');
  const tab = await getTargetTab(payload);
  const cleanup = await closeTabsWithGroupPersistenceMitigation([tab]);
  const { codexTabId } = await storageGet(['codexTabId']);
  if (codexTabId === tab.id) {
    await storageRemove(['codexTabId', 'codexWindowId']);
  }
  return {
    closed: true,
    tab: tabInfo(tab),
    tabGroupPersistenceMitigation: cleanup,
  };
}

export async function closeGroup(payload) {
  requireConfirmed(payload, 'closeGroup');
  const tabs = await getCodexGroupTabs(payload);
  if (!tabs.length) return { closed: 0, tabs: [] };
  const cleanup = await closeTabsWithGroupPersistenceMitigation(tabs);
  await storageRemove(['codexTabId', 'codexWindowId', 'codexGroupId', 'codexGroupWindowId']);
  return {
    closed: tabs.length,
    tabs: tabs.map((tab) => tabInfo(tab)),
    tabGroupPersistenceMitigation: cleanup,
  };
}

export async function goBack(payload) {
  const tab = await getTargetTab(payload);
  await chrome.tabs.goBack(tab.id);
  const loaded = await waitForTabComplete(tab.id, Number(payload.timeoutMs || 25_000));
  return tabInfo(loaded);
}

export async function goForward(payload) {
  const tab = await getTargetTab(payload);
  await chrome.tabs.goForward(tab.id);
  const loaded = await waitForTabComplete(tab.id, Number(payload.timeoutMs || 25_000));
  return tabInfo(loaded);
}

export async function reloadTab(payload) {
  const tab = await getTargetTab(payload);
  await chrome.tabs.reload(tab.id, { bypassCache: Boolean(payload.bypassCache) });
  const loaded = await waitForTabComplete(tab.id, Number(payload.timeoutMs || 25_000));
  return tabInfo(loaded);
}
