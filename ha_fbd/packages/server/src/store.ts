import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Program, Value } from '@ha-fbd/engine';

export const emptyProgram = (name = 'New automation'): Program => ({
  version: 1, name,
  variables: [],
  networks: [{ id: 'net_1', title: '', blocks: [], wires: [] }],
});

export interface PersistedState { running: boolean; retained: Record<string, Value> }
export const ID_RE = /^[a-z0-9_-]{1,64}$/;

/**
 * JSON files in the add-on's /data folder (included in HA backups). Writes are atomic.
 *   automations/<id>.json   the program (with its name)
 *   state/<id>.json         running flag + retained variables
 */
export class Store {
  constructor(private readonly dir: string) {}

  private file(...parts: string[]) { return path.join(this.dir, ...parts); }
  private checkId(id: string) { if (!ID_RE.test(id)) throw new Error(`Invalid automation id "${id}"`); }

  private async readJson<T>(file: string): Promise<T | undefined> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; } catch { return undefined; }
  }
  private async writeJson(file: string, data: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, file);
  }

  async listIds(): Promise<string[]> {
    try {
      return (await fs.readdir(this.file('automations'))).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(id => ID_RE.test(id)).sort();
    } catch { return []; }
  }
  async loadProgram(id: string): Promise<Program | undefined> { this.checkId(id); return this.readJson(this.file('automations', `${id}.json`)); }
  async saveProgram(id: string, p: Program): Promise<void> { this.checkId(id); return this.writeJson(this.file('automations', `${id}.json`), p); }
  async loadState(id: string): Promise<PersistedState> {
    this.checkId(id);
    return (await this.readJson<PersistedState>(this.file('state', `${id}.json`))) ?? { running: false, retained: {} };
  }
  async saveState(id: string, s: PersistedState): Promise<void> { this.checkId(id); return this.writeJson(this.file('state', `${id}.json`), s); }
  async deleteAutomation(id: string): Promise<void> {
    this.checkId(id);
    await fs.rm(this.file('automations', `${id}.json`), { force: true });
    await fs.rm(this.file('state', `${id}.json`), { force: true });
  }

  /** Version 0.1/0.2 stored ONE program in program.json + state.json. Hand it over once and rename the files. */
  async takeLegacy(): Promise<{ program: Program; state: PersistedState } | undefined> {
    const program = await this.readJson<Program>(this.file('program.json'));
    if (!program) return undefined;
    const state = (await this.readJson<PersistedState>(this.file('state.json'))) ?? { running: false, retained: {} };
    await fs.rename(this.file('program.json'), this.file('program.json.migrated')).catch(() => {});
    await fs.rename(this.file('state.json'), this.file('state.json.migrated')).catch(() => {});
    return { program, state };
  }
}
