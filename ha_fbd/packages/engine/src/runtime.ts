import { compileProgram, type CompileError, type CompiledBlock } from './compile.js';
import { clockInfo, coerce, zeroOf, type ClockInfo } from './helpers.js';
import type { IOAdapter, OutputCommand, Program, Value } from './types.js';

export class CompileFailed extends Error {
  constructor(public readonly errors: CompileError[]) {
    super(`Program has ${errors.length} error(s):\n` + errors.map(e => `  - ${e.blockId ? `[${e.blockId}] ` : ''}${e.message}`).join('\n'));
  }
}

export interface RuntimeOptions {
  io: IOAdapter;
  /** Monotonic clock in ms (inject a fake one in tests). */
  now?: () => number;
  /** Emit output commands during the very first scan (PLC behaviour). Default true. */
  writeOnFirstScan?: boolean;
  /** Wall clock (inject a fake one in tests). */
  clock?: () => Date;
  /** IANA time zone used for time-of-day blocks (Home Assistant's zone). May be a function because HA connects later. */
  timeZone?: string | (() => string | undefined);
}

export interface ScanResult {
  scan: number;
  durationMs: number;
  /** Output commands for the host to execute (already de-duplicated: changes / edges only). */
  commands: OutputCommand[];
  /** Every block output of this scan, key = "blockId.PIN" (for live watch in the editor). */
  values: Record<string, Value>;
  errors: { blockId: string; message: string }[];
}

export class Runtime {
  private readonly blocks: CompiledBlock[];
  private readonly states = new Map<string, unknown>();
  private readonly vars = new Map<string, Value>();
  private readonly now: () => number;
  private scanCount = 0;
  private lastNow: number | undefined;

  constructor(readonly program: Program, private readonly opts: RuntimeOptions) {
    const { blocks, errors } = compileProgram(program);
    if (errors.length) throw new CompileFailed(errors);
    this.blocks = blocks;
    this.now = opts.now ?? (() => performance.now());
    this.reset();
  }

  /** Back to initial state (variables to init values, all block memory cleared). */
  reset(): void {
    this.scanCount = 0;
    this.lastNow = undefined;
    this.states.clear();
    this.vars.clear();
    for (const v of this.program.variables) this.vars.set(v.name, coerce(v.init ?? zeroOf(v.type), v.type));
    for (const b of this.blocks) if (b.def.init) this.states.set(b.inst.id, b.def.init(b.params));
  }

  getVariable(name: string): Value | undefined { return this.vars.get(name); }
  getVariables(): Record<string, Value> { return Object.fromEntries(this.vars); }

  /** Values of 'retain' variables – persist these and pass them back to loadRetained() after a restart. */
  getRetained(): Record<string, Value> {
    const out: Record<string, Value> = {};
    for (const v of this.program.variables) if (v.kind === 'retain') out[v.name] = this.vars.get(v.name)!;
    return out;
  }
  loadRetained(data: Record<string, Value>): void {
    for (const v of this.program.variables) {
      if (v.kind === 'retain' && v.name in data) this.vars.set(v.name, coerce(data[v.name], v.type));
    }
  }

  /** One PLC scan: read inputs → evaluate all blocks → commit variables → return commands. */
  scan(): ScanResult {
    const t0 = performance.now();
    const now = this.now();
    const dt = this.lastNow === undefined ? 0 : now - this.lastNow;
    this.lastNow = now;
    const firstScan = this.scanCount === 0;

    const readImage = new Map(this.vars);      // variables as they were at scan start
    const writeImage = new Map<string, Value>();
    const commands: OutputCommand[] = [];
    const errors: ScanResult['errors'] = [];
    const values: Record<string, Value> = {};
    const events = this.opts.io.drainEvents?.() ?? [];   // each event is delivered to exactly one scan
    let clockMemo: ClockInfo | undefined;
    const clock = () => (clockMemo ??= clockInfo(this.opts.clock?.() ?? new Date(), typeof this.opts.timeZone === 'function' ? this.opts.timeZone() : this.opts.timeZone));

    for (const b of this.blocks) {
      const inputs: Record<string, Value> = {};
      for (const inp of b.inputs) {
        inputs[inp.pin.name] = inp.src !== undefined ? (values[inp.src] ?? inp.fallback) : inp.fallback;
      }
      let out: Record<string, Value | undefined> = {};
      try {
        out = b.def.exec(inputs, this.states.get(b.inst.id), {
          params: b.params, blockId: b.inst.id, now, dt, firstScan,
          writeOnFirstScan: this.opts.writeOnFirstScan ?? true,
          io: this.opts.io, events, clock,
          readVar: name => readImage.get(name) ?? false,
          writeVar: (name, v) => { writeImage.set(name, v); },
          emit: cmd => { commands.push(cmd); },
        }) ?? {};
      } catch (e) {
        errors.push({ blockId: b.inst.id, message: e instanceof Error ? e.message : String(e) });
      }
      for (const p of b.outputs) {
        const raw = out[p.name];
        values[`${b.inst.id}.${p.name}`] = raw === undefined ? zeroOf(p.type) : p.type === 'ANY' ? raw : coerce(raw, p.type);
      }
    }

    for (const [name, v] of writeImage) {
      const decl = this.program.variables.find(x => x.name === name);
      if (decl) this.vars.set(name, coerce(v, decl.type));
    }

    this.scanCount++;
    return { scan: this.scanCount, durationMs: performance.now() - t0, commands, values, errors };
  }
}
