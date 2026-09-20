import { COMMAND_PAYLOAD_SCHEMAS } from './command-registry.mjs';

const DEFAULT_SESSION_GROUP_PREFIX = 'Codex Bridge';
const SESSION_TITLE_ENV_KEYS = Object.freeze([
  'CHROME_BRIDGE_SESSION_TITLE',
  'CODEX_SESSION_TITLE',
  'CODEX_THREAD_TITLE',
  'CODEX_THREAD_NAME',
  'CODEX_CONVERSATION_TITLE',
]);
const SESSION_ID_ENV_KEYS = Object.freeze([
  'CODEX_THREAD_ID',
  'CODEX_SESSION_ID',
]);

function normalizeTitlePart(value) {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, 80).trim();
}

function shortSessionId(value) {
  const normalized = normalizeTitlePart(value);
  if (!normalized) return '';
  const compact = normalized.replace(/[^a-zA-Z0-9]+/g, '');
  return (compact || normalized).slice(0, 8);
}

export function sessionGroupTitleFromEnv(env = process.env) {
  for (const key of SESSION_TITLE_ENV_KEYS) {
    const title = normalizeTitlePart(env?.[key]);
    if (title) return `${DEFAULT_SESSION_GROUP_PREFIX} - ${title}`;
  }

  for (const key of SESSION_ID_ENV_KEYS) {
    const id = shortSessionId(env?.[key]);
    if (id) return `${DEFAULT_SESSION_GROUP_PREFIX} - ${id}`;
  }

  return undefined;
}

export function withSessionGroupTitle(action, payload = {}, env = process.env) {
  if (!COMMAND_PAYLOAD_SCHEMAS[action]?.includes('groupTitle') || payload.groupTitle !== undefined) {
    return payload;
  }

  const groupOnlyActions = new Set(['group', 'workspace', 'setWorkspace', 'clearWorkspace', 'adoptTab', 'closeGroup']);
  if (!groupOnlyActions.has(action) && !['scoped', 'strict'].includes(payload.policyMode)) return payload;

  const groupTitle = sessionGroupTitleFromEnv(env);
  return groupTitle ? { ...payload, groupTitle } : payload;
}
