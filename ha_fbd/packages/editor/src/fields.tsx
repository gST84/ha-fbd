import { useEffect, useRef, useState } from 'react';

interface TextProps {
  label: string; value: string; onChange(v: string): void; beginTx(): void;
  placeholder?: string; list?: string; invalid?: boolean; hint?: string;
  /** lazy: keep a local draft and only call onChange on blur / Enter (use for numbers: "1," or "1." must stay as typed) */
  lazy?: boolean; multiline?: boolean; testId?: string;
}

/** Text input that groups a burst of typing into ONE undo step. */
export function TextField(p: TextProps) {
  const touched = useRef(false);
  const [draft, setDraft] = useState(p.value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(p.value); }, [p.value]);

  const common = {
    value: p.lazy ? draft : p.value,
    placeholder: p.placeholder, spellCheck: false, 'data-testid': p.testId,
    className: p.invalid ? 'invalid' : undefined,
    onFocus: () => { focused.current = true; touched.current = false; },
    onChange: (e: { target: { value: string } }) => {
      const v = e.target.value;
      if (p.lazy) { setDraft(v); return; }
      if (!touched.current) { p.beginTx(); touched.current = true; }
      p.onChange(v);
    },
    onBlur: () => {
      focused.current = false;
      if (p.lazy && draft !== p.value) { p.beginTx(); p.onChange(draft); }
    },
  };
  return (
    <label className="field">
      <span>{p.label}</span>
      {p.multiline
        ? <textarea rows={3} {...common} />
        : <input {...common} list={p.list} onKeyDown={e => { if (p.lazy && e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />}
      {p.hint && <small>{p.hint}</small>}
    </label>
  );
}

export function SelectField(p: { label: string; value: string; options: { value: string; label?: string }[]; onChange(v: string): void; testId?: string; hint?: string }) {
  return (
    <label className="field">
      <span>{p.label}</span>
      <select value={p.value} data-testid={p.testId} onChange={e => p.onChange(e.target.value)}>
        {p.options.map(o => <option key={o.value} value={o.value}>{o.label ?? o.value}</option>)}
      </select>
      {p.hint && <small>{p.hint}</small>}
    </label>
  );
}

/** Compact input without a label that commits on blur / Enter (used in the variables table). */
export function DraftInput(p: { value: string; onCommit(v: string): void; placeholder?: string; ariaLabel?: string; className?: string }) {
  const [draft, setDraft] = useState(p.value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(p.value); }, [p.value]);
  return (
    <input value={draft} placeholder={p.placeholder} aria-label={p.ariaLabel} className={p.className} spellCheck={false}
      onFocus={() => { focused.current = true; }} onChange={e => setDraft(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      onBlur={() => { focused.current = false; if (draft !== p.value) p.onCommit(draft); }} />
  );
}

/** JSON object editor: commits on blur, shows a red border (and keeps the text) when the JSON is invalid. */
export function JsonField(p: { label: string; value: Record<string, unknown> | undefined; onCommit(v: Record<string, unknown> | undefined): void; beginTx(): void; placeholder?: string; hint?: string; testId?: string }) {
  const text = p.value === undefined ? '' : JSON.stringify(p.value);
  const [draft, setDraft] = useState(text);
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) { setDraft(text); setInvalid(false); } }, [text]);
  const commit = () => {
    focused.current = false;
    if (draft === text) return;
    if (!draft.trim()) { setInvalid(false); p.beginTx(); p.onCommit(undefined); return; }
    try {
      const v = JSON.parse(draft);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
      setInvalid(false); p.beginTx(); p.onCommit(v);
    } catch { setInvalid(true); }
  };
  return (
    <label className="field">
      <span>{p.label}</span>
      <textarea rows={3} value={draft} className={invalid ? 'invalid' : undefined} placeholder={p.placeholder} spellCheck={false} data-testid={p.testId}
        onFocus={() => { focused.current = true; }} onChange={e => setDraft(e.target.value)} onBlur={commit} />
      {invalid ? <small className="error">Not a valid JSON object – not saved yet</small> : p.hint && <small>{p.hint}</small>}
    </label>
  );
}
