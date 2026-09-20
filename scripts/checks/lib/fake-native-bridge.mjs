import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export function createFakeNativeBridge(handler) {
  const socketPath = path.join(os.tmpdir(), `chrome-bridge-check-${process.pid}-${Math.random().toString(16).slice(2)}.sock`);
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
        if (!line.trim()) continue;

        let request;
        try {
          request = JSON.parse(line);
        } catch (error) {
          socket.end(JSON.stringify({ ok: false, code: 'INVALID_BRIDGE_REQUEST', error: String(error?.message || error) }) + '\n');
          continue;
        }

        let responseBody;
        const response = {
          writeHead() {},
          end(body) {
            if (responseBody !== undefined) return;
            responseBody = typeof body === 'string' ? body : JSON.stringify(body);
            socket.end(`${responseBody}\n`);
          },
        };
        const requestObject = {
          url: request.type === 'health' ? '/health' : '/command',
          method: request.type === 'health' ? 'GET' : 'POST',
          headers: { 'content-type': 'application/json' },
          setEncoding() {},
          async *[Symbol.asyncIterator]() {
            yield JSON.stringify(request.type === 'command' ? request : {});
          },
        };
        Promise.resolve(handler(requestObject, response)).catch((error) => {
          response.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
        });
      }
    });
  });

  const originalListen = server.listen.bind(server);
  const originalClose = server.close.bind(server);
  server.listen = (_port, _host, callback) => {
    try { fs.unlinkSync(socketPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return originalListen(socketPath, callback);
  };
  server.address = () => ({ path: socketPath });
  server.close = (callback) => originalClose(() => {
    try { fs.unlinkSync(socketPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    callback?.();
  });
  return server;
}
