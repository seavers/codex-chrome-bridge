import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const NATIVE_HOST_NAME = 'com.codex.chrome_bridge';
export const DEFAULT_SOCKET_PATH = path.join(os.tmpdir(), 'codex-chrome-bridge.sock');

function socketPath() {
  return process.env.CHROME_BRIDGE_SOCKET || DEFAULT_SOCKET_PATH;
}

function socketError(message, code = 'BRIDGE_SOCKET_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function nativeBridgeRequest(request, timeoutMs = 30_000) {
  const target = socketPath();
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const socket = net.createConnection(target);
    const timeout = setTimeout(() => {
      finish(socketError(`Chrome Bridge socket request timed out after ${timeoutMs} ms`, 'BRIDGE_SOCKET_TIMEOUT'));
    }, timeoutMs);

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    }

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      try {
        const response = JSON.parse(line);
        if (response.ok === false) {
          const error = socketError(response.error || 'Chrome Bridge request failed', response.code);
          error.details = response.details;
          finish(error);
          return;
        }
        finish(null, response);
      } catch (error) {
        finish(socketError(`Chrome Bridge returned invalid JSON: ${String(error?.message || error)}`, 'INVALID_BRIDGE_RESPONSE'));
      }
    });
    socket.on('error', (error) => {
      finish(socketError(`Chrome Bridge socket unavailable at ${target}: ${String(error?.message || error)}`, 'BRIDGE_UNAVAILABLE'));
    });
    socket.on('close', () => {
      if (!settled) finish(socketError('Chrome Bridge socket closed before returning a response', 'BRIDGE_DISCONNECTED'));
    });
  });
}

export function bridgeSocketPath() {
  return socketPath();
}
