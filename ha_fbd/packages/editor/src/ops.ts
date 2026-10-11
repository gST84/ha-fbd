// Pure, immutable edit operations on a Program. Everything the editor changes goes through here.
import { accepts, familyOf, registry, type BlockInst, type DataType, type Network, type PinRef, type Program, type Variable, type Wire } from '@ha-fbd/engine';
import { findFreeSpot, layout, snap, snapX } from './geometry';

export const emptyProgram = (name = 'New automation'): Program => ({
  version: 1, name, variables: [], networks: [{ id: 'net_1', title: '', blocks: [], wires: [] }],
});

/** Apply fn to one network. Returns the SAME program object when nothing changed (history relies on that). */
const mapNet = (p: Program, netId: string, fn: (n: Network) => Network): Program => {
  let changed = false;
  const networks = p.networks.map(n => {
    if (n.id !== netId) return n;
    const next = fn(n);
    if (next !== n) changed = true;
    return next;
  });
  return changed ? { ...p, networks } : p;
};

const allBlockIds = (p: Program) => new Set(p.networks.flatMap(n => n.blocks.map(b => b.id)));

export function nextBlockId(p: Program, type: string): string {
  const ids = allBlockIds(p);
  const base = type.toLowerCase();
  let n = 1;
  while (ids.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
function nextNetworkId(p: Program): string {
  let n = 1;
  while (p.networks.some(x => x.id === `net_${n}`)) n++;
  return `net_${n}`;
}

export function defaultParams(type: string, p: Program): Record<string, unknown> {
  switch (type) {
    case 'ENTITY_IN': return { entityId: '', dataType: 'BOOL' };
    case 'ENTITY_OUT': return { kind: 'switch', entityId: '' };
    case 'CONST': return { dataType: 'BOOL', value: false };
    case 'VAR_READ':
    case 'VAR_WRITE': { const v = p.variables[0]; return { name: v?.name ?? '', varType: v?.type ?? 'BOOL' }; }
    case 'SET':
    case 'RESET':
    case 'TOGGLE': return { target: 'variable', name: p.variables.find(v => v.type === 'BOOL')?.name ?? '', varType: 'BOOL' };
    case 'EVENT_IN': return { eventType: '' };
    case 'EVENT_OUT': return { eventType: '' };
    case 'TIME_OF_DAY': return { start: '22:00', end: '06:00' };
    default: return {};
  }
}

/** Remove wires that point to blocks or pins that no longer exist (e.g. after inputCount was lowered). */
function pruneWires(n: Network): Network {
  const byId = new Map(n.blocks.map(b => [b.id, b]));
  const wires = n.wires.filter(w => {
    const from = byId.get(w.from.block), to = byId.get(w.to.block);
    const d1 = from && registry[from.type], d2 = to && registry[to.type];
    if (!from || !to || !d1 || !d2) return false;
    return d1.outputs(from.params ?? {}).some(p => p.name === w.from.pin) && d2.inputs(to.params ?? {}).some(p => p.name === w.to.pin);
  });
  return wires.length === n.wires.length ? n : { ...n, wires };
}

export function addBlock(p: Program, netId: string, type: string, x?: number, y?: number, params?: Record<string, unknown>, maxRight?: number): { program: Program; id: string } {
  const id = nextBlockId(p, type);
  const net = p.networks.find(n => n.id === netId);
  if (!net || !registry[type]) return { program: p, id: '' };
  const inst: BlockInst = { id, type, params: params ?? defaultParams(type, p) };
  const l = layout(inst);
  const pos = x === undefined || y === undefined ? findFreeSpot(net.blocks, l.w, l.h, maxRight) : { x: snapX(x), y: snap(y) };
  inst.x = pos.x; inst.y = pos.y;
  return { program: mapNet(p, netId, n => ({ ...n, blocks: [...n.blocks, inst] })), id };
}

export const moveBlock = (p: Program, netId: string, id: string, x: number, y: number): Program =>
  mapNet(p, netId, n => {
    const b = n.blocks.find(b => b.id === id);
    if (!b || (b.x === x && b.y === y)) return n;
    return { ...n, blocks: n.blocks.map(b => (b.id === id ? { ...b, x, y } : b)) };
  });

/** Merge `patch` into params; a value of `undefined` removes the key. */
export function setParams(p: Program, netId: string, id: string, patch: Record<string, unknown>): Program {
  return mapNet(p, netId, n => {
    const blocks = n.blocks.map(b => {
      if (b.id !== id) return b;
      const params = { ...(b.params ?? {}) };
      for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete params[k]; else params[k] = v; }
      return { ...b, params };
    });
    return pruneWires({ ...n, blocks });
  });
}

export const deleteBlock = (p: Program, netId: string, id: string): Program =>
  mapNet(p, netId, n => ({
    ...n, blocks: n.blocks.filter(b => b.id !== id),
    wires: n.wires.filter(w => w.from.block !== id && w.to.block !== id),
  }));

/** Connect an output to an input. Replaces whatever drove that input. Returns the same object if not allowed. */
export function addWire(p: Program, netId: string, from: PinRef, to: PinRef): Program {
  const net = p.networks.find(n => n.id === netId);
  if (!net || from.block === to.block) return p;
  const fb = net.blocks.find(b => b.id === from.block), tb = net.blocks.find(b => b.id === to.block);
  if (!fb || !tb) return p;
  const outPin = registry[fb.type]?.outputs(fb.params ?? {}).find(x => x.name === from.pin);
  const inPin = registry[tb.type]?.inputs(tb.params ?? {}).find(x => x.name === to.pin);
  if (!outPin || !inPin || !accepts(inPin.type, outPin.type)) return p;
  return mapNet(p, netId, n => ({
    ...n, wires: [...n.wires.filter(w => !(w.to.block === to.block && w.to.pin === to.pin)), { from, to }],
  }));
}

export const deleteWire = (p: Program, netId: string, to: PinRef): Program =>
  mapNet(p, netId, n => ({ ...n, wires: n.wires.filter(w => !(w.to.block === to.block && w.to.pin === to.pin)) }));

// ───────── networks ─────────
export function addNetwork(p: Program): Program {
  const id = nextNetworkId(p);
  return { ...p, networks: [...p.networks, { id, title: '', blocks: [], wires: [] }] };
}
export const deleteNetwork = (p: Program, id: string): Program =>
  p.networks.length <= 1 ? p : { ...p, networks: p.networks.filter(n => n.id !== id) };
export function moveNetwork(p: Program, id: string, dir: -1 | 1): Program {
  const i = p.networks.findIndex(n => n.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= p.networks.length) return p;
  const list = [...p.networks]; [list[i], list[j]] = [list[j], list[i]];
  return { ...p, networks: list };
}
export const renameNetwork = (p: Program, id: string, title: string): Program =>
  mapNet(p, id, n => ({ ...n, title }));

// ───────── variables ─────────
export function addVariable(p: Program): Program {
  let n = 1;
  while (p.variables.some(v => v.name === `var_${n}`)) n++;
  return { ...p, variables: [...p.variables, { name: `var_${n}`, type: 'BOOL', kind: 'local', init: false }] };
}

const zeroOf = (t: DataType) => (t === 'BOOL' ? false : t === 'STRING' ? '' : 0);

/** Update a variable; renames and type changes are propagated into VAR_READ / VAR_WRITE blocks. */
export function updateVariable(p: Program, index: number, patch: Partial<Variable>): Program {
  const old = p.variables[index];
  if (!old) return p;
  const next: Variable = { ...old, ...patch };
  if (patch.type && patch.type !== old.type && patch.init === undefined) next.init = zeroOf(patch.type);
  let out: Program = { ...p, variables: p.variables.map((v, i) => (i === index ? next : v)) };
  if (next.name !== old.name || next.type !== old.type) {
    out = {
      ...out,
      networks: out.networks.map(n => pruneWires({
        ...n,
        blocks: n.blocks.map(b =>
          (b.type === 'VAR_READ' || b.type === 'VAR_WRITE') && b.params?.name === old.name
            ? { ...b, params: { ...b.params, name: next.name, varType: next.type } } : b),
      })),
    };
  }
  return out;
}
export const deleteVariable = (p: Program, index: number): Program =>
  ({ ...p, variables: p.variables.filter((_, i) => i !== index) });

// ───────── several blocks at once ─────────
export function moveBlocks(p: Program, netId: string, moves: Record<string, { x: number; y: number }>): Program {
  return mapNet(p, netId, n => {
    let changed = false;
    const blocks = n.blocks.map(b => {
      const m = moves[b.id];
      if (!m || (b.x === m.x && b.y === m.y)) return b;
      changed = true;
      return { ...b, x: m.x, y: m.y };
    });
    return changed ? { ...n, blocks } : n;
  });
}

export function deleteBlocks(p: Program, netId: string, ids: string[]): Program {
  const set = new Set(ids);
  return mapNet(p, netId, n => ({
    ...n, blocks: n.blocks.filter(b => !set.has(b.id)),
    wires: n.wires.filter(w => !set.has(w.from.block) && !set.has(w.to.block)),
  }));
}

// ───────── copy / paste ─────────
export interface Clip { blocks: BlockInst[]; wires: Wire[] }

/** Copy blocks together with the wires that run between them. */
export function copyBlocks(p: Program, netId: string, ids: string[]): Clip | null {
  const net = p.networks.find(n => n.id === netId);
  if (!net) return null;
  const set = new Set(ids);
  const blocks = net.blocks.filter(b => set.has(b.id));
  if (!blocks.length) return null;
  return structuredClone({ blocks, wires: net.wires.filter(w => set.has(w.from.block) && set.has(w.to.block)) });
}

/** Paste a clip into a network, shifted by (dx, dy). New unique ids, wires between the copies are kept. */
export function pasteClip(p: Program, netId: string, clip: Clip, dx: number, dy: number): { program: Program; ids: string[] } {
  if (!p.networks.some(n => n.id === netId)) return { program: p, ids: [] };
  const taken = allBlockIds(p);
  const map = new Map<string, string>();
  const blocks = clip.blocks.map(b => {
    const base = b.type.toLowerCase();
    let n = 1;
    while (taken.has(`${base}_${n}`)) n++;
    const id = `${base}_${n}`;
    taken.add(id); map.set(b.id, id);
    return { ...structuredClone(b), id, x: snapX((b.x ?? 0) + dx), y: snap((b.y ?? 0) + dy) };
  });
  const wires = clip.wires.map(w => ({ from: { block: map.get(w.from.block)!, pin: w.from.pin }, to: { block: map.get(w.to.block)!, pin: w.to.pin } }));
  return {
    program: mapNet(p, netId, n => ({ ...n, blocks: [...n.blocks, ...blocks], wires: [...n.wires, ...wires] })),
    ids: blocks.map(b => b.id),
  };
}

// ───────── change the type of a block (AND → OR …) ─────────
/**
 * Swap a block for another one of its family. Wires and constants are kept where the pin still exists
 * (matched by name, otherwise by position); wires that no longer fit are dropped. The block gets a fresh id.
 */
export function changeBlockType(p: Program, netId: string, id: string, newType: string): { program: Program; id: string } {
  const net = p.networks.find(n => n.id === netId);
  const b = net?.blocks.find(x => x.id === id);
  const oldDef = b && registry[b.type], newDef = registry[newType];
  if (!net || !b || !oldDef || !newDef || b.type === newType || !familyOf(b.type).includes(newType)) return { program: p, id };

  const old = b.params ?? {};
  const oldIn = oldDef.inputs(old), oldOut = oldDef.outputs(old);
  const pinNames = new Set(oldIn.map(x => x.name));
  const params: Record<string, unknown> = Object.fromEntries(Object.entries(old).filter(([k]) => !pinNames.has(k)));
  const newIn = newDef.inputs(params), newOut = newDef.outputs(params);

  const mapper = (from: { name: string }[], to: { name: string }[]) => {
    const used = new Set<string>(); const out = new Map<string, string>();
    from.forEach((pin, i) => {
      const target = to.find(t => t.name === pin.name) ?? to[i];
      if (target && !used.has(target.name)) { used.add(target.name); out.set(pin.name, target.name); }
    });
    return out;
  };
  const inMap = mapper(oldIn, newIn), outMap = mapper(oldOut, newOut);
  for (const [oldName, newName] of inMap) if (old[oldName] !== undefined) params[newName] = old[oldName];   // constants follow their pin

  const newId = nextBlockId(p, newType);
  const typeOf = (blockId: string, side: 'in' | 'out', pin: string) => {
    const blk = blockId === newId ? { type: newType, params } : net.blocks.find(x => x.id === blockId);
    const d = blk && registry[blk.type];
    return d && (side === 'in' ? d.inputs(blk!.params ?? {}) : d.outputs(blk!.params ?? {})).find(x => x.name === pin)?.type;
  };
  const wires: Wire[] = [];
  for (const w of net.wires) {
    const from = w.from.block === id ? { block: newId, pin: outMap.get(w.from.pin) } : w.from;
    const to = w.to.block === id ? { block: newId, pin: inMap.get(w.to.pin) } : w.to;
    if (!from.pin || !to.pin) continue;
    const ft = typeOf(from.block, 'out', from.pin), tt = typeOf(to.block, 'in', to.pin);
    if (ft && tt && accepts(tt, ft)) wires.push({ from: { block: from.block, pin: from.pin }, to: { block: to.block, pin: to.pin } });
  }
  const program = mapNet(p, netId, n => ({
    ...n, blocks: n.blocks.map(x => (x.id === id ? { ...x, id: newId, type: newType, params } : x)), wires,
  }));
  return { program, id: newId };
}

/** Programs saved by older versions: the separate ROOM OUT block (AREA_OUT) became SET / RESET with target "room". */
export function migrateLegacy(p: Program): Program {
  if (!p.networks.some(n => n.blocks.some(b => b.type === 'AREA_OUT'))) return p;
  return {
    ...p,
    networks: p.networks.map(n => {
      const old = new Set(n.blocks.filter(b => b.type === 'AREA_OUT').map(b => b.id));
      if (old.size === 0) return n;
      return {
        ...n,
        blocks: n.blocks.map(b => {
          if (b.type !== 'AREA_OUT') return b;
          const { action, EN, ...rest } = (b.params ?? {}) as Record<string, unknown>;
          return { ...b, type: action === 'turn_on' ? 'SET' : 'RESET', params: { ...rest, target: 'room', ...(EN !== undefined ? { IN: EN } : {}) } };
        }),
        wires: n.wires.map(w => (old.has(w.to.block) ? { ...w, to: { ...w.to, pin: 'IN' } } : w)),
      };
    }),
  };
}

export const setName = (p: Program, name: string): Program => (p.name === name ? p : { ...p, name });
