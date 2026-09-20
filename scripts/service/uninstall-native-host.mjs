#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const hostName = 'com.codex.chrome_bridge';
const files = [
  path.join(os.homedir(), '.local/bin/codex-chrome-bridge-native-host'),
  path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts', `${hostName}.json`),
];
for (const file of files) await fs.rm(file, { force: true });
process.stdout.write(`Uninstalled Native Messaging Host: ${hostName}\n`);
