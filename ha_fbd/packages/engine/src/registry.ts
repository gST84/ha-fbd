import type { BlockDef, PinDef } from './types.js';
import { logicBlocks } from './blocks/logic.js';
import { timingBlocks } from './blocks/timing.js';
import { ioBlocks } from './blocks/io.js';
import { homeBlocks } from './blocks/home.js';
import { BLOCK_DOCS, type BlockDoc } from './docs.js';

export const registry: Record<string, BlockDef> = {};
for (const b of [...logicBlocks, ...timingBlocks, ...ioBlocks, ...homeBlocks]) registry[b.type] = b;

export interface BlockInfo { type: string; category: string; description: string; inputs: PinDef[]; outputs: PinDef[]; doc?: BlockDoc }
/** Palette data for the editor (pins with default params). */
export function listBlocks(): BlockInfo[] {
  return Object.values(registry).filter(b => !b.hidden).map(b => ({
    type: b.type, category: b.category, description: b.description, inputs: b.inputs({}), outputs: b.outputs({}), doc: BLOCK_DOCS[b.type],
  }));
}
