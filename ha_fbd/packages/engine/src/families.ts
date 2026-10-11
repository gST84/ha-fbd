/** Blocks that can be exchanged for each other in the editor ("click the name on the block"). */
export const BLOCK_FAMILIES: string[][] = [
  ['AND', 'OR', 'XOR', 'NOT'],
  ['GT', 'GE', 'LT', 'LE', 'EQ', 'NE'],
  ['ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'MIN', 'MAX'],
  ['TON', 'TOF', 'TP'],
  ['R_TRIG', 'F_TRIG'],
  ['SR', 'RS'],
  ['CTU', 'CTD', 'CTUD'],
  ['TO_BOOL', 'TO_INT', 'TO_REAL', 'TO_STRING'],
  ['SET', 'RESET', 'TOGGLE'],
];
export const familyOf = (type: string): string[] => BLOCK_FAMILIES.find(f => f.includes(type)) ?? [type];
