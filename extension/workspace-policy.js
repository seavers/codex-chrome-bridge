const DEFAULT_WORKSPACE_NAME = 'default';
export const DEFAULT_GROUP_TITLE = 'Codex Bridge';
const DEFAULT_GROUP_COLOR = 'purple';
const DEFAULT_POLICY_MODE = 'open';
const ALLOWED_GROUP_COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
const ALLOWED_POLICY_MODES = new Set(['open', 'scoped', 'strict']);

function normalizeString(value, fallback) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function normalizeGroupColor(value) {
  const color = normalizeString(value, DEFAULT_GROUP_COLOR);
  return ALLOWED_GROUP_COLORS.has(color) ? color : DEFAULT_GROUP_COLOR;
}

function normalizePolicyMode(value) {
  const mode = normalizeString(value, DEFAULT_POLICY_MODE);
  return ALLOWED_POLICY_MODES.has(mode) ? mode : DEFAULT_POLICY_MODE;
}

async function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

export async function groupOptions(payload = {}) {
  const stored = await storageGet([
    'codexWorkspaceName',
    'codexWorkspaceGroupTitle',
    'codexWorkspaceGroupColor',
    'codexWorkspacePolicyMode',
  ]).catch(() => ({}));

  return {
    workspace: normalizeString(payload.name || stored.codexWorkspaceName, DEFAULT_WORKSPACE_NAME),
    title: normalizeString(payload.groupTitle || stored.codexWorkspaceGroupTitle, DEFAULT_GROUP_TITLE),
    color: normalizeGroupColor(payload.groupColor || stored.codexWorkspaceGroupColor),
    policyMode: normalizePolicyMode(payload.policyMode || stored.codexWorkspacePolicyMode),
    externalTabs: normalizePolicyMode(payload.policyMode || stored.codexWorkspacePolicyMode) === 'strict'
      ? 'blocked'
      : normalizePolicyMode(payload.policyMode || stored.codexWorkspacePolicyMode) === 'scoped' ? 'explicit-only' : 'all',
  };
}

export async function isGroupScoped(payload = {}) {
  const stored = await storageGet(['codexWorkspacePolicyMode']).catch(() => ({}));
  const policyMode = normalizePolicyMode(payload.policyMode || payload.codexWorkspacePolicyMode || stored.codexWorkspacePolicyMode);
  return policyMode !== 'open' || payload.groupTitle !== undefined || payload.groupColor !== undefined;
}
