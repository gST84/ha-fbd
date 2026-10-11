import { useEffect, useMemo, useRef, useState } from 'react';
import { listBlocks, pinDoc, type BlockInfo } from '@ha-fbd/engine';

const ORDER = ['Variables & I/O', 'Logic', 'Compare', 'Math', 'Selection', 'Convert', 'Timers', 'Edge', 'Bistable', 'Counters', 'Control'];

interface Hover { info: BlockInfo; top: number; left: number }

/** Floating documentation card for a block (summary, pins, example, notes). */
function BlockHelp({ hover }: { hover: Hover }) {
  const { info, top, left } = hover;
  const doc = info.doc;
  const maxH = Math.min(window.innerHeight * 0.8, 560);
  const style = { left, top: Math.max(8, Math.min(top - 8, window.innerHeight - maxH - 8)), maxHeight: maxH };
  const rows = (side: 'inputs' | 'outputs') => {
    const pins = info[side];
    const names = new Set(pins.map(p => p.name));
    const extra = Object.keys(doc?.[side] ?? {}).filter(k => !k.endsWith('*') && !names.has(k));
    return [
      ...pins.map(p => ({ name: p.name, type: p.type, text: pinDoc(doc, side, p.name) ?? '', extra: false })),
      ...extra.map(k => ({ name: k, type: '', text: pinDoc(doc, side, k) ?? '', extra: true })),
    ];
  };
  const table = (title: string, side: 'inputs' | 'outputs') => {
    const r = rows(side);
    if (!r.length) return null;
    return (
      <>
        <h5>{title}</h5>
        <table><tbody>
          {r.map(x => (
            <tr key={x.name} className={x.extra ? 'extra' : undefined}>
              <td className="pn">{x.name}</td><td className="pt">{x.type || 'depends'}</td><td>{x.text}</td>
            </tr>
          ))}
        </tbody></table>
      </>
    );
  };
  return (
    <div className="help" style={style} data-testid="block-help">
      <h4>{info.type} <span className="cat">{info.category}</span></h4>
      <p className="sum">{doc?.summary ?? info.description}</p>
      {doc?.details && <p>{doc.details}</p>}
      {table('Inputs', 'inputs')}
      {table('Outputs', 'outputs')}
      {doc?.example && <><h5>Example</h5><p className="ex">{doc.example}</p></>}
      {doc?.notes?.length ? <><h5>Good to know</h5><ul>{doc.notes.map((n, i) => <li key={i}>{n.startsWith('IN ') || n.startsWith('Q ') ? <code>{n}</code> : n}</li>)}</ul></> : null}
    </div>
  );
}

export function Palette({ onAdd }: { onAdd(type: string): void }) {
  const [q, setQ] = useState('');
  const [hover, setHover] = useState<Hover | null>(null);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const groups = useMemo(() => {
    const m = new Map<string, BlockInfo[]>();
    for (const b of listBlocks()) {
      if (q && !`${b.type} ${b.description} ${b.category} ${b.doc?.summary ?? ''}`.toLowerCase().includes(q.toLowerCase())) continue;
      m.set(b.category, [...(m.get(b.category) ?? []), b]);
    }
    return [...m.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  }, [q]);

  const show = (e: React.MouseEvent<HTMLElement>, info: BlockInfo) => {
    const r = e.currentTarget.getBoundingClientRect();
    const side = e.currentTarget.closest('.side')?.getBoundingClientRect();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover({ info, top: r.top, left: (side?.right ?? r.right) + 10 }), 250);
  };
  const hide = () => { window.clearTimeout(timer.current); setHover(null); };

  return (
    <div className="palette">
      <input className="search" placeholder="Search blocks…" value={q} onChange={e => setQ(e.target.value)} />
      <p className="hint">Hover a block for help. Click to add it to the active network, or drag it onto a network.</p>
      {groups.map(([cat, blocks]) => (
        <section key={cat}>
          <h3>{cat}</h3>
          <div className="chips">
            {blocks.map(b => (
              <button key={b.type} className="chip" data-palette={b.type} draggable
                onMouseEnter={e => show(e, b)} onMouseLeave={hide}
                onDragStart={e => { hide(); e.dataTransfer.setData('application/x-fbd-block', b.type); e.dataTransfer.effectAllowed = 'copy'; }}
                onClick={() => { hide(); onAdd(b.type); }}>{b.type}</button>
            ))}
          </div>
        </section>
      ))}
      {groups.length === 0 && <p className="hint">No block matches “{q}”.</p>}
      {hover && <BlockHelp hover={hover} />}
    </div>
  );
}
