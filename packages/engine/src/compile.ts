import type { BlockDef, BlockInst, PinDef, Program, Value } from './types.js';
import { accepts, coerce, zeroOf } from './helpers.js';
import { registry } from './registry.js';

export interface CompileError { networkId?: string; blockId?: string; message: string }

export interface CompiledInput { pin: PinDef; src?: string; fallback: Value }
export interface CompiledBlock {
  inst: BlockInst; def: BlockDef; params: Record<string, unknown>;
  inputs: CompiledInput[]; outputs: PinDef[];
}
export interface CompileResult { blocks: CompiledBlock[]; errors: CompileError[] }

/** Validates the program and returns blocks in execution order (network by network, topologically sorted). */
export function compileProgram(program: Program): CompileResult {
  const errors: CompileError[] = [];
  const result: CompiledBlock[] = [];
  const seenIds = new Set<string>();
  const seenVars = new Set<string>();

  for (const v of program.variables) {
    if (seenVars.has(v.name)) errors.push({ message: `Duplicate variable "${v.name}"` });
    seenVars.add(v.name);
  }

  for (const net of program.networks) {
    const err = (message: string, blockId?: string) => errors.push({ networkId: net.id, blockId, message });
    type Node = { inst: BlockInst; def: BlockDef; params: Record<string, unknown>; ins: PinDef[]; outs: PinDef[]; idx: number };
    const nodes = new Map<string, Node>();

    net.blocks.forEach((inst, idx) => {
      if (seenIds.has(inst.id)) { err(`Duplicate block id "${inst.id}"`, inst.id); return; }
      seenIds.add(inst.id);
      const def = registry[inst.type];
      if (!def) { err(`Unknown block type "${inst.type}"`, inst.id); return; }
      const params = inst.params ?? {};
      const msg = def.validate?.(params, program);
      if (msg) err(msg, inst.id);
      nodes.set(inst.id, { inst, def, params, ins: def.inputs(params), outs: def.outputs(params), idx });
    });

    const driver = new Map<string, string>();         // "block.inputPin" → "block.outputPin"
    const deps = new Map<string, Set<string>>();      // block → blocks it depends on
    for (const id of nodes.keys()) deps.set(id, new Set());

    for (const w of net.wires) {
      const from = nodes.get(w.from.block), to = nodes.get(w.to.block);
      if (!from || !to) { err(`Wire ${w.from.block}.${w.from.pin} → ${w.to.block}.${w.to.pin} points to a missing block`); continue; }
      const outPin = from.outs.find(p => p.name === w.from.pin);
      const inPin = to.ins.find(p => p.name === w.to.pin);
      if (!outPin) { err(`Block ${from.inst.id} has no output "${w.from.pin}"`, from.inst.id); continue; }
      if (!inPin) { err(`Block ${to.inst.id} has no input "${w.to.pin}"`, to.inst.id); continue; }
      if (!accepts(inPin.type, outPin.type)) {
        err(`Type mismatch: ${outPin.type} output ${from.inst.id}.${outPin.name} → ${inPin.type} input ${to.inst.id}.${inPin.name}`, to.inst.id);
        continue;
      }
      const key = `${to.inst.id}.${inPin.name}`;
      if (driver.has(key)) { err(`Input ${key} already has a wire`, to.inst.id); continue; }
      driver.set(key, `${from.inst.id}.${outPin.name}`);
      deps.get(to.inst.id)!.add(from.inst.id);
    }

    // Kahn's algorithm, keeping the original block order when there is a choice.
    const remaining = new Set(nodes.keys());
    const ordered: string[] = [];
    while (remaining.size) {
      const ready = [...remaining]
        .filter(id => [...deps.get(id)!].every(d => !remaining.has(d)))
        .sort((a, b) => nodes.get(a)!.idx - nodes.get(b)!.idx);
      if (!ready.length) {
        err(`Algebraic loop between blocks: ${[...remaining].join(', ')}. Feed back through a variable instead.`);
        break;
      }
      ordered.push(ready[0]);
      remaining.delete(ready[0]);
    }

    for (const id of ordered) {
      const n = nodes.get(id)!;
      result.push({
        inst: n.inst, def: n.def, params: n.params, outputs: n.outs,
        inputs: n.ins.map(p => ({
          pin: p,
          src: driver.get(`${id}.${p.name}`),
          // Unconnected input: use the block param with the pin's name (e.g. PT = 5000), else the pin default.
          fallback: coerce(n.params[p.name] ?? p.default ?? zeroOf(p.type), p.type),
        })),
      });
    }
  }
  return { blocks: result, errors };
}
