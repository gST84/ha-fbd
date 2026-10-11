import { useCallback, useEffect, useRef, useState } from 'react';
import { get, send } from './api';
import { Logo } from './Logo';
import { ThemeSelect } from './ThemeSelect';
import type { AutomationSummary, GlobalStatus } from './types';

export function AutomationsPage({ onOpen }: { onOpen(id: string): void }) {
  const [list, setList] = useState<AutomationSummary[] | null>(null);
  const [global, setGlobal] = useState<GlobalStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [toast, setToast] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLTextAreaElement>(null);
  const [exported, setExported] = useState<{ file: string; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [l, g] = await Promise.all([get<AutomationSummary[]>('automations'), get<GlobalStatus>('status')]);
      setList(Array.isArray(l.body) ? l.body : []); setGlobal(g.body);
    } catch { setList(null); setGlobal(null); }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 2000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { if (creating) nameRef.current?.focus(); }, [creating]);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  const create = async () => {
    const r = await send<{ id: string }>('POST', 'automations', { name: name.trim() || 'New automation' });
    if (r.body?.id) onOpen(r.body.id); else say('Could not create the automation');
  };
  const toggle = async (a: AutomationSummary) => {
    const r = await send<{ ok: boolean; errors?: { message: string }[] }>('POST', `automations/${a.id}/${a.running ? 'stop' : 'start'}`);
    if (r.body?.ok === false) say(`Cannot start "${a.name}": ${r.body.errors?.[0]?.message ?? 'the program has errors'}`);
    refresh();
  };
  const duplicate = async (a: AutomationSummary) => { await send('POST', `automations/${a.id}/duplicate`); refresh(); };
  // Export: try a normal file download, and always show the text as well – the Home Assistant apps
  // (and some embedded browsers) silently ignore downloads from the add-on panel.
  const exportNow = async (query = '') => {
    try {
      const r = await fetch('api/export' + query);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      const file = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'fbd-automations.fbd.json';
      setImporting(false); setExported({ file, text });
      saveFile(file, text);
    } catch (e) { say(`Export failed: ${e instanceof Error ? e.message : e}`); }
  };
  const saveFile = (file: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = file; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const copyExport = async () => {
    const el = exportRef.current; if (!el) return;
    try { await navigator.clipboard.writeText(el.value); }
    catch { el.focus(); el.select(); document.execCommand('copy'); }             // clipboard API is not always allowed in the panel iframe
    say('Copied to the clipboard');
  };
  const importText = async (text: string, source: string) => {
    let body: unknown;
    try { body = JSON.parse(text); } catch { say(`${source} is not valid JSON`); return; }
    const r = await send<{ imported?: { id: string; name: string }[]; error?: string }>('POST', 'import', body);
    const n = r.body?.imported?.length;
    say(n ? `Imported ${n} automation${n === 1 ? '' : 's'} (stopped – start them when you are ready)` : `Import failed: ${r.body?.error ?? 'unknown error'}`);
    if (n) { setImporting(false); setPasted(''); }
    refresh();
  };
  const remove = async (a: AutomationSummary) => {
    if (!confirm(`Delete the automation "${a.name}"? Its program and stored variables are removed.`)) return;
    await fetch(`api/automations/${a.id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="app autos">
      <header className="top">
        <Logo /><b className="brand">FBD Automation</b>
        <span className={'pill ' + (global?.ha === 'connected' ? 'ok' : 'bad')} data-testid="ha-pill">HA {global?.ha ?? 'offline'}</span>
        {global && <span className="muted small">{global.automations.running} of {global.automations.total} running · {global.entities} entities</span>}
        <span className="grow" />
        <ThemeSelect />
        <button className="sec" data-testid="import" title="Add the automations from an export file" onClick={() => { setExported(null); setImporting(true); }}>Import</button>
        <button className="sec" data-testid="export-all" title="Export all automations as one file" disabled={!list?.length} onClick={() => exportNow()}>Export all</button>
        <button data-testid="new-automation" onClick={() => setCreating(true)}>+ New automation</button>
      </header>
      {toast && <div className="toast" data-testid="toast">{toast}</div>}

      <main className="auto-main">
        <h1>Automations</h1>
        {exported && (
          <div className="card" data-testid="export-card">
            <label>Export – {exported.file}
              <textarea ref={exportRef} className="export-text" readOnly value={exported.text} onFocus={e => e.target.select()} data-testid="export-text" />
            </label>
            <p className="muted small">The file should be in your downloads. If nothing was downloaded (this happens in the Home Assistant app), copy the text instead and paste it under <i>Import</i> on the other installation, or save it as a <code>.json</code> file.</p>
            <div className="row">
              <button type="button" onClick={copyExport} data-testid="export-copy">Copy text</button>
              <button type="button" className="sec" onClick={() => saveFile(exported.file, exported.text)}>Download again</button>
              <button type="button" className="sec" onClick={() => setExported(null)}>Close</button>
            </div>
          </div>
        )}
        {importing && (
          <form className="card" data-testid="import-card" onSubmit={e => { e.preventDefault(); importText(pasted, 'The pasted text'); }}>
            <label>Import automations
              <textarea className="export-text" value={pasted} onChange={e => setPasted(e.target.value)} placeholder="Choose an export file, or paste the exported text here" data-testid="import-text" />
            </label>
            <p className="muted small">Imported automations are added as new, stopped automations. Nothing is overwritten.</p>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden data-testid="import-file"
              onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importText(await f.text(), `"${f.name}"`); }} />
            <div className="row">
              <button type="button" onClick={() => fileRef.current?.click()} data-testid="import-choose">Choose file…</button>
              <button type="submit" className="sec" disabled={!pasted.trim()} data-testid="import-pasted">Import pasted text</button>
              <button type="button" className="sec" onClick={() => { setImporting(false); setPasted(''); }}>Cancel</button>
            </div>
          </form>
        )}
        {creating && (
          <form className="card new" onSubmit={e => { e.preventDefault(); create(); }}>
            <label>Name of the new automation
              <input ref={nameRef} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Hallway light" data-testid="new-name" />
            </label>
            <div className="row">
              <button type="submit" data-testid="create">Create and open</button>
              <button type="button" className="sec" onClick={() => { setCreating(false); setName(''); }}>Cancel</button>
            </div>
          </form>
        )}
        {list === null && <p className="hint">Connecting to the add-on…</p>}
        {list?.length === 0 && !creating && (
          <div className="card empty-card">
            <h2>No automations yet</h2>
            <p>An automation is one program made of function block networks. Every automation runs on its own, with its own variables.</p>
            <button onClick={() => setCreating(true)}>Create your first automation</button>
          </div>
        )}
        {list && list.length > 0 && (
          <table className="auto-table">
            <thead><tr><th>Name</th><th>Status</th><th>Blocks</th><th>Scan</th><th /></tr></thead>
            <tbody>
              {list.map(a => (
                <tr key={a.id} data-auto={a.id}>
                  <td><a href={`#/a/${a.id}`} className="auto-link" onClick={e => { e.preventDefault(); onOpen(a.id); }}>{a.name}</a>
                    <div className="muted small">{a.networks} network{a.networks === 1 ? '' : 's'}</div></td>
                  <td>
                    <span className={'pill ' + (a.running ? 'ok' : '')}>{a.running ? 'running' : 'stopped'}</span>
                    {a.problems > 0 && <span className="pill bad" title="The program has problems – open it to see them">{a.problems} problem{a.problems === 1 ? '' : 's'}</span>}
                  </td>
                  <td>{a.blocks}</td>
                  <td className="muted">{a.running ? `${a.avgMs.toFixed(2)} ms${a.overruns ? ` · ${a.overruns} overruns` : ''}` : '–'}</td>
                  <td className="actions">
                    <button className="sec" data-testid="open" onClick={() => onOpen(a.id)}>Edit</button>
                    <button className="sec" data-testid="toggle" onClick={() => toggle(a)}>{a.running ? 'Stop' : 'Start'}</button>
                    <button className="icon" title="Export" data-testid="export-auto" onClick={() => exportNow(`?id=${a.id}`)}>⭳</button>
                    <button className="icon" title="Duplicate" onClick={() => duplicate(a)}>⧉</button>
                    <button className="icon" title="Delete" data-testid="delete-auto" onClick={() => remove(a)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
