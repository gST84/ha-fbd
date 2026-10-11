import type { BlockDef } from '../types.js';
import { pin, toBool, toNum } from '../helpers.js';

interface PidState { i: number; d: number; prevPv: number | null }

/**
 * Basic PID controller (positional form, "ideal" parameters):
 *   OUT = KP · ( e + 1/TI · ∫e dt + TD · d(–PV)/dt )      with e = SP – PV
 *  - TI = 0 switches the integral part off, TD = 0 the derivative part.
 *  - The derivative acts on the measurement (no kick when the setpoint changes) and is low-pass filtered (TD / 8).
 *  - Anti-windup: the integral part is held back so OUT never needs to "unwind" after hitting OUT_MIN / OUT_MAX.
 *  - A negative KP gives reverse action (cooling: more output when PV is above SP).
 *  - While EN is FALSE the controller is reset and OUT = OUT_MIN.
 * The time step is the real time between two scans, so the result does not depend on the scan interval.
 */
const PID: BlockDef<PidState> = {
  type: 'PID', category: 'Control',
  description: 'PID controller: OUT follows KP, TI (integral time) and TD (derivative time) to bring PV to SP, limited to OUT_MIN … OUT_MAX',
  inputs: () => [
    pin('SP', 'REAL', 0), pin('PV', 'REAL', 0), pin('KP', 'REAL', 1), pin('TI', 'TIME', 0), pin('TD', 'TIME', 0),
    pin('OUT_MIN', 'REAL', 0), pin('OUT_MAX', 'REAL', 100), pin('EN', 'BOOL', true),
  ],
  outputs: () => [pin('OUT', 'REAL'), pin('ERR', 'REAL')],
  init: () => ({ i: 0, d: 0, prevPv: null }),
  exec(inp, s, ctx) {
    const a = toNum(inp.OUT_MIN), b = toNum(inp.OUT_MAX);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const sp = toNum(inp.SP), pv = toNum(inp.PV), kp = toNum(inp.KP);
    const err = sp - pv;
    if (!toBool(inp.EN)) { s.i = 0; s.d = 0; s.prevPv = pv; return { OUT: lo, ERR: err }; }

    const dt = Math.max(0, ctx.dt) / 1000;                         // seconds since the previous scan (0 on the first one)
    const ti = Math.max(0, toNum(inp.TI)) / 1000, td = Math.max(0, toNum(inp.TD)) / 1000;
    const p = kp * err;

    if (ti > 0 && dt > 0) s.i += (kp * err * dt) / ti;
    else if (ti <= 0) s.i = 0;

    if (td > 0 && dt > 0 && s.prevPv !== null) {
      const tf = td / 8;
      s.d = (tf / (tf + dt)) * s.d + ((kp * td) / (tf + dt)) * -(pv - s.prevPv);
    } else if (td <= 0) s.d = 0;
    s.prevPv = pv;

    let out = p + s.i + s.d;
    if (out > hi) { s.i -= out - hi; out = hi; }                    // anti-windup: keep the integral at the limit
    else if (out < lo) { s.i += lo - out; out = lo; }
    return { OUT: out, ERR: err };
  },
};

export const controlBlocks: BlockDef[] = [PID];
