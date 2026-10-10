import { parseNumber, type DataType, type Program, type Value } from '@ha-fbd/engine';
import { DraftInput } from './fields';
import type { Edit } from './history';
import { addVariable, deleteVariable, updateVariable } from './ops';

const TYPES: DataType[] = ['BOOL', 'INT', 'REAL', 'STRING', 'TIME'];

/** Text → initial value. Decimal comma and point both work ("1,5" = 1.5). */
const parseInit = (t: DataType, raw: string): Value => {
  if (t === 'BOOL') return raw === 'true';
  if (t === 'STRING' || t === 'TIME') return raw;
  const n = parseNumber(raw);
  return n === undefined ? 0 : t === 'INT' ? Math.trunc(n) : n;
};
const show = (v: Value | undefined) => (v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));

export function VariablesPanel({ program, edit, beginTx, live }: { program: Program; edit: Edit; beginTx(): void; live: Record<string, Value> | null }) {
  return (
    <div className="vars">
      <p className="hint">Variables are the memory of an automation: they share values between networks and carry results to the next scan (read at the start of a scan, written at the end). <b>retain</b> variables survive restarts.</p>
      {program.variables.map((v, i) => (
        <div className="var" key={i} data-var={v.name}>
          <div className="var-top">
            <input className="vname" value={v.name} spellCheck={false} aria-label="name" placeholder="name"
              onFocus={beginTx} onChange={e => edit(p => updateVariable(p, i, { name: e.target.value.replace(/\s+/g, '_') }), 'drag')} />
            <button className="icon" title="Delete variable" onClick={() => edit(p => deleteVariable(p, i))}>✕</button>
          </div>
          <div className="var-bot">
            <select value={v.type} aria-label="type" onChange={e => edit(p => updateVariable(p, i, { type: e.target.value as DataType }))}>
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={v.kind} aria-label="kind" title="retain = survives a restart" onChange={e => edit(p => updateVariable(p, i, { kind: e.target.value as 'local' | 'retain' }))}>
              <option>local</option><option>retain</option>
            </select>
            {v.type === 'BOOL'
              ? <select value={String(v.init ?? false)} aria-label="initial" onChange={e => edit(p => updateVariable(p, i, { init: e.target.value === 'true' }))}>
                  <option value="false">init FALSE</option><option value="true">init TRUE</option></select>
              : <DraftInput ariaLabel="initial" placeholder="initial" value={v.init === undefined ? '' : String(v.init)}
                  onCommit={raw => { beginTx(); edit(p => updateVariable(p, i, { init: parseInit(v.type, raw) }), 'drag'); }} />}
          </div>
          {live && <div className="vlive" title="live value">now: <b className={live[v.name] === true ? 't' : undefined}>{show(live[v.name])}</b></div>}
        </div>
      ))}
      <button className="sec" data-testid="add-variable" onClick={() => edit(addVariable)}>+ Add variable</button>
    </div>
  );
}
