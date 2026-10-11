import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPE } from 'react';
import type { Program, Value } from '@ha-fbd/engine';
import { get, send } from './api';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { GRID, snap, snapX } from './geometry';
import { useHistory } from './history';
import { NetworkView } from './NetworkView';
import {
  addBlock, addNetwork, changeBlockType, copyBlocks, deleteBlocks, deleteNetwork, deleteWire, emptyProgram,
  moveNetwork, pasteClip, renameNetwork, setName, type Clip,
  migrateLegacy,
} from './ops';
import { Palette } from './Palette';
import { Properties } from './Properties';
import { Logo } from './Logo';
import { ThemeSelect } from './ThemeSelect';
import type { AreaInfo, FloorInfo, AutomationStatus, ContextInfo, EntityInfo, Problem, Selection, WatchFrame } from './types';
import { VariablesPanel } from './VariablesPanel';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

function sanitize(p: unknown, fallbackName: string): Program {
  const o = p as Partial<Program> | null;
  if (!o || o.version !== 1 || !Array.isArray(o.networks) || o.networks.length === 0) return emptyProgram(fallbackName);
  return migrateLegacy({ version: 1, name: o.name ?? fallbackName, variables: Array.isArray(o.variables) ? o.variables : [], networks: o.networks });
}
const readWidth = (key: string, def: number) => {
  try { const n = Number(localStorage.getItem(key)); return n >= 180 && n <= 560 ? n : def; } catch { return def; }
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function App({ id, onBack }: { id: string; onBack(): void }) {
  const api = `automations/${id}`;
  const h = useHistory(emptyProgram(id));
  const { program, edit, beginTx } = h;

  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  const [activeNet, setActiveNet] = useState('');
  const [tab, setTab] = useState<'blocks' | 'vars'>('blocks');
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [entities, setEntities] = useState<EntityInfo[]>([]);
  const [areas, setAreas] = useState<{ list: AreaInfo[]; floors: FloorInfo[]; error?: string }>({ list: [], floors: [] });
  const [ctx, setCtx] = useState<ContextInfo | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [live, setLive] = useState<WatchFrame | null>(null);
  const [toast, setToast] = useState('');
  const [deployedJson, setDeployedJson] = useState<string | null>(null);
  const [wl, setWl] = useState(() => readWidth('fbd.wl', 250));
  const [wr, setWr] = useState(() => readWidth('fbd.wr', 310));
  const skipSave = useRef(true);
  const clip = useRef<Clip | null>(null);
  const pasteCount = useRef(0);

  const say = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(t => (t === msg ? '' : t)), 4000); }, []);

  // ───────── load / poll / live stream ─────────
  useEffect(() => {
    (async () => {
      const r = await get<Program>(api);
      if (r.status === 404) { say('This automation does not exist'); return; }
      const p = sanitize(r.body, id);
      h.load(p);
      setActiveNet(p.networks[0].id);
      const v = await send<{ errors: Problem[] }>('POST', `${api}/validate`, p);
      setProblems(v.body?.errors ?? []);
      setLoaded(true);
    })().catch(() => say('Cannot reach the add-on server'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    const poll = () => get<AutomationStatus>(`${api}/status`).then(r => setStatus(r.status === 200 ? r.body : null)).catch(() => setStatus(null));
    poll(); const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [api]);
  useEffect(() => {
    const load = () => get<EntityInfo[]>('entities').then(r => Array.isArray(r.body) && setEntities(r.body)).catch(() => {});
    load(); const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const load = () => get<{ areas: AreaInfo[]; floors?: FloorInfo[]; error?: string }>('areas').then(r => setAreas({ list: r.body?.areas ?? [], floors: r.body?.floors ?? [], error: r.body?.error })).catch(() => {});
    load(); const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const es = new EventSource(`api/${api}/watch`);
    let last = 0;
    es.onmessage = ev => { const now = Date.now(); if (now - last < 150) return; last = now; setLive(JSON.parse(ev.data)); };
    return () => es.close();
  }, [api]);
  useEffect(() => { if (status && !status.running) setLive(null); }, [status?.running]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem('fbd.wl', String(wl)); localStorage.setItem('fbd.wr', String(wr)); } catch { /* storage unavailable */ } }, [wl, wr]);

  // ───────── autosave draft + validation ─────────
  useEffect(() => {
    if (!loaded) return;
    if (skipSave.current) { skipSave.current = false; return; }
    setSaveState('dirty');
    const t = setTimeout(async () => {
      setSaveState('saving');
      try {
        const r = await send<{ ok: boolean; errors: Problem[] }>('PUT', api, program);
        setProblems(r.body?.errors ?? []);
        setSaveState(r.status === 200 ? 'saved' : 'error');
      } catch { setSaveState('error'); }
    }, 600);
    return () => clearTimeout(t);
  }, [program, loaded, api]);

  // ───────── actions ─────────
  const addTo = useCallback((netId: string, type: string, x?: number, y?: number) => {
    const visible = document.querySelector(`[data-net="${netId}"] .net-scroll`)?.clientWidth;      // keep new blocks on screen
    const r = addBlock(program, netId, type, x, y, undefined, visible ? visible - 40 : undefined);
    if (!r.id) return;
    edit(() => r.program);
    setActiveNet(netId);
    setSel({ net: netId, kind: 'blocks', ids: [r.id] });
  }, [program, edit]);

  const deleteSelection = useCallback(() => {
    if (!sel) return;
    if (sel.kind === 'blocks') edit(p => deleteBlocks(p, sel.net, sel.ids));
    else { const [block, pin] = sel.id.split('.'); edit(p => deleteWire(p, sel.net, { block, pin })); }
    setSel(null);
  }, [sel, edit]);

  const copy = useCallback((): boolean => {
    if (sel?.kind !== 'blocks') return false;
    const c = copyBlocks(program, sel.net, sel.ids);
    if (!c) return false;
    clip.current = c; pasteCount.current = 0;
    return true;
  }, [sel, program]);
  /** `at` = a point on the canvas (right-click → Paste here); without it the copy is placed a bit down-right of the original. */
  const paste = useCallback((at?: { net: string; x: number; y: number }) => {
    const net = at?.net ?? (activeNet || program.networks[0].id);
    const c = clip.current;
    if (!c) return;
    let dx: number, dy: number;
    if (at) {
      dx = snapX(at.x) - Math.min(...c.blocks.map(b => b.x ?? 0));
      dy = snap(at.y) - Math.min(...c.blocks.map(b => b.y ?? 0));
    } else dx = dy = ++pasteCount.current * 2 * GRID;
    const r = pasteClip(program, net, c, dx, dy);
    if (!r.ids.length) return;
    edit(() => r.program);
    setActiveNet(net);
    setSel({ net, kind: 'blocks', ids: r.ids });
  }, [activeNet, program, edit]);
  const selectAll = useCallback(() => {
    const net = program.networks.find(n => n.id === (activeNet || program.networks[0].id));
    if (net?.blocks.length) setSel({ net: net.id, kind: 'blocks', ids: net.blocks.map(b => b.id) });
  }, [program, activeNet]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) return;                 // normal text editing keeps its own shortcuts
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); deleteSelection(); } }
      else if (e.key === 'Escape') setSel(null);
      else if (mod && k === 'c') { if (copy()) e.preventDefault(); }
      else if (mod && k === 'x') { if (copy()) { e.preventDefault(); deleteSelection(); } }
      else if (mod && k === 'v') { if (clip.current) { e.preventDefault(); paste(); } }
      else if (mod && k === 'a') { e.preventDefault(); selectAll(); }
      else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? h.redo() : h.undo(); }
      else if (mod && k === 'y') { e.preventDefault(); h.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, copy, paste, selectAll, deleteSelection, h.undo, h.redo]);   // eslint-disable-line react-hooks/exhaustive-deps

  const openContext = (info: ContextInfo) => {
    setActiveNet(info.net);
    if (info.blockId && !(sel?.kind === 'blocks' && sel.net === info.net && sel.ids.includes(info.blockId))) setSel({ net: info.net, kind: 'blocks', ids: [info.blockId] });
    setCtx(info);
  };
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const key = (k: string) => (mac ? `⌘${k}` : `Ctrl+${k}`);
  const ctxItems = (c: ContextInfo): MenuItem[] => {
    const hasSel = !!c.blockId || (sel?.kind === 'blocks' && sel.net === c.net);
    const net = program.networks.find(n => n.id === c.net);
    return [
      { label: 'Copy', hint: key('C'), disabled: !hasSel, onClick: () => { copy(); } },
      { label: 'Cut', hint: key('X'), disabled: !hasSel, onClick: () => { if (copy()) deleteSelection(); } },
      { label: 'Paste here', hint: key('V'), disabled: !clip.current, onClick: () => paste({ net: c.net, x: c.lx, y: c.ly }) },
      { separator: true, label: '' },
      { label: 'Delete', hint: '⌫', danger: true, disabled: !hasSel, onClick: deleteSelection },
      { separator: true, label: '' },
      { label: 'Select all', hint: key('A'), disabled: !net?.blocks.length, onClick: () => { setActiveNet(c.net); setSel({ net: c.net, kind: 'blocks', ids: net!.blocks.map(b => b.id) }); } },
    ];
  };

  const refreshStatus = () => get<AutomationStatus>(`${api}/status`).then(s => setStatus(s.body));
  const deploy = async () => {
    const r = await send<{ ok: boolean; errors?: Problem[] }>('POST', `${api}/deploy`, program);
    if (r.body?.ok) { setDeployedJson(JSON.stringify(program)); setProblems([]); say('Deployed – automation is running'); }
    else { setProblems(r.body?.errors ?? [{ message: 'Deploy failed' }]); say('Deploy refused – fix the problems first'); }
    refreshStatus();
  };
  const toggleRun = async () => {
    const r = await send<{ ok: boolean; errors?: Problem[] }>('POST', `${api}/${status?.running ? 'stop' : 'start'}`);
    if (r.body && r.body.ok === false) setProblems(r.body.errors ?? []);
    refreshStatus();
  };
  const focusProblem = (p: Problem) => {
    if (!p.blockId || !p.networkId) return;
    setActiveNet(p.networkId); setSel({ net: p.networkId, kind: 'blocks', ids: [p.blockId] });
    document.querySelector(`[data-block="${p.blockId}"]`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  };

  const startResize = (side: 'l' | 'r') => (e: RPE<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget, sx = e.clientX, w0 = side === 'l' ? wl : wr;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      (side === 'l' ? setWl : setWr)(clamp(side === 'l' ? w0 + dx : w0 - dx, 180, 560));
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };

  const errorBlocks = useMemo(() => new Set(problems.map(p => p.blockId).filter((x): x is string => !!x)), [problems]);
  const running = !!status?.running;
  const values: Record<string, Value> | null = running && live ? live.values : null;
  const dirtySinceDeploy = deployedJson !== null && deployedJson !== JSON.stringify(program);

  return (
    <div className="app">
      <header className="top">
        <Logo />
        <button className="sec" onClick={onBack} data-testid="back" title="All automations">← Automations</button>
        <input className="auto-name" value={program.name ?? ''} spellCheck={false} aria-label="Automation name" placeholder="Name of this automation" data-testid="auto-name"
          onFocus={beginTx} onChange={e => edit(p => setName(p, e.target.value), 'drag')} />
        <span className={'pill ' + (status?.ha === 'connected' ? 'ok' : 'bad')} data-testid="ha-pill">HA {status?.ha ?? 'offline'}</span>
        <span className={'pill ' + (running ? 'ok' : '')} data-testid="run-pill">{running ? 'running' : 'stopped'}</span>
        {status && running && <span className="muted small">scan {status.stats.avgMs.toFixed(2)} ms{status.overruns ? ` · ${status.overruns} overruns` : ''}</span>}
        <span className="grow" />
        <span className="muted small" data-testid="save-state">{{ saved: 'Draft saved', saving: 'Saving…', dirty: 'Unsaved…', error: 'Save failed' }[saveState]}</span>
        <ThemeSelect />
        <button className="sec" disabled={!h.canUndo} onClick={h.undo} title="Undo (Ctrl/⌘ + Z)" data-testid="undo">↶</button>
        <button className="sec" disabled={!h.canRedo} onClick={h.redo} title="Redo (Ctrl/⌘ + Y)" data-testid="redo">↷</button>
        <button className="sec" onClick={toggleRun} data-testid="toggle-run">{running ? 'Stop' : 'Start'}</button>
        <button onClick={deploy} data-testid="deploy" title="Validate, save and run this automation">Deploy{dirtySinceDeploy ? ' •' : ''}</button>
      </header>
      {toast && <div className="toast" data-testid="toast">{toast}</div>}

      <div className="main" style={{ gridTemplateColumns: `${wl}px 6px minmax(0, 1fr) 6px ${wr}px` }}>
        <aside className="side left">
          <div className="tabs">
            <button className={tab === 'blocks' ? 'on' : ''} onClick={() => setTab('blocks')}>Blocks</button>
            <button className={tab === 'vars' ? 'on' : ''} onClick={() => setTab('vars')} data-testid="tab-vars">Variables ({program.variables.length})</button>
          </div>
          {tab === 'blocks'
            ? <Palette onAdd={type => addTo(activeNet || program.networks[0].id, type)} />
            : <VariablesPanel program={program} edit={edit} beginTx={beginTx} live={running && live ? live.variables : null} />}
        </aside>
        <div className="resizer" data-testid="resize-left" title="Drag to resize · double-click to reset" onPointerDown={startResize('l')} onDoubleClick={() => setWl(250)} />

        <main className="center">
          {program.networks.map((net, i) => (
            <NetworkView key={net.id} net={net} index={i} total={program.networks.length} active={net.id === activeNet}
              selection={sel} errorBlocks={errorBlocks} values={values} edit={edit} beginTx={beginTx}
              onActivate={() => setActiveNet(net.id)} onSelect={setSel} onContext={openContext}
              onDropBlock={(netId, type, x, y) => addTo(netId, type, x, y)}
              onChangeType={(blockId, type) => {
                const r = changeBlockType(program, net.id, blockId, type);
                edit(() => r.program); setSel({ net: net.id, kind: 'blocks', ids: [r.id] });
              }}
              onRename={t => edit(p => renameNetwork(p, net.id, t), 'drag')}
              onMove={dir => edit(p => moveNetwork(p, net.id, dir))}
              onDelete={() => { if (net.blocks.length === 0 || confirm(`Delete "${net.title || 'this network'}" and its ${net.blocks.length} block(s)?`)) edit(p => deleteNetwork(p, net.id)); }} />
          ))}
          <button className="sec add-net" data-testid="add-network" onClick={() => edit(addNetwork)}>+ Add network</button>
        </main>

        <div className="resizer" data-testid="resize-right" title="Drag to resize · double-click to reset" onPointerDown={startResize('r')} onDoubleClick={() => setWr(310)} />
        <aside className="side right">
          <h2>Properties</h2>
          <Properties program={program} selection={sel} entities={entities} problems={problems} areas={areas.list} floors={areas.floors} areasError={areas.error} edit={edit} beginTx={beginTx} onClear={() => setSel(null)} />
          <h2>Problems <span className={'badge' + (problems.length ? ' bad' : '')} data-testid="problem-count">{problems.length}</span></h2>
          {problems.length === 0 && <p className="hint">No problems found.</p>}
          <ul className="problems">
            {problems.map((p, i) => (
              <li key={i} onClick={() => focusProblem(p)} className={p.blockId ? 'link' : ''}>
                {p.blockId && <b>{p.blockId}: </b>}{p.message}
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems(ctx)} onClose={() => setCtx(null)} />}

      <datalist id="fbd-entities">
        {entities.map(e => <option key={e.entity_id} value={e.entity_id}>{e.name}</option>)}
      </datalist>
    </div>
  );
}
