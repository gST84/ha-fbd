import { EventEmitter } from 'node:events';
import type { EntityState, IOAdapter } from '@ha-fbd/engine';
import { silentLogger, type Logger } from './log.js';

export interface HAEntity extends EntityState { entity_id: string }
/** A room (Home Assistant area) with the entities that live in it (directly or through their device). */
export interface AreaInfo { id: string; name: string; entities: string[] }

/** The tiny subset of the WebSocket API we use (Node's global WebSocket and the `ws` package both fit). */
export interface WSLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}
export type HAStatus = 'disconnected' | 'connecting' | 'connected' | 'auth_failed';

export interface HAClientOptions {
  url: string;                       // ws://supervisor/core/websocket  or  ws://host:8123/api/websocket
  token: string;
  wsFactory?: (url: string) => WSLike;
  minRetryMs?: number;
  maxRetryMs?: number;
  pingMs?: number;
  log?: Logger;
}

interface Pending { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }

/**
 * Minimal Home Assistant websocket client: auth, entity cache kept live through state_changed events,
 * service calls, ping/pong keep-alive and reconnect with backoff.
 * Events: 'status' (HAStatus), 'connected', 'disconnected', 'state_changed' (entity_id).
 */
export class HAClient extends EventEmitter implements IOAdapter {
  status: HAStatus = 'disconnected';
  /** Home Assistant's IANA time zone (from get_config) – used by time-of-day blocks. */
  timeZone?: string;
  private areaCache?: { at: number; data: AreaInfo[] };
  private ws?: WSLike;
  private ready = false;
  private stopped = true;
  private nextId = 1;
  private retries = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private pending = new Map<number, Pending>();
  private entities = new Map<string, HAEntity>();
  private wanted = new Set<string>();
  private subs = new Map<string, number>();      // eventType → subscription id
  private readonly log: Logger;

  constructor(private readonly opts: HAClientOptions) {
    super();
    this.setMaxListeners(200);               // every automation listens for events
    this.log = opts.log ?? silentLogger;
  }

  start(): void { this.stopped = false; this.connect(); }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.cleanup();
    ws?.close();
    this.setStatus('disconnected');
  }

  getEntity(entityId: string): EntityState | undefined { return this.entities.get(entityId); }
  listEntities(): HAEntity[] { return [...this.entities.values()]; }

  /** `target` may be any HA target ({ area_id }, { device_id } …); `entityId` is the shortcut for { entity_id }. */
  async callService(domain: string, service: string, data: Record<string, unknown> = {}, entityId?: string, target?: Record<string, unknown>): Promise<unknown> {
    if (this.status !== 'connected') throw new Error('Home Assistant is not connected');
    const t = target ?? (entityId ? { entity_id: entityId } : undefined);
    return this.request({ type: 'call_service', domain, service, service_data: data, ...(t ? { target: t } : {}) });
  }

  /** Rooms with their entities, cached for 30 s. Needs an admin token; rejects when Home Assistant refuses. */
  async getAreas(): Promise<AreaInfo[]> {
    if (this.areaCache && Date.now() - this.areaCache.at < 30_000) return this.areaCache.data;
    if (this.status !== 'connected') throw new Error('Home Assistant is not connected');
    const [areas, entities, devices] = await Promise.all([
      this.request<any[]>({ type: 'config/area_registry/list' }),
      this.request<any[]>({ type: 'config/entity_registry/list' }),
      this.request<any[]>({ type: 'config/device_registry/list' }),
    ]);
    const deviceArea = new Map<string, string | null>(devices.map(d => [d.id, d.area_id ?? null]));
    const data = areas.map(a => ({
      id: String(a.area_id), name: String(a.name ?? a.area_id),
      entities: entities
        .filter(e => !e.disabled_by && (e.area_id ? e.area_id === a.area_id : !!e.device_id && deviceArea.get(e.device_id) === a.area_id))
        .map(e => String(e.entity_id)).sort(),
    })).sort((x, y) => x.name.localeCompare(y.name));
    this.areaCache = { at: Date.now(), data };
    return data;
  }

  request<T = unknown>(msg: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
    return this.requestWithId<T>(msg, timeoutMs).promise;
  }

  /** Like request(), but also returns the message id (for subscriptions the id identifies the subscription). */
  requestWithId<T = unknown>(msg: Record<string, unknown>, timeoutMs = 10_000): { id: number; promise: Promise<T> } {
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      if (!this.ws || !this.ready) { reject(new Error('Home Assistant socket is not open')); return; }
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout waiting for HA (${String(msg.type)})`)); }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.ws.send(JSON.stringify({ ...msg, id }));
    });
    return { id, promise };
  }

  /** Fire an event on the Home Assistant bus. */
  async fireEvent(eventType: string, data: Record<string, unknown> = {}): Promise<unknown> {
    if (this.status !== 'connected') throw new Error('Home Assistant is not connected');
    return this.request({ type: 'fire_event', event_type: eventType, event_data: data });
  }

  /**
   * Which bus events programs want to receive. Matching events are re-emitted as 'ha_event' (type, data).
   * state_changed is always subscribed (entity cache) – asking for it here just forwards those events too.
   */
  setEventTypes(types: Iterable<string>): void {
    this.wanted = new Set(types);
    void this.syncSubscriptions();
  }

  private async syncSubscriptions(): Promise<void> {
    if (this.status !== 'connected') return;                        // afterAuth() syncs once connected
    for (const [type, id] of [...this.subs]) {
      if (this.wanted.has(type)) continue;
      this.subs.delete(type);
      this.request({ type: 'unsubscribe_events', subscription: id }).catch(() => {});
    }
    for (const type of this.wanted) {
      if (type === 'state_changed' || this.subs.has(type)) continue;
      const { id, promise } = this.requestWithId({ type: 'subscribe_events', event_type: type });
      this.subs.set(type, id);
      promise.catch(e => { this.subs.delete(type); this.log.warn(`Cannot subscribe to ${type}: ${String(e)}`); });
    }
  }

  // ───────── internals ─────────
  private setStatus(s: HAStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
    if (s === 'connected') this.emit('connected');
    else this.emit('disconnected');
  }

  private connect(): void {
    if (this.stopped) return;
    this.setStatus('connecting');
    let ws: WSLike;
    try {
      ws = (this.opts.wsFactory ?? (url => new (globalThis as any).WebSocket(url) as WSLike))(this.opts.url);
    } catch (e) {
      this.log.error(`Cannot open HA socket: ${String(e)}`);
      this.onClosed(undefined);
      return;
    }
    this.ws = ws;
    ws.onopen = () => { if (this.ws === ws) this.ready = true; };
    ws.onmessage = ev => {
      try { this.onMessage(JSON.parse(String(ev.data))); } catch (e) { this.log.warn(`Bad HA message: ${String(e)}`); }
    };
    ws.onerror = () => { /* a close event follows */ };
    ws.onclose = () => this.onClosed(ws);
  }

  private onClosed(ws: WSLike | undefined): void {
    if (ws && this.ws !== ws) return;
    this.cleanup();
    if (this.status !== 'auth_failed') this.setStatus('disconnected');
    if (this.stopped || this.status === 'auth_failed') return;
    const min = this.opts.minRetryMs ?? 1000, max = this.opts.maxRetryMs ?? 30_000;
    const delay = Math.min(max, min * 2 ** this.retries++);
    this.log.warn(`Home Assistant disconnected, retrying in ${Math.round(delay / 1000 * 10) / 10}s`);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private cleanup(): void {
    this.ws = undefined;
    this.ready = false;
    clearInterval(this.pingTimer);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Home Assistant disconnected')); }
    this.pending.clear();
    this.subs.clear();
    this.areaCache = undefined;
    // Entities become unavailable (programs see AVAIL = FALSE and hold their last values).
    this.entities.clear();
  }

  private onMessage(msg: any): void {
    switch (msg.type) {
      case 'auth_required':
        this.ws?.send(JSON.stringify({ type: 'auth', access_token: this.opts.token }));
        break;
      case 'auth_ok':
        void this.afterAuth();
        break;
      case 'auth_invalid': {
        this.log.error(`Home Assistant rejected the token: ${String(msg.message ?? '')}`);
        const ws = this.ws;
        this.status = 'auth_failed'; this.emit('status', 'auth_failed'); this.emit('disconnected');
        ws?.close();
        break;
      }
      case 'result':
      case 'pong': {
        const p = this.pending.get(msg.id);
        if (!p) break;
        this.pending.delete(msg.id); clearTimeout(p.timer);
        if (msg.type === 'result' && msg.success === false) p.reject(new Error(msg.error?.message ?? 'Home Assistant error'));
        else p.resolve(msg.result);
        break;
      }
      case 'event': {
        const ev = msg.event;
        if (!ev) break;
        if (ev.event_type === 'state_changed') {
          const { entity_id, new_state } = ev.data ?? {};
          if (new_state) this.entities.set(entity_id, toEntity(new_state)); else this.entities.delete(entity_id);
          this.emit('state_changed', entity_id);
        }
        if (this.wanted.has(ev.event_type)) this.emit('ha_event', ev.event_type, ev.data ?? {});
        break;
      }
    }
  }

  private async afterAuth(): Promise<void> {
    const ws = this.ws;
    try {
      await this.request({ type: 'subscribe_events', event_type: 'state_changed' });
      const states = await this.request<any[]>({ type: 'get_states' });
      this.entities.clear();
      for (const s of states) this.entities.set(s.entity_id, toEntity(s));
      this.retries = 0;
      try { this.timeZone = (await this.request<{ time_zone?: string }>({ type: 'get_config' })).time_zone; } catch { /* the system time zone is used */ }
      this.areaCache = undefined;
      this.log.info(`Connected to Home Assistant (${this.entities.size} entities, time zone ${this.timeZone ?? 'unknown'})`);
      this.setStatus('connected');
      void this.syncSubscriptions();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        this.request({ type: 'ping' }, 10_000).catch(() => { this.log.warn('HA ping timed out'); ws?.close(); });
      }, this.opts.pingMs ?? 30_000);
    } catch (e) {
      this.log.error(`HA handshake failed: ${String(e)}`);
      ws?.close();
    }
  }
}

const toEntity = (s: any): HAEntity => ({ entity_id: s.entity_id, state: String(s.state), attributes: s.attributes ?? {} });
