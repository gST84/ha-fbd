import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, compileProgram, listBlocks, registry, type BlockInst, type EntityState, type IOAdapter, type Wire } from '../src/index.js';

const B = (id: string, type: string, params: Record<string, unknown> = {}): BlockInst => ({ id, type, params });
const w = (from: string, to: string): Wire => { const [fb, fp] = from.split('.'), [tb, tp] = to.split('.'); return { from: { block: fb, pin: fp }, to: { block: tb, pin: tp } }; };

/** PID with PV read from an entity; `params` set the constant inputs. Time advances in `step` ms per scan. */
function pid(params: Record<string, unknown>) {
  const ents = new Map<string, EntityState>();
  const io: IOAdapter = { getEntity: id => ents.get(id) };
  let t = 0;
  const rt = new Runtime({ version: 1, variables: [], networks: [{ id: 'n', title: '', blocks: [
    B('pv', 'ENTITY_IN', { entityId: 'sensor.pv', dataType: 'REAL' }), B('c', 'PID', params)], wires: [w('pv.OUT', 'c.PV')] }] }, { io, now: () => t });
  return {
    run(pv: number, ms = 1000) { ents.set('sensor.pv', { state: String(pv), attributes: {} }); t += ms; const v = rt.scan().values; return { out: v['c.OUT'] as number, err: v['c.ERR'] as number }; },
  };
}

test('PID is in the Control category and listed', () => {
  assert.equal(registry.PID.category, 'Control');
  assert.ok(listBlocks().some(b => b.type === 'PID' && b.doc?.summary));
  assert.equal(compileProgram({ version: 1, variables: [], networks: [{ id: 'n', title: '', blocks: [B('c', 'PID')], wires: [] }] }).errors.length, 0);
});

test('P only: OUT = KP · error, limited to OUT_MIN … OUT_MAX', () => {
  const c = pid({ SP: 21, KP: 10 });
  assert.deepEqual(c.run(20), { out: 10, err: 1 });
  assert.equal(c.run(19).out, 20);
  assert.equal(c.run(5).out, 100, 'limited to OUT_MAX');
  assert.equal(c.run(25).out, 0, 'limited to OUT_MIN');
});

test('negative KP acts in reverse (cooling)', () => {
  const c = pid({ SP: 22, KP: -10 });
  assert.equal(c.run(24).out, 20);
  assert.equal(c.run(20).out, 0);
});

test('I part integrates the error over real time (TI = 10 s, KP = 2, error 1)', () => {
  const c = pid({ SP: 11, KP: 2, TI: '10s', OUT_MAX: 1000 });
  c.run(10, 1000);                               // first scan has dt = 0 → only P
  const a = c.run(10, 1000).out;                 // P = 2, I = 2·1·1/10 = 0.2
  assert.ok(Math.abs(a - 2.2) < 1e-9, String(a));
  const b = c.run(10, 4000).out;                 // I += 2·1·4/10 = 0.8
  assert.ok(Math.abs(b - 3.0) < 1e-9, String(b));
});

test('the scan interval does not change the integral (same total time)', () => {
  const total = (step: number) => { const c = pid({ SP: 11, KP: 1, TI: '10s', OUT_MAX: 1000 }); c.run(10, 0); let o = 0; for (let i = 0; i < 10000 / step; i++) o = c.run(10, step).out; return o; };
  assert.ok(Math.abs(total(100) - total(1000)) < 1e-9);
  assert.ok(Math.abs(total(1000) - 2) < 1e-9, 'P = 1, I = 1 after 10 s');
});

test('anti-windup: after being saturated the output leaves the limit right when the error reverses', () => {
  const c = pid({ SP: 20, KP: 1, TI: '10s', OUT_MAX: 10 });
  c.run(0, 0);
  for (let i = 0; i < 100; i++) assert.equal(c.run(0, 1000).out, 10);       // error 20 → saturated for 100 s
  const o = c.run(25, 1000).out;                                              // PV overshoots: error −5 → P = −5
  assert.ok(o < 10 && o <= 10 - 5 + 1, `output came off the limit at once (${o})`);
});

test('D part works on the measurement, not on the setpoint', () => {
  const c = pid({ SP: 20, KP: 1, TD: '10s', OUT_MIN: -1000, OUT_MAX: 1000 });
  c.run(20, 0);
  const steady = c.run(20, 1000).out;
  assert.equal(steady, 0, 'no error, no change → 0');
  const falling = c.run(18, 1000).out;                                         // PV falls 2 → P = 2, D positive
  assert.ok(falling > 2, `D adds to P when PV falls (${falling})`);
  const settled = [1, 2, 3, 4, 5, 6, 7, 8].map(() => c.run(18, 1000).out).at(-1)!;
  assert.ok(Math.abs(settled - 2) < 0.5, `D fades out when PV stops changing (${settled})`);
});

test('EN = FALSE resets the controller and holds OUT_MIN', () => {
  const c = pid({ SP: 11, KP: 1, TI: '10s', OUT_MIN: 5, OUT_MAX: 100, EN: false });
  assert.equal(c.run(10).out, 5);
  assert.equal(c.run(10).out, 5);
});

test('swapped limits are tolerated and TI/TD default to off', () => {
  const c = pid({ SP: 10, KP: 1, OUT_MIN: 100, OUT_MAX: 0 });
  assert.equal(c.run(4).out, 6);
  assert.equal(c.run(4).out, 6, 'no integral drift without TI');
});
