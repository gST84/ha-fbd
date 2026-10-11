import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Runtime, CompileFailed, CyclicScheduler, compileProgram,
  type BlockInst, type EntityState, type IOAdapter, type Variable, type Wire,
} from '../src/index.js';

// ───────── helpers ─────────
class FakeIO implements IOAdapter {
  ents = new Map<string, EntityState>();
  set(id: string, state: string, attributes: Record<string, unknown> = {}) { this.ents.set(id, { state, attributes }); }
  getEntity(id: string) { return this.ents.get(id); }
}
const w = (from: string, to: string): Wire => {
  const [fb, fp] = from.split('.'); const [tb, tp] = to.split('.');
  return { from: { block: fb, pin: fp }, to: { block: tb, pin: tp } };
};
const B = (id: string, type: string, params: Record<string, unknown> = {}): BlockInst => ({ id, type, params });
const inBool = (id: string, entityId: string) => B(id, 'ENTITY_IN', { entityId, dataType: 'BOOL' });
const inReal = (id: string, entityId: string) => B(id, 'ENTITY_IN', { entityId, dataType: 'REAL' });

function setup(blocks: BlockInst[], wires: Wire[], variables: Variable[] = [], opts: { writeOnFirstScan?: boolean } = {}) {
  const io = new FakeIO();
  let t = 0;
  const rt = new Runtime(
    { version: 1, variables, networks: [{ id: 'n1', title: 'Network 1', blocks, wires }] },
    { io, now: () => t, ...opts },
  );
  return { io, rt, advance: (ms: number) => { t += ms; } };
}
const prog = (blocks: BlockInst[], wires: Wire[], variables: Variable[] = []) =>
  ({ version: 1 as const, variables, networks: [{ id: 'n1', title: 'n', blocks, wires }] });

// ───────── logic / math ─────────
test('AND / OR / XOR / NOT with 3 inputs', () => {
  const { io, rt } = setup(
    [inBool('a', 'input_boolean.a'), inBool('b', 'input_boolean.b'), inBool('c', 'input_boolean.c'),
      B('and', 'AND', { inputCount: 3 }), B('or', 'OR', { inputCount: 3 }), B('xor', 'XOR', { inputCount: 3 }), B('not', 'NOT')],
    ['and', 'or', 'xor'].flatMap(g => [w('a.OUT', `${g}.IN1`), w('b.OUT', `${g}.IN2`), w('c.OUT', `${g}.IN3`)]).concat(w('a.OUT', 'not.IN')),
  );
  io.set('input_boolean.a', 'on'); io.set('input_boolean.b', 'on'); io.set('input_boolean.c', 'off');
  let r = rt.scan();
  assert.deepEqual([r.values['and.OUT'], r.values['or.OUT'], r.values['xor.OUT'], r.values['not.OUT']], [false, true, false, false]);
  io.set('input_boolean.c', 'on');
  r = rt.scan();
  assert.deepEqual([r.values['and.OUT'], r.values['xor.OUT']], [true, true]);
});

test('math: ADD(3), SUB, DIV by zero, LIMIT, MIN/MAX', () => {
  const { rt } = setup(
    [B('add', 'ADD', { inputCount: 3, IN1: 1, IN2: 2, IN3: 3.5 }), B('sub', 'SUB', { IN1: 10, IN2: 4 }),
      B('div', 'DIV', { IN1: 5, IN2: 0 }), B('lim', 'LIMIT', { MN: 0, IN: 150, MX: 100 }),
      B('min', 'MIN', { IN1: 4, IN2: -2 }), B('max', 'MAX', { IN1: 4, IN2: -2 })],
    [],
  );
  const v = rt.scan().values;
  assert.equal(v['add.OUT'], 6.5); assert.equal(v['sub.OUT'], 6); assert.equal(v['div.OUT'], 0);
  assert.equal(v['lim.OUT'], 100); assert.equal(v['min.OUT'], -2); assert.equal(v['max.OUT'], 4);
});

test('comparison, SEL, MUX, conversions', () => {
  const { rt } = setup(
    [B('gt', 'GT', { IN1: 5, IN2: 3 }), B('eq', 'EQ', { IN1: 5, IN2: 5 }),
      B('sel', 'SEL', { G: true, IN0: 10, IN1: 20 }),
      B('mux', 'MUX', { inputCount: 3, K: 2, IN0: 'a', IN1: 'b', IN2: 'c' }),
      B('mux2', 'MUX', { inputCount: 3, K: 99, IN0: 'a', IN1: 'b', IN2: 'c' }),
      B('toi', 'TO_INT', { IN: 7.9 })],
    [],
  );
  const v = rt.scan().values;
  assert.equal(v['gt.OUT'], true); assert.equal(v['eq.OUT'], true); assert.equal(v['sel.OUT'], 20);
  assert.equal(v['mux.OUT'], 'c'); assert.equal(v['mux2.OUT'], 'c'); assert.equal(v['toi.OUT'], 7);
});

test('MOVE copies while EN is TRUE and holds the last value otherwise', () => {
  const { io, rt } = setup(
    [inBool('en', 'input_boolean.en'), inReal('src', 'sensor.src'), B('mv', 'MOVE'), B('free', 'MOVE', { IN: 'abc' })],
    [w('en.OUT', 'mv.EN'), w('src.OUT', 'mv.IN')],
  );
  io.set('input_boolean.en', 'off'); io.set('sensor.src', '5');
  let v = rt.scan().values;
  assert.equal(v['mv.OUT'], 0, 'nothing copied yet'); assert.equal(v['mv.ENO'], false);
  assert.equal(v['free.OUT'], 'abc', 'EN defaults to TRUE: plain pass-through of any type'); assert.equal(v['free.ENO'], true);
  io.set('input_boolean.en', 'on'); v = rt.scan().values;
  assert.equal(v['mv.OUT'], 5); assert.equal(v['mv.ENO'], true);
  io.set('sensor.src', '9'); v = rt.scan().values; assert.equal(v['mv.OUT'], 9, 'follows IN while enabled');
  io.set('input_boolean.en', 'off'); io.set('sensor.src', '42'); v = rt.scan().values;
  assert.equal(v['mv.OUT'], 9, 'holds the last copied value'); assert.equal(v['mv.ENO'], false);
});

// ───────── timers ─────────
test('TON delays Q and resets when IN drops', () => {
  const { io, rt, advance } = setup([inBool('a', 'input_boolean.a'), B('t', 'TON', { PT: '1s' })], [w('a.OUT', 't.IN')]);
  io.set('input_boolean.a', 'on');
  assert.equal(rt.scan().values['t.Q'], false);
  advance(500);
  let v = rt.scan().values; assert.equal(v['t.Q'], false); assert.equal(v['t.ET'], 500);
  advance(500);
  assert.equal(rt.scan().values['t.Q'], true);
  io.set('input_boolean.a', 'off'); advance(100);
  v = rt.scan().values; assert.equal(v['t.Q'], false); assert.equal(v['t.ET'], 0);
});

test('TOF keeps Q for PT after IN falls', () => {
  const { io, rt, advance } = setup([inBool('a', 'input_boolean.a'), B('t', 'TOF', { PT: 1000 })], [w('a.OUT', 't.IN')]);
  io.set('input_boolean.a', 'on');
  assert.equal(rt.scan().values['t.Q'], true);
  io.set('input_boolean.a', 'off'); advance(100);
  assert.equal(rt.scan().values['t.Q'], true);
  advance(900);
  assert.equal(rt.scan().values['t.Q'], true);
  advance(100);
  assert.equal(rt.scan().values['t.Q'], false);
});

test('TP gives a fixed pulse and ignores retrigger', () => {
  const { io, rt, advance } = setup([inBool('a', 'input_boolean.a'), B('t', 'TP', { PT: 1000 })], [w('a.OUT', 't.IN')]);
  io.set('input_boolean.a', 'on');
  assert.equal(rt.scan().values['t.Q'], true);
  advance(600); io.set('input_boolean.a', 'off'); assert.equal(rt.scan().values['t.Q'], true);
  advance(100); io.set('input_boolean.a', 'on');   assert.equal(rt.scan().values['t.Q'], true);  // retrigger ignored…
  advance(300);                                    assert.equal(rt.scan().values['t.Q'], false); // …pulse ends at 1000 ms total
});

// ───────── edges / bistables / counters ─────────
test('R_TRIG and F_TRIG pulse for exactly one scan', () => {
  const { io, rt } = setup([inBool('a', 'input_boolean.a'), B('r', 'R_TRIG'), B('f', 'F_TRIG')], [w('a.OUT', 'r.CLK'), w('a.OUT', 'f.CLK')]);
  io.set('input_boolean.a', 'off'); rt.scan();
  io.set('input_boolean.a', 'on');
  let v = rt.scan().values; assert.equal(v['r.Q'], true); assert.equal(v['f.Q'], false);
  v = rt.scan().values; assert.equal(v['r.Q'], false);
  io.set('input_boolean.a', 'off');
  v = rt.scan().values; assert.equal(v['f.Q'], true);
  v = rt.scan().values; assert.equal(v['f.Q'], false);
});

test('SR is set-dominant, RS is reset-dominant', () => {
  const { io, rt } = setup(
    [inBool('s', 'input_boolean.s'), inBool('r', 'input_boolean.r'), B('sr', 'SR'), B('rs', 'RS')],
    [w('s.OUT', 'sr.S1'), w('r.OUT', 'sr.R'), w('s.OUT', 'rs.S'), w('r.OUT', 'rs.R1')],
  );
  io.set('input_boolean.s', 'on'); io.set('input_boolean.r', 'off');
  let v = rt.scan().values; assert.equal(v['sr.Q1'], true); assert.equal(v['rs.Q1'], true);
  io.set('input_boolean.s', 'off'); v = rt.scan().values; assert.equal(v['sr.Q1'], true);   // latched
  io.set('input_boolean.s', 'on'); io.set('input_boolean.r', 'on');
  v = rt.scan().values; assert.equal(v['sr.Q1'], true); assert.equal(v['rs.Q1'], false);   // dominance
});

test('CTU counts rising edges only, resets, Q at PV', () => {
  const { io, rt } = setup([inBool('c', 'input_boolean.c'), inBool('r', 'input_boolean.r'), B('ctu', 'CTU', { PV: 3 })],
    [w('c.OUT', 'ctu.CU'), w('r.OUT', 'ctu.R')]);
  io.set('input_boolean.r', 'off');
  let v = rt.scan().values;
  for (let n = 1; n <= 3; n++) {
    io.set('input_boolean.c', 'on');  v = rt.scan().values; assert.equal(v['ctu.CV'], n);
    v = rt.scan().values; assert.equal(v['ctu.CV'], n);                  // held high → no recount
    io.set('input_boolean.c', 'off'); rt.scan();
  }
  assert.equal(v['ctu.CV'], 3);
  io.set('input_boolean.c', 'on'); v = rt.scan().values; assert.equal(v['ctu.Q'], true);
  io.set('input_boolean.r', 'on'); v = rt.scan().values; assert.equal(v['ctu.CV'], 0); assert.equal(v['ctu.Q'], false);
});

test('CTD loads PV and counts down; CTUD goes both ways', () => {
  const { io, rt } = setup(
    [inBool('d', 'input_boolean.d'), inBool('l', 'input_boolean.l'), B('ctd', 'CTD', { PV: 2 }),
      inBool('u', 'input_boolean.u'), B('ctud', 'CTUD', { PV: 5 })],
    [w('d.OUT', 'ctd.CD'), w('l.OUT', 'ctd.LD'), w('u.OUT', 'ctud.CU'), w('d.OUT', 'ctud.CD')],
  );
  io.set('input_boolean.l', 'on'); io.set('input_boolean.d', 'off'); io.set('input_boolean.u', 'off');
  let v = rt.scan().values; assert.equal(v['ctd.CV'], 2); assert.equal(v['ctd.Q'], false);
  io.set('input_boolean.l', 'off'); io.set('input_boolean.d', 'on');
  v = rt.scan().values; assert.equal(v['ctd.CV'], 1); assert.equal(v['ctud.CV'], -1);
  io.set('input_boolean.d', 'off'); rt.scan(); io.set('input_boolean.d', 'on');
  v = rt.scan().values; assert.equal(v['ctd.CV'], 0); assert.equal(v['ctd.Q'], true);
});

// ───────── variables ─────────
test('feedback through a variable toggles once per scan', () => {
  const { rt } = setup(
    [B('rd', 'VAR_READ', { name: 'x', varType: 'BOOL' }), B('n', 'NOT'), B('wr', 'VAR_WRITE', { name: 'x', varType: 'BOOL' })],
    [w('rd.OUT', 'n.IN'), w('n.OUT', 'wr.IN')],
    [{ name: 'x', type: 'BOOL', kind: 'local', init: false }],
  );
  const seq: unknown[] = [];
  for (let k = 0; k < 4; k++) { rt.scan(); seq.push(rt.getVariable('x')); }
  assert.deepEqual(seq, [true, false, true, false]);
});

test('retained variables can be saved and restored', () => {
  const vars: Variable[] = [{ name: 'cnt', type: 'INT', kind: 'retain', init: 0 }, { name: 'tmp', type: 'INT', kind: 'local' }];
  const { rt } = setup([], [], vars);
  rt.loadRetained({ cnt: 42, tmp: 9 });
  assert.deepEqual(rt.getRetained(), { cnt: 42 });
});

// ───────── Home Assistant I/O ─────────
test('ENTITY_IN → GT → ENTITY_OUT emits a command only on change', () => {
  const { io, rt } = setup(
    [inReal('t', 'sensor.temp'), B('gt', 'GT', { IN2: 25 }), B('o', 'ENTITY_OUT', { kind: 'switch', entityId: 'switch.fan' })],
    [w('t.OUT', 'gt.IN1'), w('gt.OUT', 'o.IN')],
  );
  io.set('sensor.temp', '26.5');
  assert.deepEqual(rt.scan().commands, [{ kind: 'switch', blockId: 'o', entityId: 'switch.fan', value: true }]);
  assert.deepEqual(rt.scan().commands, []);
  io.set('sensor.temp', '20');
  assert.deepEqual(rt.scan().commands, [{ kind: 'switch', blockId: 'o', entityId: 'switch.fan', value: false }]);
});

test('writeOnFirstScan=false suppresses the startup write but still tracks changes', () => {
  const { io, rt } = setup(
    [inBool('a', 'input_boolean.a'), B('o', 'ENTITY_OUT', { kind: 'switch', entityId: 'switch.x' })],
    [w('a.OUT', 'o.IN')], [], { writeOnFirstScan: false },
  );
  io.set('input_boolean.a', 'on');
  assert.deepEqual(rt.scan().commands, []);
  io.set('input_boolean.a', 'off');
  assert.equal(rt.scan().commands.length, 1);
});

test('ENTITY_IN reads attributes, holds last value and reports AVAIL', () => {
  const { io, rt } = setup([B('b', 'ENTITY_IN', { entityId: 'light.l', attribute: 'brightness', dataType: 'INT' })], []);
  io.set('light.l', 'on', { brightness: 128 });
  let v = rt.scan().values; assert.equal(v['b.OUT'], 128); assert.equal(v['b.AVAIL'], true);
  io.set('light.l', 'on', {});                       // attribute disappears
  v = rt.scan().values; assert.equal(v['b.OUT'], 128); assert.equal(v['b.AVAIL'], false);
});

test('ENTITY_IN BOOL treats unavailable as not available and keeps last value', () => {
  const { io, rt } = setup([inBool('a', 'binary_sensor.door')], []);
  io.set('binary_sensor.door', 'on'); assert.equal(rt.scan().values['a.OUT'], true);
  io.set('binary_sensor.door', 'unavailable');
  const v = rt.scan().values; assert.equal(v['a.OUT'], true); assert.equal(v['a.AVAIL'], false);
});

test('ENTITY_OUT service fires on rising edge with data', () => {
  const { io, rt } = setup(
    [inBool('a', 'input_boolean.a'),
      B('o', 'ENTITY_OUT', { kind: 'service', service: 'notify.mobile_app', data: { message: 'Door open' } })],
    [w('a.OUT', 'o.EN')],
  );
  io.set('input_boolean.a', 'off'); assert.equal(rt.scan().commands.length, 0);
  io.set('input_boolean.a', 'on');
  assert.deepEqual(rt.scan().commands, [{ kind: 'service', blockId: 'o', service: 'notify.mobile_app', entityId: undefined, data: { message: 'Door open' } }]);
  assert.equal(rt.scan().commands.length, 0);
});

test('ENTITY_OUT value writes numbers (e.g. thermostat setpoint)', () => {
  const { rt } = setup([B('c', 'CONST', { dataType: 'REAL', value: 21.5 }), B('o', 'ENTITY_OUT', { kind: 'value', entityId: 'input_number.target' })],
    [w('c.OUT', 'o.IN')]);
  assert.deepEqual(rt.scan().commands, [{ kind: 'value', blockId: 'o', entityId: 'input_number.target', value: 21.5 }]);
});

// ───────── compile errors ─────────
test('compile: algebraic loop is rejected', () => {
  const r = compileProgram(prog([B('n1', 'NOT'), B('n2', 'NOT')], [w('n1.OUT', 'n2.IN'), w('n2.OUT', 'n1.IN')]));
  assert.match(r.errors.map(e => e.message).join('\n'), /Algebraic loop/);
});
test('compile: type mismatch, double driver, unknown block, bad pin, unknown variable', () => {
  const r = compileProgram(prog(
    [B('s', 'ENTITY_IN', { entityId: 'sensor.name', dataType: 'STRING' }), B('a', 'AND'), B('c1', 'CONST', { dataType: 'BOOL', value: true }),
      B('c2', 'CONST', { dataType: 'BOOL', value: true }), B('nope', 'FOO'), B('v', 'VAR_READ', { name: 'missing', varType: 'BOOL' })],
    [w('s.OUT', 'a.IN1'), w('c1.OUT', 'a.IN2'), w('c2.OUT', 'a.IN2'), w('c1.OUT', 'a.NOPE')],
  ));
  const m = r.errors.map(e => e.message).join('\n');
  assert.match(m, /Type mismatch/); assert.match(m, /already has a wire/); assert.match(m, /Unknown block type "FOO"/);
  assert.match(m, /no input "NOPE"/); assert.match(m, /Unknown variable "missing"/);
});
test('Runtime constructor throws CompileFailed', () => {
  assert.throws(() => new Runtime(prog([B('x', 'ENTITY_IN', { entityId: 'bad' })], []), { io: new FakeIO() }), CompileFailed);
});

test('blocks run in dependency order regardless of array order', () => {
  const { rt } = setup(
    [B('n', 'NOT'), B('c', 'CONST', { dataType: 'BOOL', value: false })],   // consumer listed before producer
    [w('c.OUT', 'n.IN')],
  );
  assert.equal(rt.scan().values['n.OUT'], true);
});

test('a healthy scan reports no errors', () => {
  const { rt } = setup([B('c', 'CONST', { dataType: 'INT', value: 1 })], []);
  const r = rt.scan(); assert.equal(r.errors.length, 0); assert.equal(r.values['c.OUT'], 1);
});

// ───────── scheduler ─────────
test('CyclicScheduler runs scans periodically and can be stopped', async () => {
  const { rt } = setup([B('c', 'CONST', { dataType: 'INT', value: 1 })], []);
  let n = 0;
  const s = new CyclicScheduler(rt, 20, () => { n++; });
  s.start();
  await new Promise(r => setTimeout(r, 230));
  s.stop();
  const atStop = n;
  assert.ok(atStop >= 6 && atStop <= 14, `expected ~11 scans, got ${atStop}`);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(n, atStop);
});
