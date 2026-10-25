import {
  startTraceForTab,
  stopTraceForTab,
  traceEventsForTab,
  traceSummaryForTab,
} from './debugger-session.js';
import { requireConfirmed } from './safety-gates.js';
import { getTargetTab } from './workspace-tabs.js';

export async function traceStart(payload) {
  requireConfirmed(payload, 'traceStart');
  if (payload.includeResponseBodies) requireSensitiveConfirmed(payload, 'traceStart');
  const tab = await getTargetTab(payload);
  return startTraceForTab(tab, payload);
}

export async function traceEvents(payload) {
  const tab = await getTargetTab(payload);
  return traceEventsForTab(tab, payload);
}

export async function traceSummaryCommand(payload) {
  const tab = await getTargetTab(payload);
  return traceSummaryForTab(tab.id, tab);
}

export async function traceStop(payload) {
  const tab = await getTargetTab(payload);
  return stopTraceForTab(tab, payload);
}
