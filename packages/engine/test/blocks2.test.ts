import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Runtime, compileProgram, listBlocks, pinDoc, BLOCK_FAMILIES, familyOf, parseNumber, toNum, registry,
  type BlockInst, type EntityState, type HAEvent, type IOAdapter, type Variable, type Wire,
} from '../src/index.js';

class FakeIO implements IOAdapter {
  ents = new Map<string, EntityState>(); queue: HAEvent[] = [];
  set(id: string, state: string, attributes: Record<string, unknown> = {}) { this.ents.set(id, { state, attributes }); }
  getEntity(id: string) { return this.ents.get(id); }
  drainEvents() { return this.queue.splice(0); }
}
const w = (from: string, to: string): Wire => { const [fb, fp] = from.split('.'), [tb, tp] = to.split('.'); return { from: { block: fb, pin: fp }, to: { block: tb, pin: tp } }; };
const B = (id: string, type: string, params: Record<string, unknown> = {}): BlockInst => ({ id, type, params });
function setup(blocks: BlockInst[], wires: Wire[] = [], variables: Variable[] = [], opts = {}) {
  const io = new FakeIO(); let t = 0;
  const rt = new Runtime({ version: 1, variables, networks: [{ id: 'n', title: '', blocks, wires }] }, { io, now: () => t, ...opts });
  return { io, rt, advance: (ms: number) => { t += ms; } };
}

test('decimal comma: parseNumber, toNum and TIME strings', () => {
  assert.equal(parseNumber('1,5'), 1.5); assert.equal(parseNumber(' -2.25 '), -2.25); assert.equal(parseNumber('1.'), 1);
  assert.equal(parseNumber('abc'), undefined); assert.equal(parseNumber('1,5kg'), undefined);
  assert.equal(toNum('21,5'), 21.5); assert.equal(toNum('12abc'), 12);
  const { rt } = setup([B('t', 'TON', { PT: '1,5s' }), B('a', 'ADD', { IN1: '1,5', IN2: '2,25' })]);
  const v = rt.scan().values;
  assert.equal(v['a.OUT'], 3.75);
});

test('REAL variable keeps its decimals through ADD → VAR_WRITE → VAR_READ', () => {
  const { rt } = setup(
    [B('r', 'VAR_READ', { name: 'x', varType: 'REAL' }), B('a', 'ADD', { IN2: 0.25 }), B('wr', 'VAR_WRITE', { name: 'x', varType: 'REAL' })],
    [w('r.OUT', 'a.IN1'), w('a.OUT', 'wr.IN')], [{ name: 'x', type: 'REAL', kind: 'local', init: 1.5 }]);
  rt.scan(); rt.scan();
  assert.equal(rt.getVariable('x'), 2);
  rt.scan(); assert.equal(rt.getVariable('x'), 2.25);
});

test('TRUE states are case-insensitive on both sides', () => {
  const { io, rt } = setup([B('i', 'ENTITY_IN', { entityId: 'sensor.mode', dataType: 'BOOL', onStates: ['Armed_Home', ' HOME '] })]);
  io.set('sensor.mode', 'armed_home'); assert.equal(rt.scan().values['i.OUT'], true);
  io.set('sensor.mode', 'Home'); assert.equal(rt.scan().values['i.OUT'], true);
  io.set('sensor.mode', 'away'); assert.equal(rt.scan().values['i.OUT'], false);
  io.set('sensor.mode', 'ON');
  const d = setup([B('i', 'ENTITY_IN', { entityId: 'sensor.x', dataType: 'BOOL' })]); d.io.set('sensor.x', 'ON');
  assert.equal(d.rt.scan().values['i.OUT'], true);
});

test('SET / RESET on a variable latch; later block wins when both are TRUE', () => {
  const vars: Variable[] = [{ name: 'flag', type: 'BOOL', kind: 'local', init: false }];
  const { io, rt } = setup(
    [B('s', 'ENTITY_IN', { entityId: 'input_boolean.s', dataType: 'BOOL' }), B('r', 'ENTITY_IN', { entityId: 'input_boolean.r', dataType: 'BOOL' }),
      B('set', 'SET', { target: 'variable', name: 'flag' }), B('reset', 'RESET', { target: 'variable', name: 'flag' })],
    [w('s.OUT', 'set.IN'), w('r.OUT', 'reset.IN')], vars);
  io.set('input_boolean.s', 'off'); io.set('input_boolean.r', 'off');
  rt.scan(); assert.equal(rt.getVariable('flag'), false);
  io.set('input_boolean.s', 'on'); rt.scan(); assert.equal(rt.getVariable('flag'), true);
  io.set('input_boolean.s', 'off'); rt.scan(); assert.equal(rt.getVariable('flag'), true, 'latched');
  io.set('input_boolean.r', 'on'); rt.scan(); assert.equal(rt.getVariable('flag'), false);
  io.set('input_boolean.s', 'on'); rt.scan(); assert.equal(rt.getVariable('flag'), false, 'RESET is later in the program → wins');
});

test('SET / RESET validate: variable must exist and be BOOL', () => {
  const bad = compileProgram({ version: 1, variables: [{ name: 'n', type: 'INT', kind: 'local' }],
    networks: [{ id: 'n', title: '', wires: [], blocks: [B('a', 'SET', { target: 'variable', name: 'n' }), B('b', 'RESET', { target: 'variable', name: 'ghost' }), B('c', 'SET', { target: 'entity', entityId: 'x' })] }] });
  assert.equal(bad.errors.length, 3);
});

test('SET / RESET on an entity act on the rising edge only', () => {
  const { io, rt } = setup([B('i', 'ENTITY_IN', { entityId: 'input_boolean.a', dataType: 'BOOL' }), B('set', 'SET', { target: 'entity', entityId: 'light.x' })], [w('i.OUT', 'set.IN')]);
  io.set('input_boolean.a', 'off'); assert.deepEqual(rt.scan().commands, []);
  io.set('input_boolean.a', 'on');  assert.deepEqual(rt.scan().commands, [{ kind: 'switch', blockId: 'set', entityId: 'light.x', value: true }]);
  assert.deepEqual(rt.scan().commands, []);
});

test('ENTITY_OUT attribute: typed pin, emits on change, validates the attribute', () => {
  const { io, rt } = setup([B('i', 'ENTITY_IN', { entityId: 'sensor.t', dataType: 'REAL' }),
    B('o', 'ENTITY_OUT', { kind: 'attribute', entityId: 'climate.living', attribute: 'temperature' })], [w('i.OUT', 'o.IN')]);
  io.set('sensor.t', '21,5');
  assert.deepEqual(rt.scan().commands, [{ kind: 'attribute', blockId: 'o', entityId: 'climate.living', attribute: 'temperature', value: 21.5 }]);
  assert.deepEqual(rt.scan().commands, []);
  io.set('sensor.t', '22'); assert.equal(rt.scan().commands.length, 1);

  const pins = registry.ENTITY_OUT.inputs({ kind: 'attribute', entityId: 'light.a', attribute: 'effect' });
  assert.equal(pins[0].type, 'STRING');
  const errs = (p: Record<string, unknown>) => compileProgram({ version: 1, variables: [], networks: [{ id: 'n', title: '', wires: [], blocks: [B('o', 'ENTITY_OUT', p)] }] }).errors.map(e => e.message).join();
  assert.match(errs({ kind: 'attribute', entityId: 'light.a', attribute: 'bogus' }), /not a settable attribute/);
  assert.match(errs({ kind: 'attribute', entityId: 'light.a' }), /pick the attribute/);
  assert.equal(errs({ kind: 'attribute', entityId: 'light.a', attribute: 'brightness' }), '');
});

test('EVENT_IN: one-scan pulse, data match and value extraction', () => {
  const { io, rt } = setup([B('e', 'EVENT_IN', { eventType: 'zha_event', match: { command: 'on', args: { level: 5 } }, valuePath: 'args.level', valueType: 'REAL' })]);
  let v = rt.scan().values; assert.equal(v['e.Q'], false);
  io.queue.push({ type: 'other', data: {} }, { type: 'zha_event', data: { command: 'off' } });
  assert.equal(rt.scan().values['e.Q'], false, 'wrong type / data → no pulse');
  io.queue.push({ type: 'zha_event', data: { command: 'on', args: { level: '5' }, extra: 1 } });
  v = rt.scan().values; assert.equal(v['e.Q'], true); assert.equal(v['e.VAL'], 5);
  v = rt.scan().values; assert.equal(v['e.Q'], false, 'pulse lasts ONE scan'); assert.equal(v['e.VAL'], 5, 'value is held');
});

test('EVENT_IN without valuePath has no VAL pin; EVENT_OUT fires on rising edge', () => {
  assert.deepEqual(registry.EVENT_IN.outputs({ eventType: 'x' }).map(p => p.name), ['Q']);
  assert.deepEqual(registry.EVENT_IN.outputs({ eventType: 'x', valuePath: 'a' }).map(p => p.name), ['Q', 'VAL']);
  const { io, rt } = setup([B('i', 'ENTITY_IN', { entityId: 'input_boolean.a', dataType: 'BOOL' }), B('o', 'EVENT_OUT', { eventType: 'fbd_alarm', data: { zone: 'hall' } })], [w('i.OUT', 'o.IN')]);
  io.set('input_boolean.a', 'off'); assert.equal(rt.scan().commands.length, 0);
  io.set('input_boolean.a', 'on');
  assert.deepEqual(rt.scan().commands, [{ kind: 'event', blockId: 'o', eventType: 'fbd_alarm', data: { zone: 'hall' } }]);
  assert.equal(rt.scan().commands.length, 0);
  assert.match(compileProgram({ version: 1, variables: [], networks: [{ id: 'n', title: '', wires: [], blocks: [B('e', 'EVENT_IN', {})] }] }).errors[0].message, /eventType/);
});

test('every block is documented, every pin explained, families are consistent', () => {
  for (const b of listBlocks()) {
    assert.ok(b.doc?.summary && b.doc.details, `${b.type} needs docs`);
    for (const p of b.inputs) assert.ok(pinDoc(b.doc, 'inputs', p.name), `${b.type}.${p.name} (input) is undocumented`);
    for (const p of b.outputs) assert.ok(pinDoc(b.doc, 'outputs', p.name), `${b.type}.${p.name} (output) is undocumented`);
  }
  assert.ok(pinDoc(registry && listBlocks().find(b => b.type === 'ENTITY_OUT')!.doc, 'inputs', 'EN'));
  for (const f of BLOCK_FAMILIES) for (const t of f) assert.ok(registry[t], `${t} is not registered`);
  assert.deepEqual(familyOf('XOR'), ['AND', 'OR', 'XOR', 'NOT']); assert.deepEqual(familyOf('CONST'), ['CONST']);
});
