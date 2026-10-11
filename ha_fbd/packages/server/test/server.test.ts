import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
// @ts-ignore – ws is a devDependency used only to fake a Home Assistant server
import { WebSocketServer } from 'ws';
import type { OutputCommand, Program } from '@ha-fbd/engine';
import { HAClient, type HAEntity, type HAStatus } from '../src/ha-client.js';
import { commandToServiceCall } from '../src/commands.js';
import { ProgramHost, checkShape } from '../src/host.js';
import { AutomationManager } from '../src/manager.js';
import { createHttpServer, isAllowedAddress } from '../src/http.js';
import { Store } from '../src/store.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`); await sleep(10); }
}
const tmp = () => mkdtempSync(path.join(tmpdir(), 'fbd-'));

// ───────── command mapping ─────────
test('commandToServiceCall maps switch / value / attribute / service commands', () => {
  const sw = (entityId: string, value: boolean): OutputCommand => ({ kind: 'switch', blockId: 'b', entityId, value });
  assert.deepEqual(commandToServiceCall(sw('light.kitchen', true)), { domain: 'light', service: 'turn_on', data: {}, entityId: 'light.kitchen' });
  assert.equal(commandToServiceCall(sw('cover.garage', true)).service, 'open_cover');
  assert.equal(commandToServiceCall(sw('lock.door', true)).service, 'lock');
  assert.deepEqual(commandToServiceCall(sw('camera.x', true)), { domain: 'homeassistant', service: 'turn_on', data: {}, entityId: 'camera.x' });
  assert.deepEqual(commandToServiceCall({ kind: 'value', blockId: 'b', entityId: 'input_number.t', value: 21.5 }),
    { domain: 'input_number', service: 'set_value', data: { value: 21.5 }, entityId: 'input_number.t' });
  assert.throws(() => commandToServiceCall({ kind: 'value', blockId: 'b', entityId: 'sensor.x', value: 1 }), /not supported/);
  const attr = (entityId: string, attribute: string, value: any): OutputCommand => ({ kind: 'attribute', blockId: 'b', entityId, attribute, value });
  assert.deepEqual(commandToServiceCall(attr('light.a', 'brightness', 128) as any), { domain: 'light', service: 'turn_on', data: { brightness: 128 }, entityId: 'light.a' });
  assert.deepEqual(commandToServiceCall(attr('climate.h', 'hvac_mode', 'heat') as any), { domain: 'climate', service: 'set_hvac_mode', data: { hvac_mode: 'heat' }, entityId: 'climate.h' });
  assert.deepEqual(commandToServiceCall(attr('fan.f', 'oscillating', true) as any).data, { oscillating: true });
  assert.throws(() => commandToServiceCall(attr('light.a', 'bogus', 1) as any), /cannot be set/);
  assert.deepEqual(commandToServiceCall({ kind: 'service', blockId: 'b', service: 'notify.mobile', data: { message: 'hi' } }),
    { domain: 'notify', service: 'mobile', data: { message: 'hi' }, entityId: undefined });
});

// ───────── HA client against a fake HA websocket server ─────────
function fakeHA(token = 'secret') {
  const wss = new WebSocketServer({ port: 0 });
  const calls: any[] = [], fired: any[] = [], subs: { id: number; type: string }[] = [], unsubs: number[] = [];
  const states = [
    { entity_id: 'light.kitchen', state: 'off', attributes: { friendly_name: 'Kitchen' } },
    { entity_id: 'sensor.temp', state: '21.5', attributes: {} },
  ];
  let connections = 0;
  wss.on('connection', (ws: any) => {
    connections++;
    ws.send(JSON.stringify({ type: 'auth_required', ha_version: 'test' }));
    ws.on('message', (raw: Buffer) => {
      const m = JSON.parse(raw.toString());
      const ok = (result: unknown = null) => ws.send(JSON.stringify({ id: m.id, type: 'result', success: true, result }));
      if (m.type === 'auth') ws.send(JSON.stringify({ type: m.access_token === token ? 'auth_ok' : 'auth_invalid', message: 'nope' }));
      else if (m.type === 'subscribe_events') { subs.push({ id: m.id, type: m.event_type }); ok(); }
      else if (m.type === 'unsubscribe_events') { unsubs.push(m.subscription); ok(); }
      else if (m.type === 'get_config') ok({ time_zone: 'Europe/Brussels' });
      else if (m.type === 'config/area_registry/list') ok([{ area_id: 'living_room', name: 'Living room', floor_id: 'ground' }, { area_id: 'kitchen', name: 'Kitchen' }]);
      else if (m.type === 'config/floor_registry/list') ok([{ floor_id: 'upstairs', name: 'Upstairs', level: 1 }, { floor_id: 'ground', name: 'Ground floor', level: 0 }]);
      else if (m.type === 'config/device_registry/list') ok([{ id: 'dev_tv', area_id: 'living_room' }, { id: 'dev_oven', area_id: 'kitchen' }]);
      else if (m.type === 'config/entity_registry/list') ok([
        { entity_id: 'light.sofa', area_id: 'living_room' },                       // entity placed directly in the room
        { entity_id: 'media_player.tv', device_id: 'dev_tv', area_id: null },      // inherits the room of its device
        { entity_id: 'light.moved', device_id: 'dev_tv', area_id: 'kitchen' },     // entity area wins over device area
        { entity_id: 'light.off', area_id: 'living_room', disabled_by: 'user' },   // disabled → not listed
        { entity_id: 'switch.oven', device_id: 'dev_oven' }]);
      else if (m.type === 'get_states') ok(states);
      else if (m.type === 'ping') ws.send(JSON.stringify({ id: m.id, type: 'pong' }));
      else if (m.type === 'fire_event') { fired.push(m); ok(); }
      else if (m.type === 'call_service') {
        calls.push(m);
        ws.send(JSON.stringify(m.domain === 'fail' ? { id: m.id, type: 'result', success: false, error: { code: 'x', message: 'boom' } } : { id: m.id, type: 'result', success: true, result: {} }));
      }
    });
  });
  const push = (entity_id: string, state: string | null) => {
    const ev = { type: 'event', id: 1, event: { event_type: 'state_changed', data: { entity_id, new_state: state === null ? null : { entity_id, state, attributes: {} } } } };
    for (const c of wss.clients) c.send(JSON.stringify(ev));
  };
  const pushEvent = (event_type: string, data: unknown) => {
    for (const s of subs) if (s.type === event_type && !unsubs.includes(s.id)) for (const c of wss.clients) c.send(JSON.stringify({ type: 'event', id: s.id, event: { event_type, data } }));
  };
  return { wss, calls, fired, subs, unsubs, push, pushEvent, url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`, connections: () => connections };
}

test('HAClient: connects, caches states, follows state_changed, calls services', async () => {
  const fake = fakeHA();
  const c = new HAClient({ url: fake.url, token: 'secret', minRetryMs: 30 });
  c.start();
  await waitFor(() => c.status === 'connected', 3000, 'connected');
  assert.equal(c.listEntities().length, 2);
  fake.push('sensor.temp', '30');
  await waitFor(() => c.getEntity('sensor.temp')?.state === '30', 2000, 'state update');
  fake.push('light.kitchen', null);
  await waitFor(() => c.getEntity('light.kitchen') === undefined, 2000, 'entity removal');
  await c.callService('light', 'turn_on', { brightness: 100 }, 'light.kitchen');
  assert.deepEqual(fake.calls[0].target, { entity_id: 'light.kitchen' });
  await assert.rejects(c.callService('fail', 'x'), /boom/);
  c.stop(); fake.wss.close();
});

test('HAClient: event subscriptions follow setEventTypes, events are forwarded, fireEvent works, resubscribes after reconnect', async () => {
  const fake = fakeHA();
  const c = new HAClient({ url: fake.url, token: 'secret', minRetryMs: 30, maxRetryMs: 60 });
  const got: any[] = [];
  c.on('ha_event', (type: string, data: any) => got.push({ type, data }));
  c.setEventTypes(['zha_event']);                       // requested BEFORE connecting
  c.start();
  await waitFor(() => c.status === 'connected');
  await waitFor(() => fake.subs.some(s => s.type === 'zha_event'), 2000, 'subscribe after connect');
  fake.pushEvent('zha_event', { command: 'on' });
  fake.pushEvent('other_event', { x: 1 });              // not subscribed → never delivered
  await waitFor(() => got.length === 1, 2000, 'event');
  assert.deepEqual(got[0], { type: 'zha_event', data: { command: 'on' } });

  c.setEventTypes(['my_event', 'state_changed']);
  await waitFor(() => fake.subs.some(s => s.type === 'my_event') && fake.unsubs.length === 1, 2000, 'subscribe / unsubscribe');
  assert.equal(fake.subs.filter(s => s.type === 'state_changed').length, 1, 'only the cache subscription, none added for state_changed');
  fake.push('sensor.temp', '99');
  await waitFor(() => got.some(g => g.type === 'state_changed'), 2000, 'state_changed forwarded when wanted');

  await c.fireEvent('fbd_alarm', { zone: 'hall' });
  assert.deepEqual([fake.fired[0].event_type, fake.fired[0].event_data], ['fbd_alarm', { zone: 'hall' }]);

  const before = fake.subs.length;
  for (const ws of fake.wss.clients) ws.terminate();
  await waitFor(() => c.status === 'connected' && fake.subs.length > before, 3000, 'resubscribe after reconnect');
  c.stop(); fake.wss.close();
});

test('HAClient: time zone, rooms with their entities (direct and via device), service call with an area target', async () => {
  const fake = fakeHA();
  const c = new HAClient({ url: fake.url, token: 'secret', minRetryMs: 30 });
  c.start();
  await waitFor(() => c.status === 'connected');
  assert.equal(c.timeZone, 'Europe/Brussels');
  const areas = await c.getAreas();
  assert.deepEqual(areas.map(a => a.id), ['kitchen', 'living_room'], 'sorted by name');
  assert.deepEqual(areas.find(a => a.id === 'living_room')!.entities, ['light.sofa', 'media_player.tv']);
  assert.deepEqual(areas.find(a => a.id === 'kitchen')!.entities, ['light.moved', 'switch.oven']);
  assert.equal(areas.find(a => a.id === 'living_room')!.floorId, 'ground'); assert.equal(areas.find(a => a.id === 'kitchen')!.floorId, null);
  assert.deepEqual((await c.getFloors()).map(f => f.id), ['ground', 'upstairs'], 'zones (floors) sorted by level');
  assert.equal(await c.getAreas(), areas, 'cached for a while');
  await c.callService('light', 'turn_off', {}, undefined, { area_id: 'living_room' });
  assert.deepEqual([fake.calls.at(-1).domain, fake.calls.at(-1).target], ['light', { area_id: 'living_room' }]);
  c.stop(); fake.wss.close();
  await assert.rejects(c.getAreas(), /./);
});

test('HAClient: reconnects after the connection drops and clears the cache meanwhile', async () => {
  const fake = fakeHA();
  const c = new HAClient({ url: fake.url, token: 'secret', minRetryMs: 30, maxRetryMs: 60 });
  const seen: HAStatus[] = [];
  c.on('status', (s: HAStatus) => seen.push(s));
  c.start();
  await waitFor(() => c.status === 'connected');
  for (const ws of fake.wss.clients) ws.terminate();
  await waitFor(() => seen.includes('disconnected'), 2000, 'disconnect');
  assert.equal(c.listEntities().length, 0);
  await waitFor(() => c.status === 'connected', 3000, 'reconnect');
  assert.equal(fake.connections(), 2);
  c.stop(); fake.wss.close();
});

test('HAClient: wrong token → auth_failed and no retry storm', async () => {
  const fake = fakeHA('right');
  const c = new HAClient({ url: fake.url, token: 'wrong', minRetryMs: 20 });
  c.start();
  await waitFor(() => c.status === 'auth_failed', 3000, 'auth_failed');
  await sleep(150);
  assert.equal(fake.connections(), 1);
  c.stop(); fake.wss.close();
});

// ───────── hosts / manager with a fake HA ─────────
class FakeHA extends EventEmitter {
  status: HAStatus = 'connected';
  ents = new Map<string, HAEntity>();
  calls: { domain: string; service: string; data: unknown; entityId?: string; target?: Record<string, unknown> }[] = [];
  fired: { type: string; data: unknown }[] = [];
  eventTypes: string[] = [];
  set(entity_id: string, state: string, attributes: Record<string, unknown> = {}) { this.ents.set(entity_id, { entity_id, state, attributes }); }
  getEntity(id: string) { return this.ents.get(id); }
  listEntities() { return [...this.ents.values()]; }
  timeZone = 'UTC';
  async callService(domain: string, service: string, data: Record<string, unknown> = {}, entityId?: string, target?: Record<string, unknown>) { this.calls.push({ domain, service, data, entityId, target }); }
  async getAreas() { return [{ id: 'living_room', name: 'Living room', entities: ['light.sofa', 'media_player.tv'], floorId: 'ground' }]; }
  async getFloors() { return [{ id: 'ground', name: 'Ground floor', level: 0 }]; }
  async fireEvent(type: string, data: Record<string, unknown> = {}) { this.fired.push({ type, data }); }
  setEventTypes(types: Iterable<string>) { this.eventTypes = [...types].sort(); }
}
const notProgram = (name = 'Not'): Program => ({
  version: 1, name, variables: [],
  networks: [{ id: 'n', title: 'n',
    blocks: [{ id: 'i', type: 'ENTITY_IN', params: { entityId: 'input_boolean.a', dataType: 'BOOL' } }, { id: 'n1', type: 'NOT' },
      { id: 'o', type: 'ENTITY_OUT', params: { kind: 'switch', entityId: 'switch.out' } }],
    wires: [{ from: { block: 'i', pin: 'OUT' }, to: { block: 'n1', pin: 'IN' } }, { from: { block: 'n1', pin: 'OUT' }, to: { block: 'o', pin: 'IN' } }] }],
});
const eventProgram = (): Program => ({
  version: 1, name: 'Events', variables: [],
  networks: [{ id: 'n', title: '',
    blocks: [{ id: 'e', type: 'EVENT_IN', params: { eventType: 'button_press', match: { button: 'a' } } },
      { id: 'o', type: 'ENTITY_OUT', params: { kind: 'service', service: 'light.toggle', entityId: 'light.x' } },
      { id: 'f', type: 'EVENT_OUT', params: { eventType: 'fbd_seen', data: { ok: true } } }],
    wires: [{ from: { block: 'e', pin: 'Q' }, to: { block: 'o', pin: 'EN' } }, { from: { block: 'e', pin: 'Q' }, to: { block: 'f', pin: 'IN' } }] }],
});
const mkHost = (ha: FakeHA, store: Store, id = 'a') => new ProgramHost({ id, ha, store, scanMs: 20 });

test('host: deploy runs the program, calls HA on change only, replays outputs on reconnect', async () => {
  const ha = new FakeHA(); ha.set('input_boolean.a', 'off');
  const host = mkHost(ha, new Store(tmp()));
  await host.init();
  assert.deepEqual(await host.deploy(notProgram()), { ok: true });
  await waitFor(() => ha.calls.length >= 1); await sleep(100);
  assert.equal(ha.calls.length, 1);
  assert.deepEqual(ha.calls[0], { domain: 'switch', service: 'turn_on', data: {}, entityId: 'switch.out', target: undefined });
  ha.set('input_boolean.a', 'on');
  await waitFor(() => ha.calls.length === 2);
  assert.equal(ha.calls[1].service, 'turn_off');
  ha.emit('connected');
  await waitFor(() => ha.calls.length === 3);
  assert.equal(ha.calls[2].service, 'turn_off');
  await host.stop();
});

test('host: events reach EVENT_IN for one scan, EVENT_OUT fires events, only while running', async () => {
  const ha = new FakeHA();
  const host = mkHost(ha, new Store(tmp()));
  await host.init();
  ha.emit('ha_event', 'button_press', { button: 'a' });          // not running → dropped
  await host.deploy(eventProgram());
  await sleep(80);
  assert.equal(ha.calls.length, 0, 'event before start must not be replayed');
  assert.deepEqual([...host.eventTypes()], ['button_press']);
  ha.emit('ha_event', 'button_press', { button: 'b' });          // data does not match
  await sleep(80); assert.equal(ha.calls.length, 0);
  ha.emit('ha_event', 'button_press', { button: 'a' });
  await waitFor(() => ha.calls.length === 1, 2000, 'service call from event');
  assert.equal(ha.calls[0].service, 'toggle');
  await waitFor(() => ha.fired.length === 1);
  assert.deepEqual(ha.fired[0], { type: 'fbd_seen', data: { ok: true } });
  await sleep(100); assert.equal(ha.calls.length, 1, 'a single event gives a single pulse');
  await host.stop();
  assert.equal(host.eventTypes().size, 0);
});

test('host: a room command becomes one service call per device kind with an area target', async () => {
  const ha = new FakeHA();
  const host = mkHost(ha, new Store(tmp()));
  await host.init();
  const room: Program = { version: 1, name: 'Room', variables: [], networks: [{ id: 'n', title: '',
    blocks: [{ id: 'c', type: 'CONST', params: { dataType: 'BOOL', value: true } },
      { id: 'r', type: 'RESET', params: { target: 'room', areaId: 'living_room', domains: ['light', 'media_player'] } }],
    wires: [{ from: { block: 'c', pin: 'OUT' }, to: { block: 'r', pin: 'IN' } }] }] };
  await host.deploy(room);
  await waitFor(() => ha.calls.length >= 2, 2000, 'two calls');
  await sleep(100);
  assert.deepEqual(ha.calls.map(c => [c.domain, c.service, c.target]), [['light', 'turn_off', { area_id: 'living_room' }], ['media_player', 'turn_off', { area_id: 'living_room' }]]);
  await host.stop();
});

test('host: TOGGLE on a room switches everything off when something is on, otherwise on', async () => {
  const ha = new FakeHA(); ha.set('input_boolean.btn', 'off'); ha.set('light.sofa', 'off'); ha.set('media_player.tv', 'playing');
  const host = mkHost(ha, new Store(tmp()));
  await host.init();
  const room: Program = { version: 1, name: 'Toggle', variables: [], networks: [{ id: 'n', title: '',
    blocks: [{ id: 'i', type: 'ENTITY_IN', params: { entityId: 'input_boolean.btn', dataType: 'BOOL' } },
      { id: 't', type: 'TOGGLE', params: { target: 'room', areaId: 'living_room', domains: ['light', 'media_player'] } }],
    wires: [{ from: { block: 'i', pin: 'OUT' }, to: { block: 't', pin: 'IN' } }] }] };
  await host.deploy(room);
  const press = async (n: number) => { ha.set('input_boolean.btn', 'on'); await waitFor(() => ha.calls.length >= n, 2000, `${n} calls`); ha.set('input_boolean.btn', 'off'); await sleep(80); };
  await press(2);
  assert.deepEqual(ha.calls.map(c => [c.domain, c.service, c.target]), [['light', 'turn_off', { area_id: 'living_room' }], ['media_player', 'turn_off', { area_id: 'living_room' }]], 'the TV was on');
  ha.set('media_player.tv', 'off');
  await press(4);
  assert.deepEqual(ha.calls.slice(2).map(c => c.service), ['turn_on', 'turn_on'], 'everything was off');
  await host.stop();
});

test('host: a zone (floor) command targets floor_id', async () => {
  const ha = new FakeHA();
  const host = mkHost(ha, new Store(tmp()));
  await host.init();
  const zone: Program = { version: 1, name: 'Zone', variables: [], networks: [{ id: 'n', title: '',
    blocks: [{ id: 'c', type: 'CONST', params: { dataType: 'BOOL', value: true } },
      { id: 'r', type: 'RESET', params: { target: 'room', floorId: 'ground', domains: ['light'] } }],
    wires: [{ from: { block: 'c', pin: 'OUT' }, to: { block: 'r', pin: 'IN' } }] }] };
  await host.deploy(zone);
  await waitFor(() => ha.calls.length >= 1, 2000, 'one call');
  assert.deepEqual(ha.calls.map(c => [c.domain, c.service, c.target]), [['light', 'turn_off', { floor_id: 'ground' }]]);
  await host.stop();
});

test('host: time-of-day blocks use the Home Assistant time zone', async () => {
  const ha = new FakeHA(); ha.timeZone = 'Pacific/Kiritimati';       // UTC+14: never the same hour as the machine running the test
  const host = mkHost(ha, new Store(tmp()));
  await host.init();
  const now = new Date(Date.now() + 14 * 3_600_000), hh = String(now.getUTCHours()).padStart(2, '0');
  await host.deploy({ version: 1, name: 'Tod', variables: [], networks: [{ id: 'n', title: '', blocks: [{ id: 't', type: 'TIME_OF_DAY', params: { start: `${hh}:00`, end: `${hh}:59` } }], wires: [] }] });
  const frames: any[] = []; host.on('scan', f => frames.push(f)); await sleep(100);
  const ms = frames.at(-1).values['t.NOW'] as number;
  assert.ok(Math.abs(ms - ((now.getUTCHours() * 60 + now.getUTCMinutes()) * 60_000)) < 120_000, `NOW should be Kiritimati local time, got ${ms}`);
  await host.stop();
});

test('host: refuses invalid programs and keeps the old one running', async () => {
  const ha = new FakeHA();
  const host = mkHost(ha, new Store(tmp()));
  await host.init(); await host.deploy(notProgram());
  const bad = notProgram(); bad.networks[0].blocks.push({ id: 'x', type: 'NOPE' });
  const r = await host.deploy(bad);
  assert.equal(r.ok, false);
  assert.match(JSON.stringify((r as any).errors), /Unknown block type/);
  assert.equal(host.running, true);
  assert.ok(checkShape({ version: 2 }));
  await host.stop();
});

test('host: retained variables survive; shutdown() keeps the running flag, stop() clears it', async () => {
  const dir = tmp();
  const counter: Program = {
    version: 1, name: 'Counter', variables: [{ name: 'cnt', type: 'INT', kind: 'retain', init: 0 }],
    networks: [{ id: 'n', title: 'n',
      blocks: [{ id: 'r', type: 'VAR_READ', params: { name: 'cnt', varType: 'INT' } }, { id: 'a', type: 'ADD', params: { IN2: 1 } },
        { id: 'w', type: 'VAR_WRITE', params: { name: 'cnt', varType: 'INT' } }],
      wires: [{ from: { block: 'r', pin: 'OUT' }, to: { block: 'a', pin: 'IN1' } }, { from: { block: 'a', pin: 'OUT' }, to: { block: 'w', pin: 'IN' } }] }],
  };
  const h1 = mkHost(new FakeHA(), new Store(dir));
  await h1.init(); await h1.deploy(counter);
  await sleep(150);
  await h1.shutdown();                                       // add-on shutting down while running
  const st = await new Store(dir).loadState('a');
  assert.equal(st.running, true, 'running flag kept for the next start');
  assert.ok((st.retained.cnt as number) > 3);

  const h2 = mkHost(new FakeHA(), new Store(dir));
  await h2.init();
  assert.equal(h2.running, true, 'auto-started');
  await sleep(100);
  const frames: any[] = []; h2.on('scan', f => frames.push(f)); await sleep(60);
  assert.ok((frames.at(-1).variables.cnt as number) > (st.retained.cnt as number), 'continued from the retained value');
  await h2.stop();
  assert.equal((await new Store(dir).loadState('a')).running, false, 'explicit stop is remembered');
});

test('manager: create, list, duplicate, remove, id safety, per-automation isolation', async () => {
  const ha = new FakeHA(); const store = new Store(tmp());
  const m = new AutomationManager({ ha, store, scanMs: 20 });
  await m.init();
  assert.equal(m.size, 0);
  const a = await m.create('Hall Light!'); const b = await m.create('Hall Light!');
  assert.deepEqual([a.id, b.id], ['hall-light', 'hall-light-2']);
  assert.equal((await m.create('???')).id, 'automation');
  await a.deploy(notProgram('Hall Light!'));
  const list = m.list();
  assert.equal(list.length, 3);
  assert.deepEqual(list.find(x => x.id === 'hall-light'), { ...list.find(x => x.id === 'hall-light')!, running: true, blocks: 3, name: 'Hall Light!', problems: 0 });
  assert.equal(list.find(x => x.id === 'hall-light-2')!.running, false);

  const copy = await m.duplicate('hall-light');
  assert.equal(copy!.name, 'Hall Light! (copy)'); assert.equal(copy!.running, false); assert.equal(copy!.program!.networks[0].blocks.length, 3);
  assert.ok(await m.remove('hall-light-2'));
  assert.equal(m.get('hall-light-2'), undefined);
  assert.deepEqual(await store.listIds(), ['automation', 'hall-light', 'hall-light-copy']);
  assert.equal(await m.remove('nope'), false);
  await assert.rejects(store.loadProgram('../etc/passwd'), /Invalid automation id/);

  const m2 = new AutomationManager({ ha, store, scanMs: 20 });   // restart: running state restored per automation
  await m2.init();
  assert.equal(m2.get('hall-light')!.running, true); assert.equal(m2.get('hall-light-copy')!.running, false);
  await m.stopAll(); await m2.stopAll();
});

test('manager: unions event types of running automations and listens to deletes', async () => {
  const ha = new FakeHA(); const m = new AutomationManager({ ha, store: new Store(tmp()), scanMs: 20 });
  await m.init();
  const e = await m.create('Events'); await e.deploy(eventProgram());
  assert.deepEqual(ha.eventTypes, ['button_press']);
  await e.stop(); assert.deepEqual(ha.eventTypes, []);
  e.start(); assert.deepEqual(ha.eventTypes, ['button_press']);
  await m.remove('events'); assert.deepEqual(ha.eventTypes, []);
  assert.equal(ha.listenerCount('ha_event'), 0, 'deleted automations stop listening');
  await m.stopAll();
});

test('manager: migrates the single program of version 0.1/0.2', async () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 'program.json'), JSON.stringify(notProgram('ignored') && { ...notProgram(), name: undefined }));
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ running: true, retained: {} }));
  const ha = new FakeHA(); ha.set('input_boolean.a', 'off');
  const m = new AutomationManager({ ha, store: new Store(dir), scanMs: 20 });
  await m.init();
  assert.equal(m.size, 1);
  const host = m.get('default')!;
  assert.equal(host.name, 'My first automation'); assert.equal(host.running, true);
  assert.ok(existsSync(path.join(dir, 'program.json.migrated')) && !existsSync(path.join(dir, 'program.json')));
  await waitFor(() => ha.calls.length > 0);
  await m.stopAll();
  const again = new AutomationManager({ ha, store: new Store(dir), scanMs: 20 });   // second start: no second migration
  await again.init(); assert.equal(again.size, 1); await again.stopAll();
});

// ───────── HTTP API ─────────
test('isAllowedAddress only accepts the Supervisor proxy and localhost', () => {
  assert.ok(isAllowedAddress('172.30.32.2')); assert.ok(isAllowedAddress('::ffff:172.30.32.2')); assert.ok(isAllowedAddress('127.0.0.1'));
  assert.ok(!isAllowedAddress('192.168.1.50')); assert.ok(!isAllowedAddress(undefined));
});

test('HTTP API: automations CRUD, validate / deploy / start / stop, SSE watch, static files', async () => {
  const ha = new FakeHA(); ha.set('input_boolean.a', 'off'); ha.set('light.x', 'on', { friendly_name: 'Light X' });
  const m = new AutomationManager({ ha, store: new Store(tmp()), scanMs: 20 });
  await m.init();
  const pub = tmp(); writeFileSync(path.join(pub, 'index.html'), '<title>FBD Automation</title>'); mkdirSync(path.join(pub, 'assets'));
  writeFileSync(path.join(pub, 'assets', 'app.js'), 'console.log(1)');
  const server = createHttpServer({ manager: m, publicDir: pub });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const j = async (p: string, init?: RequestInit) => { const r = await fetch(base + p, init); return { status: r.status, body: await r.json() as any }; };
  const post = (p: string, body?: unknown) => j(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const put = (p: string, body: unknown) => j(p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  assert.deepEqual((await j('/api/status')).body, { ha: 'connected', entities: 2, automations: { total: 0, running: 0 } });
  assert.ok((await j('/api/blocks')).body.find((b: any) => b.type === 'EVENT_IN').doc.summary);
  assert.deepEqual((await j('/api/areas')).body, { areas: [{ id: 'living_room', name: 'Living room', entities: ['light.sofa', 'media_player.tv'], floorId: 'ground' }], floors: [{ id: 'ground', name: 'Ground floor', level: 0 }] });
  assert.deepEqual((await j('/api/entities')).body.find((e: any) => e.entity_id === 'light.x'), { entity_id: 'light.x', state: 'on', name: 'Light X' });

  const created = await post('/api/automations', { name: 'Test one' });
  assert.equal(created.status, 201); const id = created.body.id; assert.equal(id, 'test-one');
  assert.equal((await j(`/api/automations/${id}`)).body.name, 'Test one');
  assert.equal((await j('/api/automations')).body[0].name, 'Test one');

  const bad = notProgram(); bad.networks[0].wires.push({ from: { block: 'o', pin: 'IN' }, to: { block: 'n1', pin: 'IN' } });
  assert.equal((await post(`/api/automations/${id}/validate`, bad)).body.ok, false);
  assert.equal((await post(`/api/automations/${id}/deploy`, bad)).status, 422);
  assert.equal((await put(`/api/automations/${id}`, { nonsense: true })).status, 400);
  const saved = await put(`/api/automations/${id}`, bad);                      // drafts with errors may be saved
  assert.equal(saved.status, 200); assert.equal(saved.body.ok, false);
  assert.equal((await j(`/api/automations/${id}`)).body.networks[0].wires.length, 3);

  assert.deepEqual((await post(`/api/automations/${id}/deploy`, notProgram('Test one'))).body, { ok: true });
  await waitFor(() => ha.calls.length >= 1);
  assert.equal((await j(`/api/automations/${id}/status`)).body.running, true);
  assert.deepEqual((await j('/api/status')).body.automations, { total: 1, running: 1 });

  const res = await fetch(`${base}/api/automations/${id}/watch`);
  const reader = res.body!.getReader(); let text = ''; const dec = new TextDecoder();
  while (!text.includes('data: ')) {
    const c: any = await Promise.race([reader.read(), sleep(2000).then(() => ({ done: true }))]);
    if (c.done) break; text += dec.decode(c.value);
  }
  assert.match(text, /"values"/); await reader.cancel().catch(() => {});

  assert.equal((await post(`/api/automations/${id}/stop`)).body.ok, true);
  assert.equal((await post(`/api/automations/${id}/start`)).body.ok, true);
  const dup = await post(`/api/automations/${id}/duplicate`); assert.equal(dup.status, 201);
  assert.equal((await j('/api/automations')).body.length, 2);
  // export → import round trip: imports become new, stopped automations
  const one = await fetch(`${base}/api/export?id=${id}`);
  assert.match(one.headers.get('content-disposition') ?? '', /attachment; filename="test-one\.fbd\.json"/);
  const oneFile = await one.json() as any;
  assert.equal(oneFile.format, 'ha-fbd-export'); assert.equal(oneFile.automations.length, 1);
  assert.deepEqual(oneFile.automations[0], (await j(`/api/automations/${id}`)).body);
  const all = (await j('/api/export')).body; assert.equal(all.automations.length, 2);
  const imp = await post('/api/import', all); assert.equal(imp.status, 201);
  assert.deepEqual(imp.body.imported.map((a: any) => a.id), ['test-one-2', 'test-one-copy-2']);
  assert.equal((await j('/api/automations')).body.length, 4);
  assert.equal((await j('/api/automations/test-one-2/status')).body.running, false);
  assert.deepEqual((await j('/api/automations/test-one-2')).body, oneFile.automations[0]);
  assert.equal((await post('/api/import', oneFile.automations[0])).body.imported[0].id, 'test-one-3', 'a bare program is accepted too');
  assert.equal((await post('/api/import', { format: 'ha-fbd-export', automations: [oneFile.automations[0], { nonsense: true }] })).status, 400);
  assert.equal((await post('/api/import', { format: 'ha-fbd-export', automations: [] })).status, 400);
  assert.equal((await j('/api/automations')).body.length, 5, 'a file with an invalid automation imports nothing');
  assert.equal((await j('/api/export?id=nope')).status, 404);

  assert.equal((await j('/api/automations/nope')).status, 404);
  assert.equal((await j('/api/automations/..%2fx')).status, 400);
  assert.equal((await j(`/api/automations/${id}`, { method: 'DELETE' })).body.ok, true);
  assert.equal((await j(`/api/automations/${id}`)).status, 404);

  const page = await fetch(base + '/'); assert.equal(page.status, 200); assert.match(await page.text(), /FBD Automation/);
  assert.equal((await fetch(base + '/assets/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(base + '/..%2f..%2fpackage.json')).status === 200, false);
  await m.stopAll(); server.close(); server.closeAllConnections?.();
});
