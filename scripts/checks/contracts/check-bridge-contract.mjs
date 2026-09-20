#!/usr/bin/env node
import { createFakeNativeBridge } from '../lib/fake-native-bridge.mjs';
import { nativeBridgeCommand, nativeBridgeHealth } from '../../../shared/native-bridge.mjs';

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

const bridge = createFakeNativeBridge(async (req, res) => {
  if (req.url === '/health') {
    res.end(JSON.stringify({ ok: true, transport: 'native-messaging+unix-socket', bridge: { version: 'test' }, extension: { connected: true } }));
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  if (request.action === 'fail') {
    res.end(JSON.stringify({ ok: false, code: 'EXTENSION_COMMAND_FAILED', error: 'expected failure', details: { action: request.action } }));
    return;
  }
  res.end(JSON.stringify({ ok: true, result: { action: request.action, payload: request.payload } }));
});

await new Promise((resolve, reject) => {
  bridge.once('error', reject);
  bridge.listen(0, '127.0.0.1', resolve);
});
process.env.CHROME_BRIDGE_SOCKET = bridge.address().path;
let socketPath = bridge.address().path;

try {
  const health = await nativeBridgeHealth();
  check(health.transport === 'native-messaging+unix-socket', 'native health must report Unix Socket transport');
  check(health.extension.connected === true, 'native health must expose extension state');

  const result = await nativeBridgeCommand('text', { tabId: 11 });
  check(result.result?.action === 'text', 'native command must return the extension result envelope');
  check(result.result?.payload?.tabId === 11, 'native command must preserve payload');

  await nativeBridgeCommand('fail').then(
    () => check(false, 'native command errors must reject'),
    (error) => check(error.code === 'EXTENSION_COMMAND_FAILED', 'native command error must preserve code'),
  );

  check(typeof socketPath === 'string' && socketPath.length > 0, 'native contract fixture must expose a socket path');
} finally {
  await new Promise((resolve) => bridge.close(resolve));
}

process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, transport: 'native-messaging+unix-socket', socketPath, checks: 5, failures }, null, 2)}\n`);
if (failures.length) process.exit(1);
