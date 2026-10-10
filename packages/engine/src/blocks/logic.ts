import type { BlockDef } from '../types.js';
import { coerce, countParam, indexed, pin, toBool, toNum } from '../helpers.js';

const logicN = (type: string, description: string, fn: (v: boolean[]) => boolean): BlockDef => ({
  type, category: 'Logic', description,
  inputs: p => indexed('IN', countParam(p), 'BOOL'),
  outputs: () => [pin('OUT', 'BOOL')],
  exec: i => ({ OUT: fn(Object.values(i).map(v => toBool(v))) }),
});

const AND = logicN('AND', 'TRUE when all inputs are TRUE', v => v.every(Boolean));
const OR = logicN('OR', 'TRUE when at least one input is TRUE', v => v.some(Boolean));
const XOR = logicN('XOR', 'TRUE when an odd number of inputs are TRUE', v => v.filter(Boolean).length % 2 === 1);
const NOT: BlockDef = {
  type: 'NOT', category: 'Logic', description: 'Inverts the input',
  inputs: () => [pin('IN', 'BOOL')], outputs: () => [pin('OUT', 'BOOL')],
  exec: i => ({ OUT: !i.IN }),
};

const cmp = (type: string, description: string, any: boolean, fn: (a: any, b: any) => boolean): BlockDef => ({
  type, category: 'Compare', description,
  inputs: () => [pin('IN1', any ? 'ANY' : 'ANY_NUM'), pin('IN2', any ? 'ANY' : 'ANY_NUM')],
  outputs: () => [pin('OUT', 'BOOL')],
  exec: i => ({ OUT: fn(i.IN1, i.IN2) }),
});
const GT = cmp('GT', 'IN1 > IN2', false, (a, b) => a > b);
const GE = cmp('GE', 'IN1 >= IN2', false, (a, b) => a >= b);
const LT = cmp('LT', 'IN1 < IN2', false, (a, b) => a < b);
const LE = cmp('LE', 'IN1 <= IN2', false, (a, b) => a <= b);
const EQ = cmp('EQ', 'IN1 = IN2', true, (a, b) => a === b);
const NE = cmp('NE', 'IN1 <> IN2', true, (a, b) => a !== b);

const mathN = (type: string, description: string, fn: (v: number[]) => number): BlockDef => ({
  type, category: 'Math', description,
  inputs: p => indexed('IN', countParam(p), 'ANY_NUM'),
  outputs: () => [pin('OUT', 'REAL')],
  exec: i => ({ OUT: fn(Object.values(i).map(toNum)) }),
});
const ADD = mathN('ADD', 'Sum of all inputs', v => v.reduce((a, b) => a + b, 0));
const MUL = mathN('MUL', 'Product of all inputs', v => v.reduce((a, b) => a * b, 1));
const MIN = mathN('MIN', 'Smallest input', v => Math.min(...v));
const MAX = mathN('MAX', 'Largest input', v => Math.max(...v));

const bin = (type: string, description: string, fn: (a: number, b: number) => number): BlockDef => ({
  type, category: 'Math', description,
  inputs: () => [pin('IN1', 'ANY_NUM'), pin('IN2', 'ANY_NUM')],
  outputs: () => [pin('OUT', 'REAL')],
  exec: i => ({ OUT: fn(toNum(i.IN1), toNum(i.IN2)) }),
});
const SUB = bin('SUB', 'IN1 - IN2', (a, b) => a - b);
const DIV = bin('DIV', 'IN1 / IN2 (0 when dividing by zero)', (a, b) => (b === 0 ? 0 : a / b));
const MOD = bin('MOD', 'Remainder of IN1 / IN2 (0 when dividing by zero)', (a, b) => (b === 0 ? 0 : a % b));
const ABS: BlockDef = {
  type: 'ABS', category: 'Math', description: 'Absolute value',
  inputs: () => [pin('IN', 'ANY_NUM')], outputs: () => [pin('OUT', 'REAL')],
  exec: i => ({ OUT: Math.abs(toNum(i.IN)) }),
};
const LIMIT: BlockDef = {
  type: 'LIMIT', category: 'Math', description: 'Clamp IN between MN and MX',
  inputs: () => [pin('MN', 'ANY_NUM', 0), pin('IN', 'ANY_NUM'), pin('MX', 'ANY_NUM', 100)],
  outputs: () => [pin('OUT', 'REAL')],
  exec: i => ({ OUT: Math.min(toNum(i.MX), Math.max(toNum(i.MN), toNum(i.IN))) }),
};

const SEL: BlockDef = {
  type: 'SEL', category: 'Selection', description: 'OUT = G ? IN1 : IN0',
  inputs: () => [pin('G', 'BOOL'), pin('IN0', 'ANY'), pin('IN1', 'ANY')],
  outputs: () => [pin('OUT', 'ANY')],
  exec: i => ({ OUT: i.G ? i.IN1 : i.IN0 }),
};
const MUX: BlockDef = {
  type: 'MUX', category: 'Selection', description: 'OUT = IN<K>, K is clamped to the available inputs',
  inputs: p => [pin('K', 'ANY_NUM'), ...indexed('IN', countParam(p), 'ANY', 0)],
  outputs: () => [pin('OUT', 'ANY')],
  exec: i => {
    const n = Object.keys(i).length - 1;
    const k = Math.min(n - 1, Math.max(0, Math.trunc(toNum(i.K))));
    return { OUT: i[`IN${k}`] };
  },
};

const conv = (type: string, to: 'BOOL' | 'INT' | 'REAL' | 'STRING', description: string): BlockDef => ({
  type, category: 'Convert', description,
  inputs: () => [pin('IN', 'ANY')], outputs: () => [pin('OUT', to)],
  exec: i => ({ OUT: coerce(i.IN, to) }),
});

export const logicBlocks: BlockDef[] = [
  AND, OR, XOR, NOT, GT, GE, LT, LE, EQ, NE,
  ADD, SUB, MUL, DIV, MOD, ABS, MIN, MAX, LIMIT, SEL, MUX,
  conv('TO_BOOL', 'BOOL', 'Convert to BOOL'), conv('TO_INT', 'INT', 'Convert to INT (truncates)'),
  conv('TO_REAL', 'REAL', 'Convert to REAL'), conv('TO_STRING', 'STRING', 'Convert to STRING'),
];
