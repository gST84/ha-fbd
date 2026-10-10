import type { BlockDef } from '../types.js';
import { pin, toBool, toNum } from '../helpers.js';

const IEC_MAX = 32767;
const IEC_MIN = -32768;

// ── Timers ──────────────────────────────────────────────────────────────
const TON: BlockDef<{ start: number | null }> = {
  type: 'TON', category: 'Timers', description: 'On-delay: Q goes TRUE PT after IN went TRUE',
  inputs: () => [pin('IN', 'BOOL'), pin('PT', 'TIME', 1000)],
  outputs: () => [pin('Q', 'BOOL'), pin('ET', 'TIME')],
  init: () => ({ start: null }),
  exec(i, s, ctx) {
    const PT = toNum(i.PT);
    if (!i.IN) { s.start = null; return { Q: false, ET: 0 }; }
    s.start ??= ctx.now;
    const et = Math.min(ctx.now - s.start, PT);
    return { Q: et >= PT, ET: et };
  },
};

const TOF: BlockDef<{ start: number | null; active: boolean }> = {
  type: 'TOF', category: 'Timers', description: 'Off-delay: Q stays TRUE for PT after IN went FALSE',
  inputs: () => [pin('IN', 'BOOL'), pin('PT', 'TIME', 1000)],
  outputs: () => [pin('Q', 'BOOL'), pin('ET', 'TIME')],
  init: () => ({ start: null, active: false }),
  exec(i, s, ctx) {
    const PT = toNum(i.PT);
    if (i.IN) { s.active = true; s.start = null; return { Q: true, ET: 0 }; }
    if (!s.active) return { Q: false, ET: 0 };
    s.start ??= ctx.now;
    const et = Math.min(ctx.now - s.start, PT);
    if (et >= PT) { s.active = false; return { Q: false, ET: PT }; }
    return { Q: true, ET: et };
  },
};

const TP: BlockDef<{ start: number; running: boolean; prev: boolean }> = {
  type: 'TP', category: 'Timers', description: 'Pulse: Q is TRUE for PT after a rising edge on IN (not retriggerable)',
  inputs: () => [pin('IN', 'BOOL'), pin('PT', 'TIME', 1000)],
  outputs: () => [pin('Q', 'BOOL'), pin('ET', 'TIME')],
  init: () => ({ start: 0, running: false, prev: false }),
  exec(i, s, ctx) {
    const PT = toNum(i.PT);
    const IN = toBool(i.IN);
    const rising = IN && !s.prev;
    s.prev = IN;
    if (!s.running && rising) { s.running = true; s.start = ctx.now; }
    if (s.running) {
      const et = Math.min(ctx.now - s.start, PT);
      if (et >= PT) { s.running = false; return { Q: false, ET: PT }; }
      return { Q: true, ET: et };
    }
    return { Q: false, ET: IN ? PT : 0 };
  },
};

// ── Edge detection ──────────────────────────────────────────────────────
const edge = (type: string, rising: boolean): BlockDef<{ prev: boolean }> => ({
  type, category: 'Edge', description: rising ? 'One-scan pulse on rising edge' : 'One-scan pulse on falling edge',
  inputs: () => [pin('CLK', 'BOOL')], outputs: () => [pin('Q', 'BOOL')],
  init: () => ({ prev: false }),
  exec(i, s) {
    const clk = toBool(i.CLK);
    const q = rising ? clk && !s.prev : !clk && s.prev;
    s.prev = clk;
    return { Q: q };
  },
});

// ── Bistables ───────────────────────────────────────────────────────────
const SR: BlockDef<{ q: boolean }> = {
  type: 'SR', category: 'Bistable', description: 'Set-dominant flip-flop',
  inputs: () => [pin('S1', 'BOOL'), pin('R', 'BOOL')], outputs: () => [pin('Q1', 'BOOL')],
  init: () => ({ q: false }),
  exec(i, s) { s.q = toBool(i.S1) || (s.q && !toBool(i.R)); return { Q1: s.q }; },
};
const RS: BlockDef<{ q: boolean }> = {
  type: 'RS', category: 'Bistable', description: 'Reset-dominant flip-flop',
  inputs: () => [pin('S', 'BOOL'), pin('R1', 'BOOL')], outputs: () => [pin('Q1', 'BOOL')],
  init: () => ({ q: false }),
  exec(i, s) { s.q = !toBool(i.R1) && (toBool(i.S) || s.q); return { Q1: s.q }; },
};

// ── Counters ────────────────────────────────────────────────────────────
const CTU: BlockDef<{ cv: number; prev: boolean }> = {
  type: 'CTU', category: 'Counters', description: 'Count up on rising edge of CU; R resets',
  inputs: () => [pin('CU', 'BOOL'), pin('R', 'BOOL'), pin('PV', 'INT', 10)],
  outputs: () => [pin('Q', 'BOOL'), pin('CV', 'INT')],
  init: () => ({ cv: 0, prev: false }),
  exec(i, s) {
    const cu = toBool(i.CU); const up = cu && !s.prev; s.prev = cu;
    if (toBool(i.R)) s.cv = 0; else if (up && s.cv < IEC_MAX) s.cv++;
    return { Q: s.cv >= toNum(i.PV), CV: s.cv };
  },
};
const CTD: BlockDef<{ cv: number; prev: boolean }> = {
  type: 'CTD', category: 'Counters', description: 'Count down on rising edge of CD; LD loads PV',
  inputs: () => [pin('CD', 'BOOL'), pin('LD', 'BOOL'), pin('PV', 'INT', 10)],
  outputs: () => [pin('Q', 'BOOL'), pin('CV', 'INT')],
  init: () => ({ cv: 0, prev: false }),
  exec(i, s) {
    const cd = toBool(i.CD); const down = cd && !s.prev; s.prev = cd;
    if (toBool(i.LD)) s.cv = toNum(i.PV); else if (down && s.cv > IEC_MIN) s.cv--;
    return { Q: s.cv <= 0, CV: s.cv };
  },
};
const CTUD: BlockDef<{ cv: number; prevU: boolean; prevD: boolean }> = {
  type: 'CTUD', category: 'Counters', description: 'Up/down counter',
  inputs: () => [pin('CU', 'BOOL'), pin('CD', 'BOOL'), pin('R', 'BOOL'), pin('LD', 'BOOL'), pin('PV', 'INT', 10)],
  outputs: () => [pin('QU', 'BOOL'), pin('QD', 'BOOL'), pin('CV', 'INT')],
  init: () => ({ cv: 0, prevU: false, prevD: false }),
  exec(i, s) {
    const cu = toBool(i.CU), cd = toBool(i.CD);
    const up = cu && !s.prevU, down = cd && !s.prevD;
    s.prevU = cu; s.prevD = cd;
    if (toBool(i.R)) s.cv = 0;
    else if (toBool(i.LD)) s.cv = toNum(i.PV);
    else if (!(up && down)) {
      if (up && s.cv < IEC_MAX) s.cv++;
      else if (down && s.cv > IEC_MIN) s.cv--;
    }
    return { QU: s.cv >= toNum(i.PV), QD: s.cv <= 0, CV: s.cv };
  },
};

export const timingBlocks: BlockDef[] = [TON, TOF, TP, edge('R_TRIG', true), edge('F_TRIG', false), SR, RS, CTU, CTD, CTUD];
