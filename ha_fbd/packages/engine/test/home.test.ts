import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, clockInfo, compileProgram, listBlocks, registry, type BlockInst, type IOAdapter, type Wire } from '../src/index.js';

const io: IOAdapter = { getEntity: () => undefined };
const B = (id: string, type: string, params: Record<string, unknown> = {}): BlockInst => ({ id, type, params });
const w = (from: string, to: string): Wire => { const [fb, fp] = from.split('.'), [tb, tp] = to.split('.'); return { from: { block: fb, pin: fp }, to: { block: tb, pin: tp } }; };
const prog = (blocks: BlockInst[], wires: Wire[] = []) => ({ version: 1 as const, variables: [], networks: [{ id: 'n', title: '', blocks, wires }] });

/** Run one scan at a given UTC instant, evaluated in a time zone. */
const at = (iso: string, params: Record<string, unknown>, timeZone = 'UTC') => {
  const rt = new Runtime(prog([B('t', 'TIME_OF_DAY', params)]), { io, clock: () => new Date(iso), timeZone });
  return rt.scan().values;
};

test('clockInfo: time zones, midnight and weekday', () => {
  assert.deepEqual(clockInfo(new Date('2026-10-12T23:30:15Z'), 'UTC'), { msOfDay: ((23 * 60 + 30) * 60 + 15) * 1000, weekday: 1 });   // Monday
  const be = clockInfo(new Date('2026-10-12T23:30:00Z'), 'Europe/Brussels');                                                   // CEST = UTC+2 → Tuesday 01:30
  assert.deepEqual([be.msOfDay, be.weekday], [(1 * 60 + 30) * 60_000, 2]);
  assert.equal(clockInfo(new Date('2026-01-04T12:00:00Z'), 'Not/AZone').weekday, 7, 'unknown zone falls back instead of throwing');   // Sunday
  assert.equal(clockInfo(new Date('2026-10-12T00:00:00Z'), 'UTC').msOfDay, 0);
});

test('TIME_OF_DAY: normal window, outputs NOW and DAY', () => {
  const p = { start: '08:00', end: '17:30' };
  assert.equal(at('2026-10-12T07:59:59Z', p)['t.Q'], false);
  assert.equal(at('2026-10-12T08:00:00Z', p)['t.Q'], true, 'start is inclusive');
  assert.equal(at('2026-10-12T17:29:59Z', p)['t.Q'], true);
  assert.equal(at('2026-10-12T17:30:00Z', p)['t.Q'], false, 'end is exclusive');
  const v = at('2026-10-12T09:15:00Z', p);
  assert.equal(v['t.NOW'], (9 * 60 + 15) * 60_000); assert.equal(v['t.DAY'], 1);
});

test('TIME_OF_DAY: a window past midnight, and the Home Assistant time zone is used', () => {
  const p = { start: '22:00', end: '06:00' };
  for (const [iso, want] of [['2026-10-12T21:59:00Z', false], ['2026-10-12T22:00:00Z', true], ['2026-10-13T03:00:00Z', true], ['2026-10-13T05:59:00Z', true], ['2026-10-13T06:00:00Z', false], ['2026-10-13T12:00:00Z', false]] as const) {
    assert.equal(at(iso, p)['t.Q'], want, iso);
  }
  assert.equal(at('2026-10-12T20:30:00Z', p, 'Europe/Brussels')['t.Q'], true, '20:30Z is 22:30 in Brussels (summer time)');
  assert.equal(at('2026-10-12T20:30:00Z', p, 'UTC')['t.Q'], false);
});

test('TIME_OF_DAY: start = end is all day; weekdays refer to the day a night window STARTED', () => {
  assert.equal(at('2026-10-12T04:00:00Z', { start: '00:00', end: '00:00' })['t.Q'], true);
  assert.equal(at('2026-10-12T04:00:00Z', { start: '09:00', end: '09:00', days: [2] })['t.Q'], false, 'Monday is not in [Tuesday]');
  const night = { start: '22:00', end: '06:00', days: [5] };                       // Fridays
  assert.equal(at('2026-10-16T23:00:00Z', night)['t.Q'], true, 'Friday 23:00');
  assert.equal(at('2026-10-17T03:00:00Z', night)['t.Q'], true, 'Saturday 03:00 still belongs to Friday\'s night');
  assert.equal(at('2026-10-16T03:00:00Z', night)['t.Q'], false, 'Friday 03:00 belongs to Thursday\'s night');
  assert.equal(at('2026-10-17T23:00:00Z', night)['t.Q'], false, 'Saturday 23:00');
  assert.equal(at('2026-10-12T03:00:00Z', { start: '22:00', end: '06:00', days: [7] })['t.Q'], true, 'Monday 03:00 ← Sunday night');
});

test('TIME_OF_DAY: validation and default (no params → all day)', () => {
  const err = (p: Record<string, unknown>) => compileProgram(prog([B('t', 'TIME_OF_DAY', p)])).errors.map(e => e.message).join();
  assert.equal(err({}), ''); assert.equal(err({ start: '7:05', end: '23:59', days: [1, 2] }), '');
  assert.match(err({ start: '25:00' }), /start/); assert.match(err({ end: 'noon' }), /end/); assert.match(err({ days: [0, 8] }), /days/);
  assert.equal(at('2026-10-12T12:00:00Z', {})['t.Q'], true);
});

test('SET / RESET with target room: on/off the whole area on a rising edge', () => {
  const state = { on: false };
  const input: IOAdapter = { getEntity: () => ({ state: state.on ? 'on' : 'off', attributes: {} }) };
  const mk = (type: string) => new Runtime(prog([B('i', 'ENTITY_IN', { entityId: 'input_boolean.bye', dataType: 'BOOL' }), B('r', type, { target: 'room', areaId: 'living_room', domains: ['light', 'media_player'] })], [w('i.OUT', 'r.IN')]), { io: input });
  const reset = mk('RESET'), set = mk('SET');
  reset.scan(); set.scan(); state.on = true;
  assert.deepEqual(reset.scan().commands, [{ kind: 'area', blockId: 'r', areaId: 'living_room', domains: ['light', 'media_player'], action: 'turn_off' }]);
  assert.deepEqual(set.scan().commands, [{ kind: 'area', blockId: 'r', areaId: 'living_room', domains: ['light', 'media_player'], action: 'turn_on' }]);
  assert.deepEqual(reset.scan().commands, [], 'held TRUE does not repeat');
  const err = (type: string, p: Record<string, unknown>) => compileProgram(prog([B('r', type, { target: 'room', ...p })])).errors.map(e => e.message).join();
  assert.match(err('SET', {}), /pick the room/); assert.match(err('RESET', { areaId: 'a', domains: [] }), /at least one/);
  assert.equal(err('RESET', { areaId: 'kitchen' }), '');
  const quiet = new Runtime(prog([B('c', 'CONST', { dataType: 'BOOL', value: true }), B('r', 'SET', { target: 'room', areaId: 'hall' })], [w('c.OUT', 'r.IN')]), { io, writeOnFirstScan: false });
  assert.deepEqual(quiet.scan().commands, [], 'respects writeOnFirstScan = false');
});

test('SET / RESET with a zone (floor): the command targets floorId and validates', () => {
  const run = (type: string, params: Record<string, unknown>) =>
    new Runtime(prog([B('c', 'CONST', { dataType: 'BOOL', value: true }), B('r', type, { target: 'room', ...params })], [w('c.OUT', 'r.IN')]), { io }).scan().commands;
  assert.deepEqual(run('RESET', { floorId: 'ground_floor', domains: ['light'] }), [{ kind: 'area', blockId: 'r', floorId: 'ground_floor', domains: ['light'], action: 'turn_off' }]);
  assert.deepEqual(run('SET', { floorId: 'ground_floor', areaId: 'ignored' }), [{ kind: 'area', blockId: 'r', floorId: 'ground_floor', domains: ['light', 'media_player'], action: 'turn_on' }], 'a zone wins over a room');
  const err = (p: Record<string, unknown>) => compileProgram(prog([B('r', 'SET', { target: 'room', ...p })])).errors.map(e => e.message).join();
  assert.equal(err({ floorId: 'upstairs' }), ''); assert.match(err({ floorId: 'Up Stairs' }), /pick the room/); assert.match(err({}), /zone/);
});

test('TIME_OF_DAY lives in Timers; AREA_OUT is hidden from the palette', () => {
  assert.equal(registry.TIME_OF_DAY.category, 'Timers');
  assert.ok(!listBlocks().some(b => b.type === 'AREA_OUT') && listBlocks().some(b => b.type === 'TIME_OF_DAY'));
});

test('AREA_OUT (legacy): one command on the rising edge, with domains and action', () => {
  const state = { on: false };
  const input: IOAdapter = { getEntity: () => ({ state: state.on ? 'on' : 'off', attributes: {} }) };
  const rt = new Runtime(prog([B('i', 'ENTITY_IN', { entityId: 'input_boolean.bye', dataType: 'BOOL' }), B('r', 'AREA_OUT', { areaId: 'living_room', domains: ['light', 'media_player'] })], [w('i.OUT', 'r.EN')]), { io: input });
  assert.deepEqual(rt.scan().commands, []);
  state.on = true;
  assert.deepEqual(rt.scan().commands, [{ kind: 'area', blockId: 'r', areaId: 'living_room', domains: ['light', 'media_player'], action: 'turn_off' }]);
  assert.deepEqual(rt.scan().commands, [], 'held TRUE does not repeat');
  state.on = false; rt.scan(); state.on = true;
  assert.equal(rt.scan().commands.length, 1, 'fires again on the next edge');
  const on = new Runtime(prog([B('c', 'CONST', { dataType: 'BOOL', value: true }), B('r', 'AREA_OUT', { areaId: 'hall', action: 'turn_on' })], [w('c.OUT', 'r.EN')]), { io, writeOnFirstScan: false });
  assert.deepEqual(on.scan().commands, [], 'respects writeOnFirstScan = false');
});

test('AREA_OUT: validation', () => {
  const err = (p: Record<string, unknown>) => compileProgram(prog([B('r', 'AREA_OUT', p)])).errors.map(e => e.message).join();
  assert.match(err({}), /pick the room/); assert.match(err({ areaId: 'Living Room' }), /pick the room/);
  assert.match(err({ areaId: 'a', domains: [] }), /at least one/); assert.match(err({ areaId: 'a', domains: ['lock'] }), /not supported/);
  assert.match(err({ areaId: 'a', action: 'explode' }), /action/);
  assert.equal(err({ areaId: 'kitchen_2' }), '');
  assert.deepEqual(registry.AREA_OUT.inputs({}).map(p => p.name), ['EN']);
});
