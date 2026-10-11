import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, PointerEvent as RPE } from 'react';
import { accepts, familyOf, registry, type BlockInst, type Network, type PinRef, type PinType, type Value } from '@ha-fbd/engine';
import { GRID, HEADER, MIN_X, ROW, layout, pinY, wirePath, switchedDomains } from './geometry';
import { DomainIcon, hasDomainIcon } from './DomainIcon';
import type { Edit } from './history';
import { addWire, moveBlocks } from './ops';
import type { ContextInfo, Selection } from './types';

type DragState =
  | { kind: 'block'; ids: string[]; sx: number; sy: number; orig: Record<string, { x: number; y: number }>; minX: number; minY: number; moved: boolean; nameZone: boolean; opening: boolean; clicked: string }
  | { kind: 'wire'; from: PinRef; type: PinType }
  | { kind: 'band'; x0: number; y0: number; base: string[]; moved: boolean };
interface WireDrag { from: PinRef; type: PinType; x: number; y: number }
interface Band { x: number; y: number; w: number; h: number }

export interface NetworkProps {
  net: Network; index: number; total: number; active: boolean;
  selection: Selection | null; errorBlocks: Set<string>;
  /** live values "block.PIN" → value, or null when the program is not running */
  values: Record<string, Value> | null;
  /** Version of the room / zone names (see setPlaceNames); block subtitles show those names. */
  places: number;
  edit: Edit; beginTx(): void;
  onActivate(): void; onSelect(s: Selection | null): void;
  onDropBlock(netId: string, type: string, x: number, y: number): void;
  onChangeType(blockId: string, type: string): void;
  onContext(info: ContextInfo): void;
  onRename(title: string): void; onMove(dir: -1 | 1): void; onDelete(): void;
}

const catClass = (type: string) =>
  type === 'ENTITY_IN' || type === 'ENTITY_OUT' || type === 'EVENT_IN' || type === 'EVENT_OUT' || type === 'AREA_OUT' ? 'io'
  : ['VAR_READ', 'VAR_WRITE', 'CONST', 'SET', 'RESET', 'TOGGLE'].includes(type) ? 'var'
  : ['Timers', 'Counters', 'Edge', 'Bistable', 'Control'].includes(registry[type]?.category ?? '') ? 'seq' : 'fn';

const zero = (t: PinType): Value => (t === 'BOOL' ? false : t === 'STRING' ? '' : 0);
function fmt(v: Value | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return v.length > 10 ? `"${v.slice(0, 9)}…"` : `"${v}"`;
}
const liveClass = (v: Value | undefined) => (typeof v === 'boolean' ? (v ? 't' : 'f') : 'n');
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
const snapDelta = (d: number) => Math.round(d / GRID) * GRID;
/** While a drag is going on nothing may get selected (the blue text-selection overlay the browser would otherwise draw). */
const dragUi = {
  start() { document.documentElement.classList.add('dragging'); window.getSelection()?.removeAllRanges(); },
  end() { document.documentElement.classList.remove('dragging'); },
};

function NetworkViewImpl(props: NetworkProps) {
  const { net, index, total, active, selection, errorBlocks, values } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const [wireDrag, setWireDrag] = useState<WireDrag | null>(null);
  const [band, setBand] = useState<Band | null>(null);
  const [menu, setMenu] = useState<string | null>(null);      // block id whose type menu is open

  const L = useMemo(() => new Map(net.blocks.map(b => [b.id, layout(b)])), [net.blocks, props.places]);
  const byId = useMemo(() => new Map(net.blocks.map(b => [b.id, b])), [net.blocks]);
  const wiredOuts = useMemo(() => new Set(net.wires.map(w => `${w.from.block}.${w.from.pin}`)), [net.wires]);
  const driver = useMemo(() => new Map(net.wires.map(w => [`${w.to.block}.${w.to.pin}`, `${w.from.block}.${w.from.pin}`])), [net.wires]);
  const selIds = selection?.net === net.id && selection.kind === 'blocks' ? selection.ids : [];

  useLayoutEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.type-menu')) setMenu(null); };
    window.addEventListener('keydown', esc);
    window.addEventListener('pointerdown', away, true);
    return () => { window.removeEventListener('keydown', esc); window.removeEventListener('pointerdown', away, true); };
  }, [menu]);

  let maxR = 0, maxB = 0;
  for (const b of net.blocks) { const l = L.get(b.id)!; maxR = Math.max(maxR, (b.x ?? 0) + l.w); maxB = Math.max(maxB, (b.y ?? 0) + l.h); }
  const W = Math.max(900, maxR + 260), H = Math.max(180, maxB + 90);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const select = (ids: string[]) => props.onSelect(ids.length ? { net: net.id, kind: 'blocks', ids } : null);

  const onBlockDown = (e: RPE, b: BlockInst) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onActivate();
    setMenu(null);
    if (e.shiftKey || e.metaKey || e.ctrlKey) {                       // add / remove from the selection, no drag
      select(selIds.includes(b.id) ? selIds.filter(x => x !== b.id) : [...selIds, b.id]);
      return;
    }
    const ids = selIds.includes(b.id) ? selIds : [b.id];
    if (!selIds.includes(b.id)) select(ids);
    svgRef.current!.setPointerCapture(e.pointerId);
    dragUi.start();
    const orig: Record<string, { x: number; y: number }> = {};
    for (const id of ids) { const o = byId.get(id)!; orig[id] = { x: o.x ?? 0, y: o.y ?? 0 }; }
    drag.current = {
      kind: 'block', ids, sx: e.clientX, sy: e.clientY, orig, moved: false, clicked: b.id,
      minX: Math.min(...Object.values(orig).map(o => o.x)), minY: Math.min(...Object.values(orig).map(o => o.y)),
      // the menu opens when the NAME of the block is clicked (not anywhere on the header)
      nameZone: (() => {
        const l = L.get(b.id)!, loc = toLocal(e);
        const lx = loc.x - (b.x ?? 0), ly = loc.y - (b.y ?? 0);
        return ly < (l.subtitle ? 19 : HEADER) && Math.abs(lx - l.w / 2) <= ((l.title.length + 2) * 7.5 + 16) / 2;
      })(),
      opening: menu !== b.id,
    };
  };
  const onPinDown = (e: RPE, from: PinRef, type: PinType) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onActivate(); setMenu(null);
    svgRef.current!.setPointerCapture(e.pointerId);
    dragUi.start();
    drag.current = { kind: 'wire', from, type };
    const p = toLocal(e);
    setWireDrag({ from, type, x: p.x, y: p.y });
  };
  const onBgDown = (e: RPE) => {
    if (e.button !== 0 || !((e.target === e.currentTarget) || (e.target as Element).classList.contains('bg'))) return;
    props.onActivate(); setMenu(null);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    svgRef.current!.setPointerCapture(e.pointerId);
    dragUi.start();
    const p = toLocal(e);
    drag.current = { kind: 'band', x0: p.x, y0: p.y, base: additive ? selIds : [], moved: false };
    if (!additive) props.onSelect(null);
  };

  const onMove = (e: RPE) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'block') {
      const dx = Math.max(snapDelta(e.clientX - d.sx), Math.min(0, MIN_X - d.minX)), dy = Math.max(snapDelta(e.clientY - d.sy), -d.minY);
      if (!d.moved) { if (dx === 0 && dy === 0) return; d.moved = true; props.beginTx(); }
      const moves = Object.fromEntries(d.ids.map(id => [id, { x: d.orig[id].x + dx, y: d.orig[id].y + dy }]));
      props.edit(p => moveBlocks(p, net.id, moves), 'drag');
    } else if (d.kind === 'wire') {
      const p = toLocal(e);
      setWireDrag(w => (w ? { ...w, x: p.x, y: p.y } : w));
    } else {
      const p = toLocal(e);
      if (!d.moved && Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) < 4) return;
      d.moved = true;
      const r = { x: Math.min(p.x, d.x0), y: Math.min(p.y, d.y0), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) };
      setBand(r);
      const hit = net.blocks.filter(b => {
        const l = L.get(b.id)!, x = b.x ?? 0, y = b.y ?? 0;
        return x < r.x + r.w && x + l.w > r.x && y < r.y + r.h && y + l.h > r.y;
      }).map(b => b.id);
      select([...new Set([...d.base, ...hit])]);
    }
  };
  const onUp = (e: RPE) => {
    const d = drag.current;
    drag.current = null;
    setBand(null);
    dragUi.end();
    if (!d) return;
    if (d.kind === 'block' && !d.moved) {
      if (d.ids.length > 1) select([d.clicked]);                        // plain click inside a group → just that block
      else if (d.nameZone && d.opening && familyOf(byId.get(d.clicked)?.type ?? '').length > 1) setMenu(d.clicked);
    } else if (d.kind === 'wire') {
      setWireDrag(null);
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-in]') as HTMLElement | null;
      if (!el) return;
      const [n, block, pin] = (el.dataset.in ?? '').split('|');
      if (n === net.id) props.edit(p => addWire(p, net.id, d.from, { block, pin }));
    }
  };
  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData('application/x-fbd-block');
    if (!type) return;
    e.preventDefault();
    const p = toLocal(e);
    props.onDropBlock(net.id, type, p.x - 60, p.y - 15);
  };

  const preview = (() => {
    if (!wireDrag) return null;
    const fb = byId.get(wireDrag.from.block), fl = fb && L.get(fb.id);
    if (!fb || !fl) return null;
    const oi = fl.outs.findIndex(p => p.name === wireDrag.from.pin);
    return wirePath((fb.x ?? 0) + fl.w, pinY(fb, oi), wireDrag.x, wireDrag.y);
  })();
  const menuBlock = menu ? byId.get(menu) : undefined;

  return (
    <div className={'network' + (active ? ' active' : '')} data-net={net.id} onPointerDown={props.onActivate}>
      <div className="net-head">
        <span className="net-no">Network {index + 1}:</span>
        <input className="net-title" value={net.title} spellCheck={false} aria-label="Network title" placeholder="Title…"
          onFocus={props.beginTx} onChange={e => props.onRename(e.target.value)} />
        <span className="grow" />
        <button className="icon" title="Move up" disabled={index === 0} onClick={() => props.onMove(-1)}>↑</button>
        <button className="icon" title="Move down" disabled={index === total - 1} onClick={() => props.onMove(1)}>↓</button>
        <button className="icon" title="Delete network" data-testid="delete-network" disabled={total <= 1} onClick={props.onDelete}>✕</button>
      </div>
      <div className="net-scroll" onDragOver={e => { if (e.dataTransfer.types.includes('application/x-fbd-block')) e.preventDefault(); }} onDrop={onDrop}>
        <svg ref={svgRef} className="canvas" style={{ minWidth: W, height: H }}
          onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setWireDrag(null); setBand(null); dragUi.end(); }}
          onPointerDown={onBgDown}
          onMouseDown={e => { if (e.button === 0) { (document.activeElement as HTMLElement | null)?.blur?.(); e.preventDefault(); } }}   /* no text selection; blur commits a field being edited */
          onContextMenu={e => {
            e.preventDefault();
            const loc = toLocal(e);
            props.onContext({ x: e.clientX, y: e.clientY, net: net.id, lx: loc.x, ly: loc.y, blockId: (e.target as Element).closest('[data-block]')?.getAttribute('data-block') ?? undefined });
          }}>
          <defs>
            <pattern id={`grid-${net.id}`} width={GRID} height={GRID} patternUnits="userSpaceOnUse"><circle cx={1} cy={1} r={1} className="dot" /></pattern>
          </defs>
          <rect className="bg" width="100%" height="100%" fill={`url(#grid-${net.id})`} />
          {net.blocks.length === 0 && <text className="empty" x={GRID * 2} y={GRID * 3}>Empty network – drag a block here or click one in the palette</text>}

          {net.wires.map(w => {
            const fb = byId.get(w.from.block), tb = byId.get(w.to.block);
            if (!fb || !tb) return null;
            const fl = L.get(fb.id)!, tl = L.get(tb.id)!;
            const oi = fl.outs.findIndex(p => p.name === w.from.pin), ii = tl.ins.findIndex(p => p.name === w.to.pin);
            if (oi < 0 || ii < 0) return null;
            const d = wirePath((fb.x ?? 0) + fl.w, pinY(fb, oi), tb.x ?? 0, pinY(tb, ii));
            const key = `${w.to.block}.${w.to.pin}`;
            const sel = selection?.net === net.id && selection.kind === 'wire' && selection.id === key;
            const v = values?.[`${w.from.block}.${w.from.pin}`];
            const cls = 'wire' + (sel ? ' sel' : '') + (v === true ? ' on' : typeof v === 'boolean' ? ' off' : '');
            return (
              <g key={key}>
                <path d={d} className={cls} />
                <path d={d} className="wire-hit" data-wire={key}
                  onPointerDown={e => { e.stopPropagation(); props.onActivate(); setMenu(null); props.onSelect({ net: net.id, kind: 'wire', id: key }); }} />
              </g>
            );
          })}

          {net.blocks.map(b => {
            const l = L.get(b.id)!;
            const sel = selIds.includes(b.id);
            // "active" = main output is TRUE (first output pin); blocks without outputs: their main input is TRUE
            let on = false;
            if (values) {
              const out0 = l.outs[0], in0 = l.ins[0];
              if (out0) on = out0.type === 'BOOL' && values[`${b.id}.${out0.name}`] === true;
              else { const src = in0 && driver.get(`${b.id}.${in0.name}`); on = !!src && in0.type === 'BOOL' && values[src] === true; }
            }
            const switchable = familyOf(b.type).length > 1;
            const icons = switchedDomains(b).filter(hasDomainIcon);
            const cls = ['block', catClass(b.type), on && 'live-on', sel && 'sel', errorBlocks.has(b.id) && 'err', !l.known && 'unknown'].filter(Boolean).join(' ');
            return (
              <g key={b.id} className={cls} data-block={b.id} transform={`translate(${b.x ?? 0},${b.y ?? 0})`} onPointerDown={e => onBlockDown(e, b)}>
                <rect className="body" width={l.w} height={l.h} rx={4} />
                <path className="head" d={`M0 ${HEADER} V4 Q0 0 4 0 H${l.w - 4} Q${l.w} 0 ${l.w} 4 V${HEADER} Z`} />
                <text className="title" x={l.w / 2} y={l.subtitle ? 13 : 19} textAnchor="middle">{l.title}{switchable ? ' ▾' : ''}</text>
                {l.subtitle && <text className="sub" x={l.w / 2} y={25} textAnchor="middle">{trunc(l.subtitle, Math.floor((l.w - 12) / 6))}</text>}

                {icons.map((d, i) => <DomainIcon key={d} domain={d} x={l.w - 8 - (icons.length - i) * 17 + 3} y={HEADER + ROW / 2 - 7} />)}

                {l.ins.map((p, i) => {
                  const y = HEADER + ROW * i + ROW / 2;
                  const key = `${b.id}.${p.name}`;
                  const src = driver.get(key);
                  const compat = !!wireDrag && wireDrag.from.block !== b.id && accepts(p.type, wireDrag.type);
                  const text = src !== undefined
                    ? (values ? fmt(values[src]) : '')
                    : fmt((b.params?.[p.name] as Value | undefined) ?? p.default ?? zero(p.type));
                  return (
                    <g key={p.name}>
                      <circle className={'pin' + (src !== undefined ? ' wired' : '') + (compat ? ' ok' : '')} cx={0} cy={y} r={5} />
                      <circle className="pin-hit" cx={0} cy={y} r={11} data-in={`${net.id}|${b.id}|${p.name}`} />
                      <text className="plabel" x={10} y={y + 4}>{p.name}</text>
                      {/* live value sits ABOVE the wire; the constant of an unconnected input sits beside the pin */}
                      {text !== '' && <text className={src !== undefined ? 'live ' + liveClass(values?.[src]) : 'cval'} x={-10} y={src !== undefined ? y - 6 : y + 4} textAnchor="end">{text}</text>}
                    </g>
                  );
                })}

                {l.outs.map((p, i) => {
                  const y = HEADER + ROW * i + ROW / 2;
                  const v = values?.[`${b.id}.${p.name}`];
                  return (
                    <g key={p.name}>
                      <circle className="pin out" cx={l.w} cy={y} r={5} />
                      <circle className="pin-hit out" cx={l.w} cy={y} r={11} data-out={`${b.id}.${p.name}`}
                        onPointerDown={e => onPinDown(e, { block: b.id, pin: p.name }, p.type)} />
                      <text className="plabel" x={l.w - 10} y={y + 4} textAnchor="end">{p.name}</text>
                      {v !== undefined && !wiredOuts.has(`${b.id}.${p.name}`) && <text className={'live ' + liveClass(v)} x={l.w + 10} y={y + 4}>{fmt(v)}</text>}
                    </g>
                  );
                })}
              </g>
            );
          })}
          {preview && <path d={preview} className="wire preview" />}
          {band && <rect className="band" x={band.x} y={band.y} width={band.w} height={band.h} />}
        </svg>
        {menuBlock && (
          <div className="type-menu" data-testid="type-menu" style={{ left: menuBlock.x ?? 0, top: (menuBlock.y ?? 0) + HEADER + 2 }}
            onPointerDown={e => e.stopPropagation()}>
            <div className="type-menu-title">Change block type</div>
            {familyOf(menuBlock.type).map(t => (
              <button key={t} data-type={t} className={t === menuBlock.type ? 'on' : ''}
                onClick={() => { setMenu(null); if (t !== menuBlock.type) props.onChangeType(menuBlock.id, t); }}>{t}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const NetworkView = memo(NetworkViewImpl);
