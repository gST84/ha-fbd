import { EventEmitter } from 'node:events';
import { ProgramHost, type HAPort } from './host.js';
import { silentLogger, type Logger } from './log.js';
import { emptyProgram, ID_RE, type Store } from './store.js';
import type { Program } from '@ha-fbd/engine';

export interface ManagerOptions { ha: HAPort; store: Store; scanMs?: number; writeOnFirstScan?: boolean; log?: Logger }
export interface AutomationSummary {
  id: string; name: string; running: boolean; blocks: number; networks: number; problems: number;
  avgMs: number; overruns: number; scans: number;
}

const slug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'automation';

/** Owns every automation: each one has its own program, variables, runtime and scan loop. */
export class AutomationManager extends EventEmitter {
  private readonly hosts = new Map<string, ProgramHost>();
  private readonly log: Logger;

  constructor(private readonly opts: ManagerOptions) {
    super();
    this.log = opts.log ?? silentLogger;
  }

  get ha(): HAPort { return this.opts.ha; }

  async init(): Promise<void> {
    const { store } = this.opts;
    // Upgrade from the single-program versions: that program becomes the first automation.
    if ((await store.listIds()).length === 0) {
      const legacy = await store.takeLegacy();
      if (legacy) {
        const program: Program = { ...legacy.program, name: legacy.program.name ?? 'My first automation' };
        await store.saveProgram('default', program);
        await store.saveState('default', legacy.state);
        this.log.info('Migrated the existing program to the automation "default"');
      }
    }
    for (const id of await store.listIds()) {
      const host = this.makeHost(id);
      this.hosts.set(id, host);
      await host.init();
    }
    this.syncEvents();
  }

  private makeHost(id: string): ProgramHost {
    const host = new ProgramHost({ ...this.opts, id });
    host.on('events-changed', () => this.syncEvents());
    return host;
  }

  /** Tell Home Assistant which bus events the running automations need. */
  private syncEvents(): void {
    const all = new Set<string>();
    for (const h of this.hosts.values()) for (const t of h.eventTypes()) all.add(t);
    this.opts.ha.setEventTypes(all);
  }

  get(id: string): ProgramHost | undefined { return this.hosts.get(id); }
  get size(): number { return this.hosts.size; }

  list(): AutomationSummary[] {
    return [...this.hosts.values()].map(h => {
      const st = h.status();
      return {
        id: h.id, name: h.name, running: st.running, blocks: st.blocks, networks: h.program?.networks.length ?? 0,
        problems: h.program ? h.validate(h.program).length : 0,
        avgMs: st.stats.avgMs, overruns: st.overruns, scans: st.stats.scans,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  private uniqueId(base: string): string {
    let id = base, n = 2;
    while (this.hosts.has(id)) id = `${base}-${n++}`;
    return id;
  }

  async create(name: string, from?: Program): Promise<ProgramHost> {
    const clean = name.trim().slice(0, 80) || 'New automation';
    const id = this.uniqueId(slug(clean));
    if (!ID_RE.test(id)) throw new Error('Cannot derive an id from that name');
    const program: Program = from ? { ...structuredClone(from), name: clean } : emptyProgram(clean);
    await this.opts.store.saveProgram(id, program);
    const host = this.makeHost(id);
    this.hosts.set(id, host);
    await host.init();
    return host;
  }

  async duplicate(id: string): Promise<ProgramHost | undefined> {
    const src = this.hosts.get(id);
    if (!src?.program) return undefined;
    return this.create(`${src.name} (copy)`, src.program);     // copies start stopped
  }

  async remove(id: string): Promise<boolean> {
    const host = this.hosts.get(id);
    if (!host) return false;
    host.dispose();
    this.hosts.delete(id);
    await this.opts.store.deleteAutomation(id);
    this.syncEvents();
    return true;
  }

  async stopAll(): Promise<void> {
    for (const h of this.hosts.values()) await h.shutdown();
  }
}
