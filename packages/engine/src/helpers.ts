import type { PinDef, PinType, Value } from './types.js';

export const TRUTHY_STATES = ['on', 'true', '1', 'yes', 'home', 'open', 'detected'];

export const zeroOf = (t: PinType): Value => (t === 'BOOL' ? false : t === 'STRING' ? '' : 0);
export const isNumericType = (t: PinType) => t === 'INT' || t === 'REAL' || t === 'TIME' || t === 'ANY_NUM';

/** Can a wire go from a pin of type `from` into a pin of type `to`? */
export function accepts(to: PinType, from: PinType): boolean {
  if (to === 'ANY' || from === 'ANY') return true;
  if (to === 'ANY_NUM') return isNumericType(from);
  if (from === 'ANY_NUM') return isNumericType(to);
  if (isNumericType(to) && isNumericType(from)) return true; // INT / REAL / TIME interchangeable
  return to === from;
}

/** Strict number parser that accepts a decimal comma ("1,5" → 1.5). Returns undefined when `raw` is not a number. */
export function parseNumber(raw: string): number | undefined {
  const t = raw.trim().replace(/^([+-]?\d+),(\d+)$/, '$1.$2');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return undefined;
  return Number(t);
}

export function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = parseNumber(v) ?? parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function toBool(v: unknown, onStates: string[] = TRUTHY_STATES): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {                       // case-insensitive on both sides
    const s = v.trim().toLowerCase();
    return onStates.some(o => o.trim().toLowerCase() === s);
  }
  return false;
}

/** Accepts 1500, "1500", "T#1500ms", "5s", "2m", "1h". */
export function toTimeMs(v: unknown): number {
  if (typeof v === 'string') {
    const m = /^(?:T#)?\s*(\d+(?:[.,]\d+)?)\s*(ms|s|m|h)?$/i.exec(v.trim());
    if (m) {
      const f = { ms: 1, s: 1000, m: 60000, h: 3600000 }[(m[2] ?? 'ms').toLowerCase() as 'ms' | 's' | 'm' | 'h'];
      return parseFloat(m[1].replace(',', '.')) * f;
    }
  }
  return toNum(v);
}

export function coerce(v: unknown, t: PinType): Value {
  switch (t) {
    case 'BOOL': return toBool(v);
    case 'INT': return Math.trunc(toNum(v));
    case 'REAL':
    case 'ANY_NUM': return toNum(v);
    case 'TIME': return toTimeMs(v);
    case 'STRING': return typeof v === 'string' ? v : String(v ?? '');
    default: return typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string' ? v : String(v ?? '');
  }
}

export const pin = (name: string, type: PinType, def?: Value): PinDef => ({ name, type, default: def });

export function indexed(prefix: string, count: number, type: PinType, from = 1): PinDef[] {
  return Array.from({ length: count }, (_, i) => pin(`${prefix}${i + from}`, type));
}

/** Variable pin count for AND / OR / ADD … (param `inputCount`). */
export function countParam(p: Record<string, unknown>, def = 2, min = 2, max = 16): number {
  const n = Math.floor(Number(p.inputCount ?? def));
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : def));
}

// ───────── wall clock ─────────
export interface ClockInfo { msOfDay: number; weekday: number }     // weekday: 1 = Monday … 7 = Sunday
const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Local time of day in the given IANA time zone (falls back to the system zone for unknown names). */
export function clockInfo(date: Date, timeZone?: string): ClockInfo {
  const key = timeZone ?? '';
  let fmt = formatters.get(key);
  if (!fmt) {
    const base: Intl.DateTimeFormatOptions = { hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    try { fmt = new Intl.DateTimeFormat('en-GB', timeZone ? { ...base, timeZone } : base); } catch { fmt = new Intl.DateTimeFormat('en-GB', base); }
    formatters.set(key, fmt);
  }
  const part = (t: string) => fmt!.formatToParts(date).find(x => x.type === t)?.value ?? '0';
  const [h, m, sec] = [Number(part('hour')) % 24, Number(part('minute')), Number(part('second'))];
  return { msOfDay: ((h * 60 + m) * 60 + sec) * 1000 + date.getMilliseconds(), weekday: WEEKDAYS[part('weekday')] ?? 1 };
}
