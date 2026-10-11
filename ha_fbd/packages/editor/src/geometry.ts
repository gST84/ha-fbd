import { registry, type BlockInst, type PinDef } from '@ha-fbd/engine';

export const GRID = 20;
export const HEADER = 30;
export const ROW = 22;

export interface Layout { w: number; h: number; ins: PinDef[]; outs: PinDef[]; title: string; subtitle: string; known: boolean }

const TITLES: Record<string, string> = {
  ENTITY_IN: 'ENTITY IN', ENTITY_OUT: 'ENTITY OUT', VAR_READ: 'VAR READ', VAR_WRITE: 'VAR WRITE', CONST: 'CONST',
  EVENT_IN: 'EVENT IN', EVENT_OUT: 'EVENT OUT', TIME_OF_DAY: 'TIME OF DAY', AREA_OUT: 'ROOM OUT',
};

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function subtitleOf(b: BlockInst): string {
  const p = b.params ?? {};
  switch (b.type) {
    case 'ENTITY_IN': return (p.entityId ? String(p.entityId) : '⚠ pick entity') + (p.attribute ? ` · ${String(p.attribute)}` : '');
    case 'ENTITY_OUT':
      if (p.kind === 'service') return p.service ? String(p.service) : '⚠ service';
      if (p.kind === 'attribute') return p.entityId ? `${String(p.entityId)} · ${p.attribute ? String(p.attribute) : '⚠ attribute'}` : '⚠ pick entity';
      return p.entityId ? String(p.entityId) : '⚠ pick entity';
    case 'SET':
    case 'RESET':
      if (p.target === 'room') return p.floorId ? `zone ${String(p.floorId).replace(/_/g, ' ')}` : p.areaId ? String(p.areaId).replace(/_/g, ' ') : '⚠ pick room or zone';
      return p.target === 'entity' ? (p.entityId ? String(p.entityId) : '⚠ pick entity') : (p.name ? `$${String(p.name)}` : '⚠ pick variable');
    case 'TIME_OF_DAY': {
      const a = String(p.start ?? '00:00'), z = String(p.end ?? '00:00');
      const days = Array.isArray(p.days) && p.days.length && p.days.length < 7 ? ' · ' + (p.days as number[]).slice().sort().map(d => DAY_NAMES[d - 1]).join(' ') : '';
      return (a === z ? 'all day' : `${a} – ${z}`) + days;
    }
    case 'AREA_OUT': return p.areaId ? `${String(p.areaId).replace(/_/g, ' ')} · ${p.action === 'turn_on' ? 'on' : 'off'}` : '⚠ pick room';
    case 'EVENT_IN':
    case 'EVENT_OUT': return p.eventType ? String(p.eventType) : '⚠ event type';
    case 'VAR_READ':
    case 'VAR_WRITE': return p.name ? `$${String(p.name)}` : '⚠ pick variable';
    case 'CONST': return String(p.value ?? '');
    default: return '';
  }
}

export function layout(b: BlockInst): Layout {
  const def = registry[b.type];
  const params = b.params ?? {};
  const ins = def ? def.inputs(params) : [];
  const outs = def ? def.outputs(params) : [];
  const title = TITLES[b.type] ?? b.type;
  const subtitle = subtitleOf(b);
  const maxIn = Math.max(0, ...ins.map(p => p.name.length));
  const maxOut = Math.max(0, ...outs.map(p => p.name.length));
  const want = Math.max(title.length * 8 + 24, subtitle.length * 6.4 + 20, (maxIn + maxOut) * 7 + 44);
  const w = Math.min(300, Math.max(120, Math.ceil(want / GRID) * GRID));
  const rows = Math.max(ins.length, outs.length, 1);
  const h = HEADER + rows * ROW + 8;
  return { w, h, ins, outs, title, subtitle, known: !!def };
}

export const pinY = (b: BlockInst, index: number) => (b.y ?? 0) + HEADER + ROW * index + ROW / 2;

/** Orthogonal wire (TIA style): out of the output pin, one vertical segment, into the input pin. */
export function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x2 - x1 >= GRID) {
    const mx = Math.round(x1 + (x2 - x1) / 2);
    return `M${x1} ${y1} H${mx} V${y2} H${x2}`;
  }
  const out = x1 + GRID, inn = x2 - GRID, my = Math.max(y1, y2) + 2 * GRID;   // feedback: loop underneath
  return `M${x1} ${y1} H${out} V${my} H${inn} V${y2} H${x2}`;
}

export const snap = (v: number) => Math.max(0, Math.round(v / GRID) * GRID);
/** Blocks keep this distance from the left edge so the value labels of their inputs ("FALSE") are never cut off. */
export const MIN_X = 3 * GRID;
export const snapX = (v: number) => Math.max(MIN_X, snap(v));

/**
 * First free spot (rows top→bottom, left→right) for a new block of size w×h.
 * `maxRight` is the visible width of the network: rows wrap before a block would end up off-screen.
 */
export function findFreeSpot(blocks: BlockInst[], w: number, h: number, maxRight = 1400): { x: number; y: number } {
  const boxes = blocks.map(b => { const l = layout(b); return { x: b.x ?? 0, y: b.y ?? 0, w: l.w, h: l.h }; });
  const gapX = 6 * GRID, gapY = GRID;   // leave room for wires and live value labels
  for (let y = GRID; y < 4000; y += GRID) {
    for (let x = MIN_X; x <= Math.max(MIN_X, maxRight - w); x += GRID) {
      const hit = boxes.some(o => x < o.x + o.w + gapX && x + w + gapX > o.x && y < o.y + o.h + gapY && y + h + gapY > o.y);
      if (!hit) return { x, y };
    }
  }
  return { x: MIN_X, y: GRID };
}
