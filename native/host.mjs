#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import { BRIDGE_VERSION } from '../shared/command-registry.mjs';
import { DEFAULT_SOCKET_PATH } from '../shared/native-bridge.mjs';

const socketPath = process.env.CHROME_BRIDGE_SOCKET || DEFAULT_SOCKET_PATH;
const pending = new Map();
let extensionInfo = null;
let extensionConnected = false;
let extensionRequestId = 0;

function log(message, details = undefined) {
  process.stderr.write(`[chrome-bridge-native] ${message}${details ? ` ${JSON.stringify(details)}` : ''}\n`);
}

function sendNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function sendResponse(socket, response) {
  socket.write(`${JSON.stringify(response)}\n`);
}

function rejectPending(error) {
  for (const entry of pending.values()) {
    sendResponse(entry.socket, { ok: false, code: error.code || 'EXTENSION_NOT_CONNECTED', error: error.message });
  }
  pending.clear();
}

function handleExtensionMessage(message) {
  if (message?.type === 'hello') {
    extensionInfo = message.info || {};
    extensionConnected = true;
    log('extension connected', { profileId: extensionInfo.profileId, extensionId: extensionInfo.extensionId });
    return;
  }

  if (!message?.id) return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  sendResponse(entry.socket, message.ok === false
    ? { ok: false, code: message.code, error: message.error, details: message.details }
    : { ok: true, result: message.result, info: message.info });
}

function requestExtension(socket, request) {
  if (!extensionConnected) {
    sendResponse(socket, { ok: false, code: 'EXTENSION_NOT_CONNECTED', error: 'Chrome extension is not connected to Native Messaging Host' });
    return;
  }
  const id = `native-${process.pid}-${extensionRequestId += 1}`;
  pending.set(id, { socket });
  sendNativeMessage({ id, action: request.action, payload: request.payload || {} });
}

function handleSocketRequest(socket, request) {
  if (request?.type === 'health') {
    sendResponse(socket, {
      ok: true,
      bridge: { version: BRIDGE_VERSION },
      transport: 'native-messaging+unix-socket',
      socketPath,
      extension: extensionConnected ? { connected: true, info: extensionInfo } : { connected: false },
    });
    return;
  }
  if (request?.type === 'command' && typeof request.action === 'string') {
    requestExtension(socket, request);
    return;
  }
  sendResponse(socket, { ok: false, code: 'INVALID_BRIDGE_REQUEST', error: 'Expected a health or command request' });
}

function startSocketServer() {
  try { fs.unlinkSync(socketPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        try { handleSocketRequest(socket, JSON.parse(line)); }
        catch (error) { sendResponse(socket, { ok: false, code: 'INVALID_BRIDGE_REQUEST', error: String(error?.message || error) }); }
      }
    });
    socket.on('close', () => {
      for (const [id, entry] of pending.entries()) {
        if (entry.socket === socket) pending.delete(id);
      }
    });
  });
  server.on('error', (error) => log('socket server error', { error: String(error?.message || error) }));
  server.listen(socketPath, () => log('socket ready', { socketPath }));
  return server;
}

let nativeBuffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  nativeBuffer = Buffer.concat([nativeBuffer, chunk]);
  while (nativeBuffer.length >= 4) {
    const length = nativeBuffer.readUInt32LE(0);
    if (nativeBuffer.length < length + 4) return;
    const body = nativeBuffer.subarray(4, length + 4);
    nativeBuffer = nativeBuffer.subarray(length + 4);
    try { handleExtensionMessage(JSON.parse(body.toString('utf8'))); }
    catch (error) { log('invalid native message', { error: String(error?.message || error) }); }
  }
});
process.stdin.on('end', () => {
  extensionConnected = false;
  rejectPending(Object.assign(new Error('Chrome extension disconnected from Native Messaging Host'), { code: 'EXTENSION_NOT_CONNECTED' }));
  process.exit(0);
});

const socketServer = startSocketServer();
process.on('exit', () => { try { fs.unlinkSync(socketPath); } catch {} });
process.on('SIGTERM', () => socketServer.close(() => process.exit(0)));
