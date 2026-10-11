import { EventEmitter } from 'node:events';
import {
  CompileFailed, CyclicScheduler, Runtime, compileProgram, domainOf, isOnState,
  type CompileError, type HAEvent, type IOAdapter, type OutputCommand, type Program, type ScanResult, type Value,
} from '@ha-fbd/engine';
import { commandToServiceCall } from './commands.js';
import type { AreaInfo, FloorInfo, HAEntity, HAStatus } from './ha-client.js';
import { silentLogger, type Logger } from './log.js';
import { emptyProgram, type Store } from './store.js';

/** What the host needs from the Home Assistant client (HAClient implements this). */
export interface HAPort extends IOAdapter {
  readonly status: HAStatus;
  readonly timeZone?: string;
  callService(domain: string, service: string, data?: Record<string, unknown>, entityId?: string, target?: Record<string, unknown>): Promise<unknown>;
  getAreas(): Promise<AreaInfo[]>;
  getFloors(): Promise<FloorInfo[]>;
  listEntities(): HAEntity[];
  fireEvent(eventType: string, data?: Record<string, unknown>): Promise<unknown>;
  setEventTypes(types: Iterable<string>): void;
  on(event: 'connected' | 'ha_event', fn: (...args: any[]) => void): unknown;
  off(event: 'connected' | 'ha_event', fn: (...args: any[]) => void): unknown;
}

export interface HostOptions {
  id: string;
  ha: HAPort;
  store: Store;
  scanMs?: number;
  writeOnFirstScan?: boolean;
  log?: Logger;
}
export interface LogEntry { t: number; level: 'info' | 'warning' | 'error'; msg: string }
export interface WatchFrame {
  scan: number; durationMs: number; values: Record<string, Value>; variables: Record<string, Value>;
  errors: ScanResult['errors']; commands: number;
}

/** Light structural check so malformed JSON from a client can never crash the compiler. */
export function checkShape(p: unknown): string | undefined {
  const o = p as Program | null;
  if (!o || typeof o !== 'object') return 'Program must be an object';
  if (o.version !== 1) return 'Program.version must be 1';
  if (!Array.isArray(o.variables)) return 'Program.variables must be an array';
  if (!Array.isArray(o.networks)) return 'Program.networks must be an array';
  for (const n of o.networks) {
    if (!n || typeof n.id !== 'string' || !Array.isArray(n.blocks) || !Array.isArray(n.wires)) return 'Every network needs id, blocks[] and wires[]';
    for (const b of n.blocks) if (!b || typeof b.id !== 'string' || typeof b.type !== 'string') return 'Every block needs id and type';
    for (const w of n.wires) if (!w?.from || !w?.to) return 'Every wire needs from and to';
  }
  for (const v of o.variables) if (!v || typeof v.name !== 'string' || typeof v.type !== 'string') return 'Every variable needs name and type';
  return undefined;
}

export class ProgramHost extends EventEmitter {
  program: Program | undefined;
  running = false;
  readonly stats = { scans: 0, lastMs: 0, avgMs: 0, maxMs: 0 };
  private runtime?: Runtime;
  private scheduler?: CyclicScheduler;
  private retained: Record<string, Value> = {};
  private lastPersisted = '';
  private persistTimer?: ReturnType<typeof setInterval>;
  private lastOutputs = new Map<string, OutputCommand>();
  private lastErrors: ScanResult['errors'] = [];
  private readonly logRing: LogEntry[] = [];
  private readonly log: Logger;
  private readonly scanMs: number;
  private eventQueue: HAEvent[] = [];
  private wantedEvents = new Set<string>();
  /** What the runtime sees: entity cache + the events that arrived since the last scan. */
  private readonly io: IOAdapter = {
    getEntity: id => this.opts.ha.getEntity(id),
    drainEvents: () => this.eventQueue.splice(0),
  };
  private readonly onConnected = () => { for (const cmd of this.lastOutputs.values()) void this.exec(cmd); };
  private readonly onHaEvent = (type: string, data: Record<string, unknown>) => {
    if (!this.running || !this.wantedEvents.has(type)) return;
    this.eventQueue.push({ type, data });
    if (this.eventQueue.length > 500) this.eventQueue.shift();
  };

  constructor(private readonly opts: HostOptions) {
    super();
    this.log = opts.log ?? silentLogger;
    this.scanMs = opts.scanMs ?? 100;
    // After a Home Assistant reconnect, write the current output state again (writes in between were lost).
    opts.ha.on('connected', this.onConnected);
    opts.ha.on('ha_event', this.onHaEvent);
  }

  get id(): string { return this.opts.id; }
  get name(): string { return this.program?.name?.trim() || this.opts.id; }

  /** Event types this automation listens to (only while it runs). */
  eventTypes(): Set<string> { return this.running ? new Set(this.wantedEvents) : new Set(); }

  /** Stop listening to Home Assistant (the automation was deleted). */
  dispose(): void {
    this.stopInternal(false);
    this.opts.ha.off('connected', this.onConnected);
    this.opts.ha.off('ha_event', this.onHaEvent);
  }

  async init(): Promise<void> {
    this.program = (await this.opts.store.loadProgram(this.id)) ?? emptyProgram(this.id);
    const st = await this.opts.store.loadState(this.id);
    this.retained = st.retained ?? {};
    if (st.running) {
      try { this.start(); } catch (e) { this.note('error', `Auto-start failed: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  validate(p: unknown): CompileError[] {
    const shape = checkShape(p);
    if (shape) return [{ message: shape }];
    return compileProgram(p as Program).errors;
  }

  /** Save as draft without running (editor autosave). */
  async save(p: Program): Promise<void> {
    this.program = p;
    await this.opts.store.saveProgram(this.id, p);
  }

  async deploy(p: Program): Promise<{ ok: true } | { ok: false; errors: CompileError[] }> {
    const errors = this.validate(p);
    if (errors.length) return { ok: false, errors };
    await this.save(p);
    this.stopInternal(false);
    this.start();
    return { ok: true };
  }

  start(): void {
    if (!this.program) throw new Error('No program loaded');
    this.stopInternal(false);
    const runtime = new Runtime(this.program, {   // throws CompileFailed
      io: this.io, writeOnFirstScan: this.opts.writeOnFirstScan ?? true,
      timeZone: () => this.opts.ha.timeZone,
    });
    this.wantedEvents = new Set(this.program.networks.flatMap(n => n.blocks)
      .filter(b => b.type === 'EVENT_IN' && typeof b.params?.eventType === 'string').map(b => String(b.params!.eventType)));
    this.eventQueue = [];
    runtime.loadRetained(this.retained);
    this.runtime = runtime;
    this.lastOutputs.clear();
    this.stats.scans = 0; this.stats.avgMs = 0; this.stats.maxMs = 0;
    this.scheduler = new CyclicScheduler(runtime, this.scanMs, r => this.onScan(r), e => this.note('error', `Scan crashed: ${String(e)}`));
    this.running = true;
    this.scheduler.start();
    this.emit('events-changed');
    this.persistTimer = setInterval(() => void this.persist(), 5000);
    this.note('info', `Program started (${this.scanMs} ms scan)`);
    void this.persist();
  }

  async stop(): Promise<void> {
    this.stopInternal(true);
    await this.persist();
  }

  /** Add-on is shutting down: stop scanning but REMEMBER that the program was running, so it restarts with the add-on. */
  async shutdown(): Promise<void> {
    const was = this.running;
    this.stopInternal(false);
    await this.persist(was);
  }

  private stopInternal(log: boolean): void {
    const wasRunning = this.running;
    this.scheduler?.stop();
    clearInterval(this.persistTimer);
    if (this.runtime) this.retained = { ...this.retained, ...this.runtime.getRetained() };
    this.running = false;
    this.scheduler = undefined;
    if (wasRunning) this.emit('events-changed');
    if (wasRunning && log) this.note('info', 'Program stopped');
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      running: this.running,
      ha: this.opts.ha.status,
      entities: this.opts.ha.listEntities().length,
      scanMs: this.scanMs,
      overruns: this.scheduler?.overruns ?? 0,
      stats: { ...this.stats },
      errors: this.lastErrors,
      blocks: this.program?.networks.reduce((n, net) => n + net.blocks.length, 0) ?? 0,
    };
  }
  getLog(): LogEntry[] { return [...this.logRing]; }
  listEntities(): HAEntity[] { return this.opts.ha.listEntities(); }

  // ───────── internals ─────────
  private onScan(r: ScanResult): void {
    const s = this.stats;
    s.scans = r.scan; s.lastMs = r.durationMs; s.maxMs = Math.max(s.maxMs, r.durationMs);
    s.avgMs = s.avgMs === 0 ? r.durationMs : s.avgMs * 0.95 + r.durationMs * 0.05;
    if (r.errors.length && JSON.stringify(r.errors) !== JSON.stringify(this.lastErrors)) {
      for (const e of r.errors) this.note('error', `Block ${e.blockId}: ${e.message}`);
    }
    this.lastErrors = r.errors;
    for (const cmd of r.commands) {
      // remember the last state written per entity so it can be re-sent after a Home Assistant restart
      if (cmd.kind === 'switch' || cmd.kind === 'value') this.lastOutputs.set(`${cmd.kind}:${cmd.entityId}`, cmd);
      else if (cmd.kind === 'attribute') this.lastOutputs.set(`attr:${cmd.attribute}:${cmd.entityId}`, cmd);
      void this.exec(cmd);
    }
    if (this.listenerCount('scan') > 0) {
      const frame: WatchFrame = {
        scan: r.scan, durationMs: r.durationMs, values: r.values,
        variables: this.runtime?.getVariables() ?? {}, errors: r.errors, commands: r.commands.length,
      };
      this.emit('scan', frame);
    }
  }

  private async exec(cmd: OutputCommand): Promise<void> {
    try {
      if (cmd.kind === 'event') { await this.opts.ha.fireEvent(cmd.eventType, cmd.data); return; }
      if (cmd.kind === 'area') {      // one call per kind of device; Home Assistant resolves the room (or the whole zone / floor) itself
        const action = cmd.action === 'toggle' ? (await this.anyOn(cmd) ? 'turn_off' : 'turn_on') : cmd.action;
        const results = await Promise.allSettled(cmd.domains.map(d => this.opts.ha.callService(d, action, {}, undefined, cmd.floorId ? { floor_id: cmd.floorId } : { area_id: cmd.areaId })));
        const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed) throw failed.reason;
        return;
      }
      const c = commandToServiceCall(cmd);
      await this.opts.ha.callService(c.domain, c.service, c.data, c.entityId);
      this.log.debug(`${c.domain}.${c.service} ${c.entityId ?? ''} ${JSON.stringify(c.data)}`);
    } catch (e) {
      this.note('warning', `Output ${cmd.blockId} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** TOGGLE on a room / zone: is at least one of the selected kinds of devices on right now? */
  private async anyOn(cmd: Extract<OutputCommand, { kind: 'area' }>): Promise<boolean> {
    const areas = (await this.opts.ha.getAreas()).filter(a => (cmd.floorId ? a.floorId === cmd.floorId : a.id === cmd.areaId));
    return areas.flatMap(a => a.entities).some(e => cmd.domains.includes(domainOf(e)) && isOnState(e, this.opts.ha.getEntity(e)?.state));
  }

  private async persist(running = this.running): Promise<void> {
    if (this.runtime) this.retained = { ...this.retained, ...this.runtime.getRetained() };
    const state = { running, retained: this.retained };
    const json = JSON.stringify(state);
    if (json === this.lastPersisted) return;
    this.lastPersisted = json;
    try { await this.opts.store.saveState(this.id, state); } catch (e) { this.log.error(`Cannot persist state: ${String(e)}`); }
  }

  private note(level: LogEntry['level'], msg: string): void {
    this.logRing.push({ t: Date.now(), level, msg });
    if (this.logRing.length > 200) this.logRing.shift();
    if (level === 'error') this.log.error(msg); else if (level === 'warning') this.log.warn(msg); else this.log.info(msg);
  }
}

export { CompileFailed };
