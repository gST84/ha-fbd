import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileProgram, registry } from '@ha-fbd/engine';
import {
  addBlock, addNetwork, addVariable, addWire, deleteBlock, deleteNetwork, deleteVariable, deleteWire,
  emptyProgram, migrateLegacy, moveBlock, moveNetwork, setParams, updateVariable,
} from '../src/ops';
import { findFreeSpot, layout, wirePath } from '../src/geometry';

const NET = 'net_1';

test('addBlock gives unique ids, grid positions and no overlap', () => {
  let p = emptyProgram();
  const ids: string[] = [];
  for (let i = 0; i < 6; i++) { const r = addBlock(p, NET, 'AND'); p = r.program; ids.push(r.id); }
  assert.equal(new Set(ids).size, 6);
  assert.deepEqual(ids.slice(0, 2), ['and_1', 'and_2']);
  const boxes = p.networks[0].blocks.map(b => ({ x: b.x!, y: b.y!, ...layout(b) }));
  for (const b of boxes) { assert.equal(b.x % 20, 0); assert.equal(b.y % 20, 0); }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${i} overlaps ${j}`);
  }
  assert.equal(addBlock(p, NET, 'NOPE').id, '');
});

test('addWire enforces types, replaces the previous driver, rejects self wires', () => {
  let p = emptyProgram();
  let r = addBlock(p, NET, 'ENTITY_IN', 0, 0, { entityId: 'sensor.t', dataType: 'REAL' }); p = r.program; const real = r.id;
  r = addBlock(p, NET, 'ENTITY_IN', 0, 100, { entityId: 'binary_sensor.d', dataType: 'BOOL' }); p = r.program; const bool = r.id;
  r = addBlock(p, NET, 'AND'); p = r.program; const and = r.id;

  assert.equal(addWire(p, NET, { block: real, pin: 'OUT' }, { block: and, pin: 'IN1' }), p, 'REAL → BOOL must be rejected');
  assert.equal(addWire(p, NET, { block: and, pin: 'OUT' }, { block: and, pin: 'IN1' }), p, 'self wire rejected');
  p = addWire(p, NET, { block: bool, pin: 'OUT' }, { block: and, pin: 'IN1' });
  p = addWire(p, NET, { block: bool, pin: 'AVAIL' }, { block: and, pin: 'IN1' });
  assert.equal(p.networks[0].wires.length, 1);
  assert.equal(p.networks[0].wires[0].from.pin, 'AVAIL');
  p = deleteWire(p, NET, { block: and, pin: 'IN1' });
  assert.equal(p.networks[0].wires.length, 0);
});

test('lowering inputCount prunes the wires of the removed pins', () => {
  let p = emptyProgram();
  const c = addBlock(p, NET, 'CONST', 60, 0, { dataType: 'BOOL', value: true }); p = c.program;
  const a = addBlock(p, NET, 'AND', 200, 0, { inputCount: 3 }); p = a.program;
  p = addWire(p, NET, { block: c.id, pin: 'OUT' }, { block: a.id, pin: 'IN3' });
  assert.equal(p.networks[0].wires.length, 1);
  p = setParams(p, NET, a.id, { inputCount: 2 });
  assert.equal(p.networks[0].wires.length, 0);
  p = setParams(p, NET, a.id, { inputCount: undefined });
  assert.equal('inputCount' in (p.networks[0].blocks[1].params ?? {}), false);
});

test('deleteBlock removes its wires; moveBlock is a no-op for equal positions', () => {
  let p = emptyProgram();
  const c = addBlock(p, NET, 'CONST', 0, 0); p = c.program;
  const n = addBlock(p, NET, 'NOT', 200, 0); p = n.program;
  p = addWire(p, NET, { block: c.id, pin: 'OUT' }, { block: n.id, pin: 'IN' });
  assert.equal(moveBlock(p, NET, n.id, 200, 0), p);
  assert.equal(moveBlock(p, NET, n.id, 240, 20).networks[0].blocks[1].x, 240);
  p = deleteBlock(p, NET, c.id);
  assert.equal(p.networks[0].wires.length, 0);
});

test('variables: rename / retype propagate into VAR blocks, programs compile', () => {
  let p = addVariable(emptyProgram());
  assert.equal(p.variables[0].name, 'var_1');
  const r = addBlock(p, NET, 'VAR_READ', 0, 0); p = r.program;           // picks the first variable
  const w = addBlock(p, NET, 'VAR_WRITE', 300, 0); p = w.program;
  p = addWire(p, NET, { block: r.id, pin: 'OUT' }, { block: w.id, pin: 'IN' });
  assert.equal(compileProgram(p).errors.length, 0);

  p = updateVariable(p, 0, { name: 'counter', type: 'INT', kind: 'retain' });
  const blocks = p.networks[0].blocks;
  assert.deepEqual([blocks[0].params?.name, blocks[0].params?.varType], ['counter', 'INT']);
  assert.equal(p.variables[0].init, 0);
  assert.equal(compileProgram(p).errors.length, 0, JSON.stringify(compileProgram(p).errors));
  p = deleteVariable(p, 0);
  assert.ok(compileProgram(p).errors.some(e => /Unknown variable/.test(e.message)));
});

test('networks: add, move, delete (never the last one)', () => {
  let p = addNetwork(emptyProgram()); p = addNetwork(p);
  assert.deepEqual(p.networks.map(n => n.id), ['net_1', 'net_2', 'net_3']);
  p = moveNetwork(p, 'net_3', -1);
  assert.deepEqual(p.networks.map(n => n.id), ['net_1', 'net_3', 'net_2']);
  assert.equal(moveNetwork(p, 'net_1', -1), p);
  p = deleteNetwork(deleteNetwork(deleteNetwork(p, 'net_1'), 'net_2'), 'net_3');
  assert.equal(p.networks.length, 1);
});

test('geometry: sizes, free spot and wire paths', () => {
  const l = layout({ id: 'x', type: 'ENTITY_IN', params: { entityId: 'binary_sensor.very_long_entity_name_here', dataType: 'BOOL' } });
  assert.ok(l.w >= 120 && l.w <= 300 && l.w % 20 === 0);
  assert.equal(layout({ id: 'y', type: 'CTUD' }).h, 30 + 5 * 22 + 8);
  assert.deepEqual(findFreeSpot([], 120, 100), { x: 60, y: 20 });
  assert.match(wirePath(100, 50, 300, 90), /^M100 50 H200 V90 H300$/);
  assert.match(wirePath(300, 50, 100, 90), /^M300 50 H320 V\d+ H80 V90 H100$/);
});

// ───────── multi-select, copy / paste, change type ─────────
import { changeBlockType, copyBlocks, deleteBlocks, moveBlocks, pasteClip } from '../src/ops';

function chain() {   // const → AND(in1) → NOT → var_write, plus an unrelated block
  let p = addVariable(emptyProgram());
  const c = addBlock(p, NET, 'CONST', 60, 0, { dataType: 'BOOL', value: true }); p = c.program;
  const a = addBlock(p, NET, 'AND', 200, 0, { inputCount: 3, IN2: true }); p = a.program;
  const n = addBlock(p, NET, 'NOT', 400, 0); p = n.program;
  const w = addBlock(p, NET, 'VAR_WRITE', 600, 0); p = w.program;
  const other = addBlock(p, NET, 'TON', 60, 200, { PT: '5s' }); p = other.program;
  p = addWire(p, NET, { block: c.id, pin: 'OUT' }, { block: a.id, pin: 'IN1' });
  p = addWire(p, NET, { block: a.id, pin: 'OUT' }, { block: n.id, pin: 'IN' });
  p = addWire(p, NET, { block: n.id, pin: 'OUT' }, { block: w.id, pin: 'IN' });
  return { p, c: c.id, a: a.id, n: n.id, w: w.id, t: other.id };
}

test('moveBlocks moves a group and keeps identity when nothing changes', () => {
  const { p, c, a } = chain();
  const same = moveBlocks(p, NET, { [c]: { x: 60, y: 0 } });
  assert.equal(same, p);
  const moved = moveBlocks(p, NET, { [c]: { x: 20, y: 40 }, [a]: { x: 220, y: 40 } });
  const bl = (id: string) => moved.networks[0].blocks.find(b => b.id === id)!;
  assert.deepEqual([bl(c).x, bl(c).y, bl(a).x, bl(a).y], [20, 40, 220, 40]);
  assert.equal(deleteBlocks(p, NET, [c, a]).networks[0].wires.length, 1);   // only NOT → VAR_WRITE survives
});

test('copy / paste: new ids, only internal wires, offset, repeatable, works into another network', () => {
  const { p, c, a, n, w } = chain();
  const clip = copyBlocks(p, NET, [c, a, n])!;
  assert.equal(clip.blocks.length, 3); assert.equal(clip.wires.length, 2, 'wire to var_write is not inside the selection');
  assert.equal(copyBlocks(p, NET, ['ghost']), null);

  const r = pasteClip(p, NET, clip, 40, 40);
  assert.equal(r.ids.length, 3);
  assert.equal(new Set([...p.networks[0].blocks.map(b => b.id), ...r.ids]).size, p.networks[0].blocks.length + 3, 'ids stay unique');
  const copies = r.program.networks[0].blocks.filter(b => r.ids.includes(b.id));
  assert.deepEqual(copies.map(b => [b.x, b.y]), [[100, 40], [240, 40], [440, 40]]);
  assert.equal(copies[1].params?.inputCount, 3); assert.equal(copies[1].params?.IN2, true);
  assert.equal(r.program.networks[0].wires.length, 3 + 2);
  const newWires = r.program.networks[0].wires.slice(3);
  assert.ok(newWires.every(x => r.ids.includes(x.from.block) && r.ids.includes(x.to.block)), 'copied wires only connect the copies');
  assert.notEqual(w, r.ids[0]);
  assert.equal(compileProgram(r.program).errors.length, 0, JSON.stringify(compileProgram(r.program).errors));

  const twice = pasteClip(r.program, NET, clip, 80, 80);
  assert.equal(new Set(twice.program.networks[0].blocks.map(b => b.id)).size, twice.program.networks[0].blocks.length);
  const other = pasteClip(addNetwork(p), 'net_2', clip, 0, 0);
  assert.equal(other.program.networks[1].blocks.length, 3); assert.equal(other.program.networks[1].wires.length, 2);
  assert.equal(pasteClip(p, 'nope', clip, 0, 0).ids.length, 0);
  clip.blocks[0].params = { changed: true };
  assert.notDeepEqual(p.networks[0].blocks[0].params, { changed: true }, 'clip is a deep copy');
});

test('changeBlockType: AND → OR keeps wires and constants, new id', () => {
  const { p, c, a } = chain();
  const r = changeBlockType(p, NET, a, 'OR');
  assert.equal(r.id, 'or_1');
  const net = r.program.networks[0];
  const blk = net.blocks.find(b => b.id === r.id)!;
  assert.equal(blk.type, 'OR'); assert.equal(blk.params?.inputCount, 3); assert.equal(blk.params?.IN2, true);
  assert.ok(net.wires.some(x => x.from.block === c && x.to.block === r.id && x.to.pin === 'IN1'));
  assert.ok(net.wires.some(x => x.from.block === r.id && x.from.pin === 'OUT'));
  assert.ok(!net.blocks.some(b => b.id === a));
  assert.equal(compileProgram(r.program).errors.length, 0);
});

test('changeBlockType: AND → NOT drops wires of pins that vanish; NOT → AND maps IN → IN1', () => {
  const { p, c, a, n } = chain();
  const toNot = changeBlockType(p, NET, a, 'NOT');
  const net = toNot.program.networks[0];
  assert.ok(net.wires.some(x => x.from.block === c && x.to.block === toNot.id && x.to.pin === 'IN'), 'IN1 → IN by position');
  const back = changeBlockType(p, NET, n, 'AND');
  assert.ok(back.program.networks[0].wires.some(x => x.to.block === back.id && x.to.pin === 'IN1' && x.from.block === a));
  // 3-input AND → NOT: the extra IN2 constant must not leak onto the NOT block
  assert.equal(net.blocks.find(b => b.id === toNot.id)!.params?.IN2, undefined);
});

test('changeBlockType: timers keep PT; other families / same type are refused; incompatible wires dropped', () => {
  const { p, t } = chain();
  const r = changeBlockType(p, NET, t, 'TOF');
  assert.equal(r.program.networks[0].blocks.find(b => b.id === r.id)!.params?.PT, '5s');
  assert.equal(changeBlockType(p, NET, t, 'AND').program, p);
  assert.equal(changeBlockType(p, NET, t, 'TON').program, p);

  // TO_BOOL (BOOL out) → TO_INT (INT out): a wire into a BOOL input no longer fits and is dropped
  let q = emptyProgram();
  const g = addBlock(q, NET, 'TO_BOOL', 0, 0); q = g.program;
  const nn = addBlock(q, NET, 'NOT', 300, 0); q = nn.program;
  q = addWire(q, NET, { block: g.id, pin: 'OUT' }, { block: nn.id, pin: 'IN' });
  assert.equal(changeBlockType(q, NET, g.id, 'TO_INT').program.networks[0].wires.length, 0);
  assert.equal(changeBlockType(q, NET, g.id, 'TO_BOOL').program, q);
  assert.equal(changeBlockType(q, NET, g.id, 'ADD').program, q, 'other family refused');
});

test('new blocks: SET / RESET defaults pick a BOOL variable; EVENT blocks start empty and are flagged by the compiler', () => {
  let p = addVariable(addVariable(emptyProgram()));
  p = updateVariable(p, 0, { type: 'INT' });
  const s = addBlock(p, NET, 'SET'); assert.equal(s.program.networks[0].blocks[0].params?.name, 'var_2');
  const e = addBlock(p, NET, 'EVENT_IN');
  assert.match(compileProgram(e.program).errors.map(x => x.message).join(), /eventType/);
});

test('auto-placement wraps at the visible width instead of running off-screen', () => {
  let p = emptyProgram();
  for (let i = 0; i < 6; i++) p = addBlock(p, NET, 'AND', undefined, undefined, undefined, 700).program;
  const bl = p.networks[0].blocks;
  assert.ok(bl.every(b => (b.x ?? 0) + layout(b).w <= 700), 'every block ends inside 700 px');
  assert.ok(new Set(bl.map(b => b.y)).size >= 2, 'blocks wrapped into several rows');
});

test('time-of-day and room blocks: sensible defaults that compile once the room is picked', () => {
  const t = addBlock(emptyProgram(), NET, 'TIME_OF_DAY');
  assert.deepEqual(t.program.networks[0].blocks[0].params, { start: '22:00', end: '06:00' });
  assert.equal(compileProgram(t.program).errors.length, 0);
  const r = addBlock(emptyProgram(), NET, 'RESET');
  const room = setParams(r.program, NET, r.id, { target: 'room', name: undefined, varType: undefined, areaId: '', domains: ['light', 'media_player'] });
  assert.match(compileProgram(room).errors[0].message, /pick the room/);
  const ok = setParams(room, NET, r.id, { areaId: 'living_room' });
  assert.equal(compileProgram(ok).errors.length, 0);
  assert.equal(layout(ok.networks[0].blocks[0]).subtitle, 'living room');
  assert.equal(registry.TIME_OF_DAY.category, 'Timers');
  assert.equal(layout(t.program.networks[0].blocks[0]).subtitle, '22:00 – 06:00');
  const days = setParams(t.program, NET, t.id, { days: [1, 5] });
  assert.equal(layout(days.networks[0].blocks[0]).subtitle, '22:00 – 06:00 · Mon Fri');
});

test('migrateLegacy: ROOM OUT (AREA_OUT) becomes SET / RESET with target room, wires follow', () => {
  const p = { version: 1 as const, name: 'x', variables: [], networks: [{ id: NET, title: '', blocks: [
    { id: 'c', type: 'CONST', params: { dataType: 'BOOL', value: true } },
    { id: 'a', type: 'AREA_OUT', params: { areaId: 'hall', domains: ['light'], action: 'turn_off' } },
    { id: 'b', type: 'AREA_OUT', params: { areaId: 'hall', domains: ['light'], action: 'turn_on' } }],
    wires: [{ from: { block: 'c', pin: 'OUT' }, to: { block: 'a', pin: 'EN' } }, { from: { block: 'c', pin: 'OUT' }, to: { block: 'b', pin: 'EN' } }] }] };
  const m = migrateLegacy(p);
  const bl = m.networks[0].blocks;
  assert.deepEqual(bl.map(b => b.type), ['CONST', 'RESET', 'SET']);
  assert.deepEqual(bl[1].params, { areaId: 'hall', domains: ['light'], target: 'room' });
  assert.deepEqual(m.networks[0].wires.map(w => w.to.pin), ['IN', 'IN']);
  assert.equal(compileProgram(m).errors.length, 0);
  assert.equal(migrateLegacy(m), m, 'idempotent / unchanged programs keep identity');
});
