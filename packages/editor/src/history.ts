import { useCallback, useState } from 'react';
import type { Program } from '@ha-fbd/engine';

interface State { present: Program; past: Program[]; future: Program[] }
export type EditMode = 'commit' | 'drag';
export type Edit = (fn: (p: Program) => Program, mode?: EditMode) => void;

const LIMIT = 100;

/**
 * Program state with undo/redo.
 *  edit(fn)            → one undo step
 *  beginTx() + edit(fn, 'drag') … → many live updates (dragging, typing) that become one undo step
 */
export function useHistory(initial: Program) {
  const [s, setS] = useState<State>({ present: initial, past: [], future: [] });

  const edit: Edit = useCallback((fn, mode = 'commit') => setS(cur => {
    const next = fn(cur.present);
    if (next === cur.present) return cur;
    return mode === 'commit'
      ? { present: next, past: [...cur.past, cur.present].slice(-LIMIT), future: [] }
      : { ...cur, present: next };
  }), []);

  const beginTx = useCallback(() => setS(cur => ({ ...cur, past: [...cur.past, cur.present].slice(-LIMIT), future: [] })), []);
  const undo = useCallback(() => setS(cur => cur.past.length
    ? { present: cur.past[cur.past.length - 1], past: cur.past.slice(0, -1), future: [cur.present, ...cur.future] } : cur), []);
  const redo = useCallback(() => setS(cur => cur.future.length
    ? { present: cur.future[0], past: [...cur.past, cur.present], future: cur.future.slice(1) } : cur), []);
  const load = useCallback((p: Program) => setS({ present: p, past: [], future: [] }), []);

  return { program: s.present, edit, beginTx, undo, redo, load, canUndo: s.past.length > 0, canRedo: s.future.length > 0 };
}
