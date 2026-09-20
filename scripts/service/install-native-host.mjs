#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hostName = 'com.codex.chrome_bridge';
const extensionId = process.argv[2] || process.env.CHROME_BRIDGE_EXTENSION_ID;
if (!extensionId) {
  throw new Error('Usage: npm run install:native-host -- <unpacked Chrome extension id>');
}

const binDir = path.join(os.homedir(), '.local/bin');
const hostPath = path.join(binDir, 'codex-chrome-bridge-native-host');
const manifestDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
const manifestPath = path.join(manifestDir, `${hostName}.json`);
const wrapper = `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(rootDir, 'native/host.mjs'))}\n`;
const manifest = {
  name: hostName,
  description: 'Codex Chrome Bridge Native Messaging Host',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
};

await fs.mkdir(binDir, { recursive: true });
await fs.mkdir(manifestDir, { recursive: true });
await fs.writeFile(hostPath, wrapper, { mode: 0o755 });
await fs.chmod(hostPath, 0o755);
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`Installed Native Messaging Host: ${hostName}\n`);
process.stdout.write(`Manifest: ${manifestPath}\n`);
process.stdout.write(`Host: ${hostPath}\n`);
