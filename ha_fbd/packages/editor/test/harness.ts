// Test harness: fake HA websocket  →  real HAClient + ProgramHost + HTTP server (serving the built editor).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
// @ts-ignore
import { WebSocketServer } from 'ws';
import { HAClient } from '../../server/src/ha-client';
import { AutomationManager } from '../../server/src/manager';
import { createHttpServer } from '../../server/src/http';
import { Store } from '../../server/src/store';


export async function startHarness(initialStates?: any[]) {
// ───────── fake Home Assistant ─────────
const states: any[] = initialStates ?? [
  { entity_id: 'binary_sensor.motion', state: 'off', attributes: { friendly_name: 'Hall motion' } },
  { entity_id: 'light.living', state: 'off', attributes: { friendly_name: 'Living room light' } },
  { entity_id: 'sensor.temp', state: '21.5', attributes: { friendly_name: 'Temperature' } },
];
const calls: any[] = [];
const fired: any[] = [];
const subs: { id: number; type: string }[] = [];
const wss = new WebSocketServer({ port: 0 });
wss.on('connection', (ws: any) => {
  ws.send(JSON.stringify({ type: 'auth_required' }));
  ws.on('message', (raw: Buffer) => {
    const m = JSON.parse(raw.toString());
    const ok = (result: unknown) => ws.send(JSON.stringify({ id: m.id, type: 'result', success: true, result }));
    if (m.type === 'auth') ws.send(JSON.stringify({ type: 'auth_ok' }));
    else if (m.type === 'subscribe_events') { subs.push({ id: m.id, type: m.event_type }); ok(null); }
    else if (m.type === 'unsubscribe_events') ok(null);
    else if (m.type === 'fire_event') { fired.push(m); ok({}); }
    else if (m.type === 'get_config') ok({ time_zone: 'Europe/Brussels' });
    else if (m.type === 'config/area_registry/list') ok([{ area_id: 'living_room', name: 'Living room', floor_id: 'ground_floor' }, { area_id: 'kitchen', name: 'Kitchen' }]);
    else if (m.type === 'config/floor_registry/list') ok([{ floor_id: 'ground_floor', name: 'Ground floor', level: 0 }]);
    else if (m.type === 'config/device_registry/list') ok([{ id: 'dev_tv', area_id: 'living_room' }]);
    else if (m.type === 'config/entity_registry/list') ok([
      { entity_id: 'light.sofa', area_id: 'living_room' }, { entity_id: 'media_player.tv', device_id: 'dev_tv' },
      { entity_id: 'switch.lamp', area_id: 'living_room' }, { entity_id: 'light.stove', area_id: 'kitchen' }]);
    else if (m.type === 'get_states') ok(states);
    else if (m.type === 'ping') ws.send(JSON.stringify({ id: m.id, type: 'pong' }));
    else if (m.type === 'call_service') { calls.push(m); ok({}); }
  });
});
const pushState = (entity_id: string, state: string) => {
  const s = states.find(x => x.entity_id === entity_id); s.state = state;
  for (const c of wss.clients) c.send(JSON.stringify({ type: 'event', id: 1, event: { event_type: 'state_changed', data: { entity_id, new_state: s } } }));
};

// ───────── real server ─────────
const pushEvent = (event_type: string, data: unknown) => {
  for (const sub of subs) if (sub.type === event_type) for (const c of wss.clients) c.send(JSON.stringify({ type: 'event', id: sub.id, event: { event_type, data } }));
};
const ha = new HAClient({ url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, token: 't', minRetryMs: 50 });
const dataDir = mkdtempSync(path.join(tmpdir(), 'fbd-e2e-'));
const manager = new AutomationManager({ ha, store: new Store(dataDir), scanMs: 50 });
const server = createHttpServer({ manager, publicDir: path.resolve(import.meta.dirname, '../../server/public') });
ha.start(); await manager.init();
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;


async function stop() { await manager.stopAll(); ha.stop(); server.close(); server.closeAllConnections?.(); wss.close(); }
return { base, calls, fired, states, pushState, pushEvent, manager, ha, stop };
}
