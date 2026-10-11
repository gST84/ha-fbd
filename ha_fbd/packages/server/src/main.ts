import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAClient } from './ha-client.js';
import { AutomationManager } from './manager.js';
import { createHttpServer } from './http.js';
import { createLogger, type Level } from './log.js';
import { Store } from './store.js';

const dataDir = process.env.DATA_DIR ?? './data';

// Add-on options (config.yaml "options") are written by the Supervisor to /data/options.json.
let options: { scan_ms?: number; write_on_first_scan?: boolean; log_level?: Level } = {};
try { options = JSON.parse(readFileSync(path.join(dataDir, 'options.json'), 'utf8')); } catch { /* running outside HA */ }

const log = createLogger(options.log_level ?? (process.env.LOG_LEVEL as Level) ?? 'info');

// Inside the add-on: Supervisor proxy.  On your PC while developing: HA_URL + HA_TOKEN (long-lived access token).
let haUrl: string, haToken: string;
if (process.env.SUPERVISOR_TOKEN) {
  haUrl = 'ws://supervisor/core/websocket';
  haToken = process.env.SUPERVISOR_TOKEN;
} else if (process.env.HA_URL && process.env.HA_TOKEN) {
  haUrl = process.env.HA_URL.replace(/^http/, 'ws').replace(/\/+$/, '') + '/api/websocket';
  haToken = process.env.HA_TOKEN;
} else {
  log.error('No Home Assistant credentials: set SUPERVISOR_TOKEN (add-on) or HA_URL and HA_TOKEN (development).');
  process.exit(1);
}

const ha = new HAClient({ url: haUrl, token: haToken, log });
const manager = new AutomationManager({
  ha, store: new Store(dataDir), log,
  scanMs: options.scan_ms ?? Number(process.env.SCAN_MS ?? 100),
  writeOnFirstScan: options.write_on_first_scan ?? true,
});

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
const server = createHttpServer({ manager, publicDir, ingressOnly: process.env.INGRESS_ONLY === '1' });
const port = Number(process.env.PORT ?? 8099);

ha.start();
await manager.init();
server.listen(port, '0.0.0.0', () => log.info(`FBD server listening on :${port} (scan ${options.scan_ms ?? 100} ms)`));

const shutdown = async () => {
  log.info('Shutting down');
  await manager.stopAll();      // keeps each automation's "running" flag, so they restart with the add-on
  ha.stop();
  server.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
