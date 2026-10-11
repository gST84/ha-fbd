// ───────────── Data types ─────────────
export type DataType = 'BOOL' | 'INT' | 'REAL' | 'STRING' | 'TIME'; // TIME = milliseconds
/** Pin types additionally allow generic pins (like ANY / ANY_NUM in IEC 61131-3). */
export type PinType = DataType | 'ANY' | 'ANY_NUM';
export type Value = boolean | number | string;

// ───────────── Program model (this is what gets saved as JSON) ─────────────
export interface Variable {
  name: string;
  type: DataType;
  /** 'retain' variables survive a restart (the host persists getRetained()). */
  kind: 'local' | 'retain';
  init?: Value;
}
export interface PinRef { block: string; pin: string }
export interface Wire { from: PinRef; to: PinRef }
export interface BlockInst {
  id: string;            // unique in the whole program
  type: string;          // key in the block registry
  x?: number;            // editor position
  y?: number;
  params?: Record<string, unknown>;
}
export interface Network { id: string; title: string; blocks: BlockInst[]; wires: Wire[] }
export interface Program { version: 1; name?: string; variables: Variable[]; networks: Network[] }

// ───────────── Block definitions ─────────────
export interface PinDef { name: string; type: PinType; default?: Value }

export interface EntityState { state: string; attributes: Record<string, unknown> }
/** The host (add-on) implements this on top of its Home Assistant websocket cache. */
export interface IOAdapter {
  getEntity(entityId: string): EntityState | undefined;
  /** Events that arrived since the previous scan (called once per scan, must hand each event out only once). */
  drainEvents?(): HAEvent[];
}
/** A Home Assistant bus event (state changes, button presses, custom events …). */
export interface HAEvent { type: string; data: Record<string, unknown> }

/** What the engine asks the host to do at the end of a scan. */
export type OutputCommand =
  | { kind: 'switch'; blockId: string; entityId: string; value: boolean }
  | { kind: 'value'; blockId: string; entityId: string; value: number }
  | { kind: 'attribute'; blockId: string; entityId: string; attribute: string; value: Value }
  | { kind: 'service'; blockId: string; service: string; entityId?: string; data: Record<string, unknown> }
  | { kind: 'event'; blockId: string; eventType: string; data: Record<string, unknown> }
  | { kind: 'area'; blockId: string; areaId?: string; floorId?: string; domains: string[]; action: 'turn_on' | 'turn_off' | 'toggle' };   // a room (areaId) or a whole zone (floorId)

export interface ExecContext {
  params: Record<string, unknown>;
  blockId: string;
  now: number;            // ms, monotonic
  dt: number;             // ms since previous scan (0 on first scan)
  firstScan: boolean;
  writeOnFirstScan: boolean;
  io: IOAdapter;
  /** Events delivered during this scan. */
  events: HAEvent[];
  /** Local wall-clock time of this scan (Home Assistant's time zone). */
  clock(): { msOfDay: number; weekday: number };
  readVar(name: string): Value;
  writeVar(name: string, value: Value): void;
  emit(cmd: OutputCommand): void;
}

export interface BlockDef<S = any> {
  type: string;
  category: string;
  description: string;
  /** Kept so old programs still run, but not offered in the palette. */
  hidden?: boolean;
  inputs(params: Record<string, unknown>): PinDef[];
  outputs(params: Record<string, unknown>): PinDef[];
  /** Create the instance memory (timers, counters, edge memory …). */
  init?(params: Record<string, unknown>): S;
  /** Return an error message to reject the block while compiling. */
  validate?(params: Record<string, unknown>, program: Program): string | undefined;
  exec(inputs: Record<string, Value>, state: S, ctx: ExecContext): Record<string, Value | undefined> | void;
}
