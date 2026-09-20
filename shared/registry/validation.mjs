import {
  COMMAND_PAYLOAD_SCHEMAS,
  HTTP_METHODS,
  NETWORK_EMULATION_PROFILES,
  TAB_GROUP_COLORS,
} from './actions.mjs';
import { COMMAND_METADATA } from './metadata.mjs';

const HTTP_METHOD_SET = new Set(HTTP_METHODS);
const PAYLOAD_TIMEOUT_MIN_MS = 0;
const PAYLOAD_TIMEOUT_MAX_MS = 300_000;

export class CommandPayloadValidationError extends Error {
  constructor(message, details = undefined, code = 'INVALID_PAYLOAD') {
    super(message);
    this.name = 'CommandPayloadValidationError';
    this.code = code;
    this.details = details;
  }
}

function payloadError(message, details = undefined, code = 'INVALID_PAYLOAD') {
  return new CommandPayloadValidationError(message, details, code);
}

function confirmationError(action) {
  return payloadError(`${action} requires confirmed=true`, undefined, 'CONFIRMATION_REQUIRED');
}

function sensitiveConfirmationError(action) {
  return payloadError(
    `${action} requires confirmSensitive=true because it can expose private browser data`,
    undefined,
    'SENSITIVE_CONFIRMATION_REQUIRED',
  );
}

function rejectUnknownKeys(payload, allowedKeys, action) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw payloadError(`${action} payload must be an object`);
  }
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw payloadError(`${action} payload has unsupported keys: ${unknown.join(', ')}`);
  }
}

function ensureString(payload, key, action, options = {}) {
  if (payload[key] === undefined) {
    if (options.required) throw payloadError(`${action}.${key} is required`);
    return;
  }
  if (typeof payload[key] !== 'string') {
    throw payloadError(`${action}.${key} must be a string`);
  }
}

function ensureRequired(payload, key, action) {
  if (payload[key] === undefined || payload[key] === null) {
    throw payloadError(`${action}.${key} is required`);
  }
}

function ensureNonEmptyString(payload, key, action) {
  ensureRequired(payload, key, action);
  ensureString(payload, key, action);
  if (!payload[key].trim()) {
    throw payloadError(`${action}.${key} must not be empty`);
  }
}

function ensureBoolean(payload, key, action) {
  if (payload[key] !== undefined && typeof payload[key] !== 'boolean') {
    throw payloadError(`${action}.${key} must be a boolean`);
  }
}

function ensureNumber(payload, key, action) {
  if (payload[key] !== undefined && (typeof payload[key] !== 'number' || !Number.isFinite(payload[key]))) {
    throw payloadError(`${action}.${key} must be a number`);
  }
}

function ensureNumberRange(payload, key, action, min, max) {
  ensureNumber(payload, key, action);
  if (payload[key] === undefined) return;
  if (payload[key] < min || payload[key] > max) {
    throw payloadError(`${action}.${key} must be between ${min} and ${max}`);
  }
}

function ensureNonNegativeInteger(payload, key, action) {
  ensureNumber(payload, key, action);
  if (payload[key] === undefined) return;
  if (!Number.isInteger(payload[key]) || payload[key] < 0) {
    throw payloadError(`${action}.${key} must be a non-negative integer`);
  }
}

function ensureArray(payload, key, action) {
  if (payload[key] !== undefined && !Array.isArray(payload[key])) {
    throw payloadError(`${action}.${key} must be an array`);
  }
}

function ensureStringArray(payload, key, action) {
  ensureArray(payload, key, action);
  if (payload[key] !== undefined && payload[key].some((value) => typeof value !== 'string')) {
    throw payloadError(`${action}.${key} must be an array of strings`);
  }
}

function ensureObject(payload, key, action) {
  if (payload[key] !== undefined && (!payload[key] || typeof payload[key] !== 'object' || Array.isArray(payload[key]))) {
    throw payloadError(`${action}.${key} must be an object`);
  }
}

function ensureRecordValues(payload, key, action, allowedTypes) {
  ensureObject(payload, key, action);
  if (payload[key] === undefined) return;
  for (const [recordKey, value] of Object.entries(payload[key])) {
    if (!allowedTypes.includes(typeof value)) {
      throw payloadError(`${action}.${key}.${recordKey} must be one of: ${allowedTypes.join(', ')}`);
    }
  }
}

function ensureEnum(payload, key, action, values) {
  if (payload[key] !== undefined && !values.includes(payload[key])) {
    throw payloadError(`${action}.${key} must be one of: ${values.join(', ')}`);
  }
}

function ensureHttpMethod(payload, action) {
  if (payload.method === undefined) return;
  if (!HTTP_METHOD_SET.has(payload.method)) {
    throw payloadError(`${action}.method must be one of: ${HTTP_METHODS.join(', ')}`);
  }
}

function ensureChoices(payload, action) {
  ensureArray(payload, 'choices', action);
  if (payload.choices === undefined) return;
  if (payload.choices.length > 8) {
    throw payloadError(`${action}.choices must contain at most 8 entries`);
  }
  payload.choices.forEach((choice, index) => {
    if (typeof choice === 'string') return;
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
      throw payloadError(`${action}.choices[${index}] must be a string or { value, label } object`);
    }
    if (typeof choice.value !== 'string' || typeof choice.label !== 'string') {
      throw payloadError(`${action}.choices[${index}] value and label must be strings`);
    }
  });
}

function ensureUrlProtocol(payload, key, action, allowedProtocols) {
  if (payload[key] === undefined) return;
  let parsed;
  try {
    parsed = new URL(payload[key]);
  } catch {
    throw payloadError(`${action}.${key} must be a valid URL`);
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw payloadError(`${action}.${key} URL protocol must be one of: ${allowedProtocols.join(', ')}`);
  }
  if (parsed.protocol === 'about:' && parsed.href !== 'about:blank') {
    throw payloadError(`${action}.${key} only supports about:blank for about: URLs`);
  }
}

function ensureSelectTarget(payload, action) {
  if (action !== 'select') return;
  if (payload.value === undefined && payload.label === undefined && payload.index === undefined) {
    throw payloadError('select requires value, label, or index');
  }
}

function requiresConfirmed(action, payload) {
  if (['windows', 'tabs'].includes(action)) return payload.includeAll === true;
  if (action === 'fillForm') return payload.dryRun === false;
  return Boolean(COMMAND_METADATA[action]?.requiresConfirmation);
}

function requiresSensitiveConfirmed(action, payload) {
  if (action === 'cookiesList') {
    return Boolean(payload.includeValues || (!payload.url && !payload.domain && !payload.name));
  }
  if (action === 'storageSnapshot') return Boolean(payload.includeValues);
  if (action === 'fetchUrl') return payload.credentials === 'include';
  return false;
}

export function validateCommandPayload(action, payload = {}) {
  const allowed = COMMAND_PAYLOAD_SCHEMAS[action];
  if (!allowed) {
    const error = new Error(`Unsupported action: ${action}`);
    error.code = 'UNSUPPORTED_ACTION';
    throw error;
  }

  const normalizedPayload = payload === undefined ? {} : payload;
  rejectUnknownKeys(normalizedPayload, allowed, action);

  for (const key of ['tabId', 'timeoutMs', 'limit', 'maxChars', 'maxTextChars', 'maxItems', 'maxValueChars', 'maxPixels', 'requestTimeoutMs', 'x', 'y', 'targetX', 'targetY', 'index', 'scale', 'startTime', 'endTime', 'maxEvents', 'scrollStepPx', 'maxScrollSteps', 'scrollDelayMs', 'downloadTimeoutMs', 'width', 'height', 'deviceScaleFactor', 'latencyMs', 'downloadKbps', 'uploadKbps']) {
    ensureNumber(normalizedPayload, key, action);
  }
  ensureNonNegativeInteger(normalizedPayload, 'tabId', action);
  ensureNonNegativeInteger(normalizedPayload, 'index', action);
  for (const key of ['includeAll', 'includeTabs', 'active', 'newTab', 'allowExternal', 'focusWindow', 'confirmed', 'confirmSensitive', 'bypassCache', 'visible', 'outer', 'fullPage', 'landscape', 'printBackground', 'preferCssPageSize', 'trusted', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'network', 'console', 'includeExtensionEvents', 'includeValues', 'allowText', 'closeOnAnswer', 'dryRun', 'accept', 'mobile']) {
    ensureBoolean(normalizedPayload, key, action);
  }
  for (const key of ['url', 'selector', 'elementRef', 'targetSelector', 'targetElementRef', 'role', 'text', 'nearText', 'placeholder', 'href', 'actionKind', 'risk', 'kind', 'fallback', 'pageRanges', 'button', 'key', 'code', 'value', 'label', 'file', 'query', 'domain', 'name', 'method', 'credentials', 'question', 'groupTitle', 'groupColor', 'promptText', 'policyMode', 'waitForText', 'waitForPattern', 'networkProfile']) {
    ensureString(normalizedPayload, key, action);
  }
  ensureStringArray(normalizedPayload, 'files', action);
  ensureChoices(normalizedPayload, action);
  ensureRecordValues(normalizedPayload, 'fields', action, ['string', 'number', 'boolean']);
  ensureRecordValues(normalizedPayload, 'headers', action, ['string']);
  ensureEnum(normalizedPayload, 'groupColor', action, TAB_GROUP_COLORS);
  ensureEnum(normalizedPayload, 'policyMode', action, ['open', 'scoped', 'strict']);
  ensureEnum(normalizedPayload, 'kind', action, ['all', 'tables', 'forms', 'lists', 'keyValues']);
  ensureEnum(normalizedPayload, 'fallback', action, ['viewport', 'error']);
  ensureEnum(normalizedPayload, 'credentials', action, ['omit', 'include']);
  ensureEnum(normalizedPayload, 'networkProfile', action, NETWORK_EMULATION_PROFILES);
  if (action === 'fetchUrl') {
    ensureHttpMethod(normalizedPayload, action);
  }
  if (['ensureTab', 'open'].includes(action)) {
    ensureUrlProtocol(normalizedPayload, 'url', action, ['http:', 'https:', 'about:']);
  }
  if (['cookiesList', 'fetchUrl'].includes(action)) {
    ensureUrlProtocol(normalizedPayload, 'url', action, ['http:', 'https:']);
  }

  if (['goBack', 'goForward', 'reloadTab', 'waitForSelector'].includes(action)) {
    ensureNumberRange(normalizedPayload, 'timeoutMs', action, PAYLOAD_TIMEOUT_MIN_MS, PAYLOAD_TIMEOUT_MAX_MS);
  }
  if (['observe', 'findElements'].includes(action)) {
    ensureNumberRange(normalizedPayload, 'limit', action, 1, 300);
    ensureNumberRange(normalizedPayload, 'maxTextChars', action, 20, 1_000);
  }
  if (action === 'extractPage') {
    ensureNumberRange(normalizedPayload, 'maxItems', action, 1, 500);
    ensureNumberRange(normalizedPayload, 'maxTextChars', action, 50, 2_000);
  }
  if (['snapshot', 'text'].includes(action)) {
    ensureNumberRange(normalizedPayload, 'maxChars', action, 1_000, 200_000);
    ensureNumberRange(normalizedPayload, 'scrollStepPx', action, 100, 5_000);
    ensureNumberRange(normalizedPayload, 'maxScrollSteps', action, 1, 200);
    ensureNumberRange(normalizedPayload, 'scrollDelayMs', action, 0, 2_000);
  }
  if (action === 'html') {
    ensureNumberRange(normalizedPayload, 'maxChars', action, 1_000, 500_000);
  }
  if (action === 'screenshot') {
    ensureNumberRange(normalizedPayload, 'maxPixels', action, 1, 1_000_000_000);
  }
  if (action === 'printPdf') {
    ensureNumberRange(normalizedPayload, 'scale', action, 0.1, 2);
  }
  if (action === 'traceStart') {
    ensureNumberRange(normalizedPayload, 'maxEvents', action, 50, 2_000);
  }
  if (['traceEvents', 'traceStop'].includes(action)) {
    ensureNumberRange(normalizedPayload, 'limit', action, 1, 2_000);
  }
  if (['historySearch', 'bookmarksSearch'].includes(action)) {
    ensureNumberRange(normalizedPayload, 'limit', action, 1, 200);
  }
  if (action === 'historySearch') {
    ensureNumberRange(normalizedPayload, 'startTime', action, 0, Number.MAX_SAFE_INTEGER);
    ensureNumberRange(normalizedPayload, 'endTime', action, 0, Number.MAX_SAFE_INTEGER);
  }
  if (action === 'cookiesList') {
    ensureNumberRange(normalizedPayload, 'limit', action, 1, 500);
  }
  if (action === 'storageSnapshot') {
    ensureNumberRange(normalizedPayload, 'maxValueChars', action, 50, 5_000);
  }
  if (action === 'fetchUrl') {
    ensureNumberRange(normalizedPayload, 'maxChars', action, 100, 200_000);
    ensureNumberRange(normalizedPayload, 'requestTimeoutMs', action, 1_000, 60_000);
  }
  if (action === 'askUser') {
    ensureNumberRange(normalizedPayload, 'timeoutMs', action, 5_000, 1_800_000);
  }
  if (action === 'download') {
    ensureNumberRange(normalizedPayload, 'downloadTimeoutMs', action, 1_000, 180_000);
  }
  if (action === 'setViewport') {
    ensureNumberRange(normalizedPayload, 'width', action, 200, 10_000);
    ensureNumberRange(normalizedPayload, 'height', action, 200, 10_000);
    ensureNumberRange(normalizedPayload, 'deviceScaleFactor', action, 0.1, 5);
  }
  if (action === 'emulateNetwork') {
    ensureNumberRange(normalizedPayload, 'latencyMs', action, 1, 120_000);
    ensureNumberRange(normalizedPayload, 'downloadKbps', action, 1, 1_000_000);
    ensureNumberRange(normalizedPayload, 'uploadKbps', action, 1, 1_000_000);
  }

  if (action === 'open') {
    ensureNonEmptyString(normalizedPayload, 'url', action);
  }
  if (action === 'setViewport') {
    ensureRequired(normalizedPayload, 'width', action);
    ensureRequired(normalizedPayload, 'height', action);
  }
  if (action === 'emulateNetwork') {
    ensureNonEmptyString(normalizedPayload, 'networkProfile', action);
    if (normalizedPayload.networkProfile === 'custom') {
      ensureRequired(normalizedPayload, 'latencyMs', action);
      ensureRequired(normalizedPayload, 'downloadKbps', action);
      ensureRequired(normalizedPayload, 'uploadKbps', action);
    }
  }
  if (['waitForSelector', 'click', 'download', 'select', 'listSelectOptions', 'uploadFile'].includes(action)) {
    ensureNonEmptyString(normalizedPayload, 'selector', action);
  }
  ensureSelectTarget(normalizedPayload, action);
  if (action === 'clickAt') {
    ensureRequired(normalizedPayload, 'x', action);
    ensureRequired(normalizedPayload, 'y', action);
  }
  if (action === 'dragDrop') {
    const hasSourceElement = normalizedPayload.selector || normalizedPayload.elementRef;
    const hasSourcePoint = normalizedPayload.x !== undefined && normalizedPayload.y !== undefined;
    const hasTargetElement = normalizedPayload.targetSelector || normalizedPayload.targetElementRef;
    const hasTargetPoint = normalizedPayload.targetX !== undefined && normalizedPayload.targetY !== undefined;
    if (!hasSourceElement && !hasSourcePoint) throw payloadError('dragDrop requires selector, elementRef, or x/y');
    if (!hasTargetElement && !hasTargetPoint) throw payloadError('dragDrop requires targetSelector, targetElementRef, or targetX/targetY');
  }
  if (action === 'type') {
    ensureNonEmptyString(normalizedPayload, 'selector', action);
    ensureRequired(normalizedPayload, 'text', action);
  }
  if (action === 'press') {
    ensureNonEmptyString(normalizedPayload, 'key', action);
  }
  if (action === 'fillForm') {
    ensureRequired(normalizedPayload, 'fields', action);
  }
  if (action === 'uploadFile' && !normalizedPayload.file && !(Array.isArray(normalizedPayload.files) && normalizedPayload.files.length)) {
    throw payloadError('uploadFile requires file or files');
  }
  if (action === 'fetchUrl') {
    ensureNonEmptyString(normalizedPayload, 'url', action);
  }
  if (action === 'askUser') {
    ensureNonEmptyString(normalizedPayload, 'question', action);
  }

  if (requiresConfirmed(action, normalizedPayload) && normalizedPayload.confirmed !== true) {
    throw confirmationError(action);
  }
  if (requiresSensitiveConfirmed(action, normalizedPayload) && normalizedPayload.confirmSensitive !== true) {
    throw sensitiveConfirmationError(action);
  }
}
