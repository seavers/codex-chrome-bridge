import { groupInfo } from './tab-info.js';
import { withUserFocusPreserved } from './focus-context.js';
import { disableSavedTabGroupIfSupported } from './tab-group-persistence.js';
import { groupOptions, isGroupScoped } from './workspace-policy.js';

export async function listTabGroups(query = {}) {
  if (!chrome.tabGroups) return [];
  const groups = await chrome.tabGroups.query(query);
  return groups.map(groupInfo);
}

export async function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

export async function storageSet(values) {
  return chrome.storage.local.set(values);
}

async function storageSessionGet(keys) {
  if (!chrome.storage?.session?.get) return {};
  return chrome.storage.session.get(keys);
}

async function storageSessionSet(values) {
  if (!chrome.storage?.session?.set) return;
  await chrome.storage.session.set(values);
}

export async function storageRemove(keys) {
  return chrome.storage.local.remove(keys);
}

function normalizedTitle(value) {
  return String(value || '').trim();
}

export function chromeId(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

async function rememberedManagedGroupTitles(title) {
  const normalized = normalizedTitle(title);
  const stored = await storageGet(['codexManagedGroupTitles']).catch(() => ({}));
  const existing = Array.isArray(stored.codexManagedGroupTitles)
    ? stored.codexManagedGroupTitles
    : [];
  const titles = [...existing, normalized].map(normalizedTitle).filter(Boolean);
  return [...new Set(titles)].slice(-32);
}

async function rememberedManagedGroupIds(groupId) {
  const stored = await storageSessionGet(['codexManagedGroupIds']).catch(() => ({}));
  const existing = Array.isArray(stored.codexManagedGroupIds)
    ? stored.codexManagedGroupIds
    : [];
  const ids = [...existing, groupId].filter((value) => Number.isInteger(value) && value >= 0);
  return [...new Set(ids)].slice(-128);
}

async function getStoredCodexTab(payload = {}) {
  if (!(await isGroupScoped(payload))) return getLastFocusedTab();

  const { codexTabId, codexWindowId } = await storageGet(['codexTabId', 'codexWindowId']);
  const tabId = chromeId(codexTabId);
  const windowId = chromeId(codexWindowId);

  if (tabId !== null) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (windowId === null || tab.windowId === windowId) return tab;
    } catch {
      // Browser-session tab IDs are not durable; recover by group below.
    }
  }

  const tabs = (await isGroupScoped(payload)) ? await getCodexGroupTabs(payload) : [await getLastFocusedTab()];
  if (!tabs.length) return null;

  const tab = tabs.find((candidate) => candidate.active) || tabs[0];
  await storageSet({ codexTabId: tab.id, codexWindowId: tab.windowId });
  return tab;
}

export async function getLastFocusedTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const tab = tabs.find((candidate) => chromeId(candidate.id) !== null);
  if (!tab) throw new Error('No active browser tab was found in the last focused window');
  return tab;
}

export async function getTargetTab(payload = {}, options = {}) {
  const payloadTabId = chromeId(payload.tabId);
  if (payloadTabId !== null) {
    const policy = await groupOptions(payload);
    if (payload.allowExternal && policy.policyMode === 'strict') {
      throw new Error('allowExternal is blocked by strict workspace policy');
    }
    const tab = await chrome.tabs.get(payloadTabId);
    if (!payload.allowExternal && policy.policyMode !== 'open') {
      await assertCodexScopedTab(tab, payload);
    }
    return tab;
  }

  const stored = await getStoredCodexTab(payload);
  if (stored) {
    await ensureCodexGroupForTab(stored, payload);
    return chrome.tabs.get(stored.id);
  }

  if (!options.create) {
    throw new Error('No tabId supplied and no Codex tab has been created yet');
  }

  const createWindow = () => chrome.windows.create({
    url: options.url || payload.url || 'about:blank',
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

  const tab = created.tabs?.[0];
  if (chromeId(tab?.id) === null) throw new Error('Failed to create a Codex tab');

  await storageSet({ codexTabId: tab.id, codexWindowId: tab.windowId });
  await ensureCodexGroupForTab(tab, payload);
  return chrome.tabs.get(tab.id);
}

async function getStoredCodexGroup(payload = {}, windowId) {
  if (!chrome.tabGroups) return null;
  const options = await groupOptions(payload);
  const stored = await storageGet(['codexGroupId', 'codexGroupWindowId']);
  const storedGroupId = chromeId(stored.codexGroupId);
  const targetWindowId = chromeId(windowId);

  if (storedGroupId !== null) {
    try {
      const group = await chrome.tabGroups.get(storedGroupId);
      if ((targetWindowId === null || group.windowId === targetWindowId) && group.title === options.title) {
        return group;
      }
    } catch {
      // Browser-session group IDs are not durable; recover by title below.
    }
  }

  const groups = await chrome.tabGroups.query(targetWindowId !== null ? { windowId: targetWindowId } : {});
  return groups.find((group) => group.title === options.title) || null;
}

export async function getCodexGroupTabs(payload = {}) {
  const options = await groupOptions(payload);
  const groups = await listTabGroups();
  const groupIds = new Set(groups
    .filter((group) => group.title === options.title)
    .map((group) => group.id));
  if (!groupIds.size) return [];
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => groupIds.has(tab.groupId));
}

export async function ensureCodexGroupForTab(tab, payload = {}) {
  if (!(await isGroupScoped(payload))) return null;

  if (!chrome.tabGroups || !chrome.tabs.group) {
    throw new Error('chrome.tabGroups API is unavailable; reload the extension after granting the tabGroups permission');
  }

  const options = await groupOptions(payload);
  let group = await getStoredCodexGroup(payload, tab.windowId);
  let groupId = chromeId(group?.id);
  const tabGroupId = chromeId(tab.groupId);

  if (groupId === null && tabGroupId !== null) {
    try {
      const existing = await chrome.tabGroups.get(tabGroupId);
      if (existing.windowId === tab.windowId && existing.title === options.title) {
        groupId = chromeId(existing.id);
      }
    } catch {
      groupId = null;
    }
  }

  if (groupId !== null) {
    await chrome.tabs.group({ groupId, tabIds: [tab.id] });
  } else {
    groupId = await chrome.tabs.group({ tabIds: [tab.id] });
  }

  group = await chrome.tabGroups.update(groupId, {
    title: options.title,
    color: options.color,
    collapsed: false,
  });
  await disableSavedTabGroupIfSupported(group);
  const codexManagedGroupTitles = await rememberedManagedGroupTitles(options.title);
  const codexManagedGroupIds = await rememberedManagedGroupIds(group.id);

  await storageSet({
    codexGroupId: group.id,
    codexGroupWindowId: group.windowId,
    codexGroupTitle: options.title,
    codexGroupColor: options.color,
    codexManagedGroupTitles,
    codexTabId: tab.id,
    codexWindowId: tab.windowId,
  });
  await storageSessionSet({ codexManagedGroupIds });

  return group;
}

async function assertCodexScopedTab(tab, payload = {}) {
  const options = await groupOptions(payload);
  const group = await getStoredCodexGroup(payload, tab.windowId);
  if (group && tab.groupId === group.id) return;

  const groups = await listTabGroups({ windowId: tab.windowId });
  const match = groups.find((candidate) => candidate.id === tab.groupId && candidate.title === options.title);
  if (match) return;

  throw new Error(`Tab ${tab.id} is outside the "${options.title}" group; pass allowExternal=true only for an explicitly user-approved tab`);
}
