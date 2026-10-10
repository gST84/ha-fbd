import { useCallback, useEffect, useRef, useState } from 'react';
import { get, send } from './api';
import { ThemeSelect } from './ThemeSelect';
import type { AutomationSummary, GlobalStatus } from './types';

export function AutomationsPage({ onOpen }: { onOpen(id: string): void }) {
  const [list, setList] = useState<AutomationSummary[] | null>(null);
  const [global, setGlobal] = useState<GlobalStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [toast, setToast] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

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
  const remove = async (a: AutomationSummary) => {
    if (!confirm(`Delete the automation "${a.name}"? Its program and stored variables are removed.`)) return;
    await fetch(`api/automations/${a.id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="app autos">
      <header className="top">
        <b className="brand">FBD Automation</b>
        <span className={'pill ' + (global?.ha === 'connected' ? 'ok' : 'bad')} data-testid="ha-pill">HA {global?.ha ?? 'offline'}</span>
        {global && <span className="muted small">{global.automations.running} of {global.automations.total} running · {global.entities} entities</span>}
        <span className="grow" />
        <ThemeSelect />
        <button data-testid="new-automation" onClick={() => setCreating(true)}>+ New automation</button>
      </header>
      {toast && <div className="toast" data-testid="toast">{toast}</div>}

      <main className="auto-main">
        <h1>Automations</h1>
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
