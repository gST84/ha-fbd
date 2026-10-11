import type { BlockDef } from '../types.js';
import { pin, toBool } from '../helpers.js';

// ───────── time of day ─────────
const HM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** "22:30" → milliseconds since midnight (undefined when invalid). */
export const parseHM = (v: unknown): number | undefined => {
  const m = HM_RE.exec(String(v ?? ''));
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 60_000 : undefined;
};
const daysOf = (p: Record<string, unknown>): number[] =>
  Array.isArray(p.days) ? (p.days as unknown[]).map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 7) : [];

/**
 * Schedule / clock.  Q = TRUE while the local time is inside [start, end). A window may run past midnight
 * (22:00 → 06:00). start = end means "all day". `days` (1 = Monday … 7 = Sunday) restricts it; for a window that
 * runs past midnight the day is the one the window STARTED on.
 */
const TIME_OF_DAY: BlockDef = {
  type: 'TIME_OF_DAY', category: 'Timers',
  description: 'Time of day: TRUE inside a time window (params: start, end, days?). Also outputs the current time and weekday.',
  inputs: () => [],
  outputs: () => [pin('Q', 'BOOL'), pin('NOW', 'TIME'), pin('DAY', 'INT')],
  validate(p) {
    if (p.start !== undefined && parseHM(p.start) === undefined) return 'start must be a time like 22:00';
    if (p.end !== undefined && parseHM(p.end) === undefined) return 'end must be a time like 06:30';
    if (p.days !== undefined && (!Array.isArray(p.days) || daysOf(p).length !== p.days.length)) return 'days must be numbers 1 (Monday) to 7 (Sunday)';
    return undefined;
  },
  exec(_i, _s, ctx) {
    const c = ctx.clock();
    const start = parseHM(ctx.params.start ?? '00:00') ?? 0, end = parseHM(ctx.params.end ?? '00:00') ?? 0;
    const wraps = start > end;
    const inside = start === end ? true : wraps ? c.msOfDay >= start || c.msOfDay < end : c.msOfDay >= start && c.msOfDay < end;
    const days = daysOf(ctx.params);
    const day = wraps && c.msOfDay < end ? (c.weekday === 1 ? 7 : c.weekday - 1) : c.weekday;     // after midnight → the day the window began
    return { Q: inside && (days.length === 0 || days.includes(day)), NOW: c.msOfDay, DAY: c.weekday };
  },
};

// ───────── a whole room ─────────
export const AREA_DOMAINS = ['light', 'media_player', 'switch', 'fan', 'climate'] as const;
export const AREA_ACTIONS = ['turn_off', 'turn_on'] as const;
/** Zone (Home Assistant floor) id when the block targets a whole zone; undefined for a single room. */
const floorOf = (p: Record<string, unknown>): string | undefined =>
  typeof p.floorId === 'string' && /^[a-z0-9_]+$/.test(p.floorId) ? p.floorId : undefined;
/** The part of an area command that says WHERE: the zone when one is chosen, otherwise the room. */
export const areaTarget = (p: Record<string, unknown>): { areaId: string } | { floorId: string } => {
  const f = floorOf(p);
  return f ? { floorId: f } : { areaId: String(p.areaId) };
};
export const areaDomains = (p: Record<string, unknown>): string[] =>
  Array.isArray(p.domains) ? (p.domains as unknown[]).map(String) : ['light', 'media_player'];

/** Shared by SET / RESET (target "room") and the legacy AREA_OUT block. */
export function areaCheck(p: Record<string, unknown>): string | undefined {
  const floor = floorOf(p);
  if (floor === undefined && (typeof p.areaId !== 'string' || !/^[a-z0-9_]+$/.test(p.areaId))) return 'pick the room (area) or zone (floor)';
  const d = areaDomains(p);
  if (d.length === 0) return 'pick at least one kind of device';
  const bad = d.find(x => !(AREA_DOMAINS as readonly string[]).includes(x));
  if (bad) return `"${bad}" is not supported (use: ${AREA_DOMAINS.join(', ')})`;
  return undefined;
}

/**
 * LEGACY – superseded by SET / RESET with target "room"; hidden from the palette but still runs.
 * Switch every entity of a Home Assistant AREA (room) off – or on – on a rising edge of EN.
 * Home Assistant resolves the area itself (`light.turn_off` with target area_id), so new devices in the room are included automatically.
 */
const AREA_OUT: BlockDef<{ prev: boolean }> = {
  type: 'AREA_OUT', category: 'Variables & I/O', hidden: true,
  description: 'Switch all lights / media players … of a room (Home Assistant area) off or on (params: areaId, domains, action)',
  inputs: () => [pin('EN', 'BOOL')], outputs: () => [],
  init: () => ({ prev: false }),
  validate(p) {
    const e = areaCheck(p);
    if (e) return e;
    if (p.action !== undefined && !(AREA_ACTIONS as readonly string[]).includes(String(p.action))) return 'action must be turn_off or turn_on';
    return undefined;
  },
  exec(i, s, ctx) {
    const on = toBool(i.EN);
    const skip = ctx.firstScan && !ctx.writeOnFirstScan;
    if (on && !s.prev && !skip) {
      ctx.emit({ kind: 'area', blockId: ctx.blockId, ...areaTarget(ctx.params), domains: areaDomains(ctx.params), action: ctx.params.action === 'turn_on' ? 'turn_on' : 'turn_off' });
    }
    s.prev = on;
  },
};

export const homeBlocks: BlockDef[] = [TIME_OF_DAY, AREA_OUT];
