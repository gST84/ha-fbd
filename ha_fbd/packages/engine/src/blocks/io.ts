import type { BlockDef, DataType, OutputCommand, Value } from '../types.js';
import { attributeDef, domainOf } from '../attributes.js';
import { areaCheck, areaDomains, areaTarget } from './home.js';
import { coerce, pin, toBool, toNum, zeroOf } from '../helpers.js';

const DATA_TYPES: DataType[] = ['BOOL', 'INT', 'REAL', 'STRING', 'TIME'];
const dt = (p: Record<string, unknown>, key: string, def: DataType): DataType =>
  DATA_TYPES.includes(p[key] as DataType) ? (p[key] as DataType) : def;
const ENTITY_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const looksLikeEntityId = (s: unknown) => typeof s === 'string' && ENTITY_RE.test(s);
const ENTITY_MSG = 'entityId must look like "domain.object_id"';
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const CONST: BlockDef = {
  type: 'CONST', category: 'Variables & I/O', description: 'Constant value (params: dataType, value)',
  inputs: () => [], outputs: p => [pin('OUT', dt(p, 'dataType', 'BOOL'))],
  exec: (_i, _s, ctx) => ({ OUT: coerce(ctx.params.value, dt(ctx.params, 'dataType', 'BOOL')) }),
};

/** Reads the state (or an attribute) of a Home Assistant entity. */
const ENTITY_IN: BlockDef<{ last?: Value }> = {
  type: 'ENTITY_IN', category: 'Variables & I/O',
  description: 'Home Assistant entity state or attribute (params: entityId, attribute?, dataType, onStates?)',
  inputs: () => [],
  outputs: p => [pin('OUT', dt(p, 'dataType', 'BOOL')), pin('AVAIL', 'BOOL')],
  init: () => ({}),
  validate: p => (looksLikeEntityId(p.entityId) ? undefined : ENTITY_MSG),
  exec(_i, s, ctx) {
    const type = dt(ctx.params, 'dataType', 'BOOL');
    const ent = ctx.io.getEntity(String(ctx.params.entityId));
    const attr = ctx.params.attribute ? String(ctx.params.attribute) : undefined;
    const raw: unknown = attr ? ent?.attributes?.[attr] : ent?.state;
    const bad = !ent || raw === undefined || raw === null || (!attr && (raw === 'unavailable' || raw === 'unknown'));
    if (!bad) {
      const onStates = Array.isArray(ctx.params.onStates) ? (ctx.params.onStates as string[]) : undefined;
      s.last = type === 'BOOL' ? toBool(raw, onStates) : type === 'STRING' ? String(raw) : coerce(toNum(raw), type);
    }
    // Hold the last valid value while the entity is unavailable (like a PLC input with substitute value).
    return { OUT: s.last ?? zeroOf(type), AVAIL: !bad };
  },
};

type OutKind = 'switch' | 'value' | 'attribute' | 'service';
const outKind = (p: Record<string, unknown>): OutKind =>
  p.kind === 'value' || p.kind === 'service' || p.kind === 'attribute' ? p.kind : 'switch';
const attrOf = (p: Record<string, unknown>) => attributeDef(domainOf(p.entityId), String(p.attribute ?? ''));

/** Writes to a Home Assistant entity. The host translates the command to a service call. */
const ENTITY_OUT: BlockDef<{ last?: Value; prevEn: boolean }> = {
  type: 'ENTITY_OUT', category: 'Variables & I/O',
  description: 'Write to HA: "switch" (BOOL → on/off), "value" (REAL → set value), "attribute" (set a named attribute) or "service" (EN rising edge → service call)',
  inputs: p => {
    const k = outKind(p);
    if (k === 'attribute') return [pin('IN', attrOf(p)?.type ?? 'ANY')];
    return [k === 'switch' ? pin('IN', 'BOOL') : k === 'value' ? pin('IN', 'REAL') : pin('EN', 'BOOL')];
  },
  outputs: () => [],
  init: () => ({ prevEn: false }),
  validate(p) {
    const k = outKind(p);
    if (k === 'service') {
      if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(String(p.service ?? ''))) return 'service must look like "domain.service"';
      if (p.entityId !== undefined && p.entityId !== '' && !looksLikeEntityId(p.entityId)) return 'entityId is invalid';
      return undefined;
    }
    if (!looksLikeEntityId(p.entityId)) return ENTITY_MSG;
    if (k === 'attribute' && !attrOf(p)) {
      return p.attribute
        ? `"${String(p.attribute)}" is not a settable attribute of ${domainOf(p.entityId)} entities (use a service output)`
        : 'pick the attribute to set';
    }
    return undefined;
  },
  exec(i, s, ctx) {
    const k = outKind(ctx.params);
    const skip = ctx.firstScan && !ctx.writeOnFirstScan;
    const entityId = String(ctx.params.entityId ?? '');
    if (k === 'service') {
      const en = toBool(i.EN);
      if (en && !s.prevEn && !skip) {
        ctx.emit({
          kind: 'service', blockId: ctx.blockId, service: String(ctx.params.service),
          entityId: entityId || undefined, data: (ctx.params.data as Record<string, unknown>) ?? {},
        });
      }
      s.prevEn = en;
      return;
    }
    let v: Value;
    let cmd: OutputCommand;
    if (k === 'switch') { v = toBool(i.IN); cmd = { kind: 'switch', blockId: ctx.blockId, entityId, value: v }; }
    else if (k === 'value') { v = toNum(i.IN); cmd = { kind: 'value', blockId: ctx.blockId, entityId, value: v }; }
    else {
      const def = attrOf(ctx.params);
      if (!def) return;
      v = coerce(i.IN, def.type);
      cmd = { kind: 'attribute', blockId: ctx.blockId, entityId, attribute: String(ctx.params.attribute), value: v };
    }
    if (s.last !== v) {            // only write on change
      if (!skip) ctx.emit(cmd);
      s.last = v;
    }
  },
};

const varCheck = (p: Record<string, unknown>, program: { variables: { name: string; type: string }[] }) => {
  const v = program.variables.find(x => x.name === p.name);
  if (!v) return `Unknown variable "${String(p.name)}"`;
  if (v.type !== dt(p, 'varType', 'BOOL')) return `Variable "${v.name}" is ${v.type}, block says ${String(p.varType ?? 'BOOL')}`;
  return undefined;
};

/** Variables are read at the START of the scan and written at the END (PLC image semantics). */
const VAR_READ: BlockDef = {
  type: 'VAR_READ', category: 'Variables & I/O', description: 'Read an internal variable (params: name, varType)',
  inputs: () => [], outputs: p => [pin('OUT', dt(p, 'varType', 'BOOL'))],
  validate: varCheck,
  exec: (_i, _s, ctx) => ({ OUT: ctx.readVar(String(ctx.params.name)) }),
};
const VAR_WRITE: BlockDef = {
  type: 'VAR_WRITE', category: 'Variables & I/O', description: 'Write an internal variable (params: name, varType)',
  inputs: p => [pin('IN', dt(p, 'varType', 'BOOL'))], outputs: () => [],
  validate: varCheck,
  exec(i, _s, ctx) { ctx.writeVar(String(ctx.params.name), i.IN); },
};

/**
 * SET / RESET "coils" (like S / R in TIA Portal).
 *  target "variable": while IN is TRUE the BOOL variable is forced to TRUE (SET) or FALSE (RESET); it keeps the value afterwards.
 *  target "entity":   on a rising edge of IN the entity is switched on (SET) or off (RESET).
 *  target "room":     on a rising edge of IN every selected kind of device in a Home Assistant area (or a whole zone = floor, param floorId) is switched on (SET) or off (RESET).
 */
const coil = (type: 'SET' | 'RESET'): BlockDef<{ prev: boolean }> => ({
  type, category: 'Variables & I/O',
  description: type === 'SET' ? 'Set a BOOL variable / switch an entity or a whole room ON while IN is TRUE (latches)' : 'Reset a BOOL variable / switch an entity or a whole room OFF while IN is TRUE',
  inputs: () => [pin('IN', 'BOOL')], outputs: () => [],
  init: () => ({ prev: false }),
  validate: (p, program) => (p.target === 'room'
    ? areaCheck(p)
    : p.target === 'entity'
      ? (looksLikeEntityId(p.entityId) ? undefined : ENTITY_MSG)
      : varCheck({ ...p, varType: 'BOOL' }, program)),
  exec(i, s, ctx) {
    const on = toBool(i.IN);
    const value = type === 'SET';
    if (ctx.params.target === 'room') {
      const skip = ctx.firstScan && !ctx.writeOnFirstScan;
      if (on && !s.prev && !skip) ctx.emit({ kind: 'area', blockId: ctx.blockId, ...areaTarget(ctx.params), domains: areaDomains(ctx.params), action: value ? 'turn_on' : 'turn_off' });
      s.prev = on;
    } else if (ctx.params.target === 'entity') {
      const skip = ctx.firstScan && !ctx.writeOnFirstScan;
      if (on && !s.prev && !skip) ctx.emit({ kind: 'switch', blockId: ctx.blockId, entityId: String(ctx.params.entityId), value });
      s.prev = on;
    } else if (on) {
      ctx.writeVar(String(ctx.params.name), value);
    }
  },
});

// ───────── events ─────────
/** true when every key of `match` is present in `data` with an equal value (objects are matched recursively). */
export function matchesEvent(data: Record<string, unknown>, match: unknown): boolean {
  if (!isPlainObject(match)) return true;
  return Object.entries(match).every(([k, want]) => {
    const got = data?.[k];
    if (isPlainObject(want)) return isPlainObject(got) && matchesEvent(got, want);
    return got === want || (got !== undefined && got !== null && want !== null && String(got) === String(want));
  });
}
export function getPath(data: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((o, k) => (isPlainObject(o) ? o[k] : undefined), data);
}
const EVENT_TYPE_RE = /^[A-Za-z0-9_.:-]+$/;
const eventTypeCheck = (p: Record<string, unknown>) =>
  typeof p.eventType === 'string' && EVENT_TYPE_RE.test(p.eventType) ? undefined : 'eventType is required (e.g. "zha_event")';

/** Pulse (TRUE for ONE scan) when a Home Assistant event arrives. */
const EVENT_IN: BlockDef<{ last?: Value }> = {
  type: 'EVENT_IN', category: 'Variables & I/O',
  description: 'TRUE for one scan when a Home Assistant event arrives (params: eventType, match?, valuePath?, valueType?)',
  inputs: () => [],
  outputs: p => [pin('Q', 'BOOL'), ...(p.valuePath ? [pin('VAL', dt(p, 'valueType', 'STRING'))] : [])],
  init: () => ({}),
  validate(p) {
    const e = eventTypeCheck(p);
    if (e) return e;
    if (p.match !== undefined && !isPlainObject(p.match)) return 'match must be a JSON object';
    return undefined;
  },
  exec(_i, s, ctx) {
    const type = String(ctx.params.eventType);
    const hits = ctx.events.filter(e => e.type === type && matchesEvent(e.data, ctx.params.match));
    const path = ctx.params.valuePath ? String(ctx.params.valuePath) : '';
    if (path && hits.length) {
      const raw = getPath(hits[hits.length - 1].data, path);
      if (raw !== undefined && raw !== null) s.last = coerce(typeof raw === 'object' ? JSON.stringify(raw) : raw, dt(ctx.params, 'valueType', 'STRING'));
    }
    const out: Record<string, Value> = { Q: hits.length > 0 };
    if (path) out.VAL = s.last ?? zeroOf(dt(ctx.params, 'valueType', 'STRING'));
    return out;
  },
};

/** Fires a Home Assistant event on a rising edge of IN. */
const EVENT_OUT: BlockDef<{ prev: boolean }> = {
  type: 'EVENT_OUT', category: 'Variables & I/O',
  description: 'Fire a Home Assistant event on a rising edge of IN (params: eventType, data?)',
  inputs: () => [pin('IN', 'BOOL')], outputs: () => [],
  init: () => ({ prev: false }),
  validate(p) {
    const e = eventTypeCheck(p);
    if (e) return e;
    if (p.data !== undefined && !isPlainObject(p.data)) return 'data must be a JSON object';
    return undefined;
  },
  exec(i, s, ctx) {
    const on = toBool(i.IN);
    const skip = ctx.firstScan && !ctx.writeOnFirstScan;
    if (on && !s.prev && !skip) ctx.emit({ kind: 'event', blockId: ctx.blockId, eventType: String(ctx.params.eventType), data: (ctx.params.data as Record<string, unknown>) ?? {} });
    s.prev = on;
  },
};

export const ioBlocks: BlockDef[] = [CONST, ENTITY_IN, ENTITY_OUT, VAR_READ, VAR_WRITE, coil('SET'), coil('RESET'), EVENT_IN, EVENT_OUT];
