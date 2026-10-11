// Generates docs/BLOCKS.md from the documentation that ships inside the engine.
//   npx tsx scripts/gen-block-docs.ts
import { writeFileSync } from 'node:fs';
import { listBlocks, pinDoc } from '../packages/engine/src/index.js';

const ORDER = ['Variables & I/O', 'Logic', 'Compare', 'Math', 'Selection', 'Convert', 'Timers', 'Edge', 'Bistable', 'Counters'];
const blocks = listBlocks();
const cats = [...new Set(blocks.map(b => b.category))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
const pinTable = (title: string, b: (typeof blocks)[number], side: 'inputs' | 'outputs') => {
  const pins = b[side];
  if (!pins.length) return '';
  return `**${title}**\n\n| Pin | Type | Meaning |\n|---|---|---|\n${pins.map(p => `| \`${p.name}\` | ${p.type} | ${pinDoc(b.doc, side, p.name) ?? ''} |`).join('\n')}\n\n`;
};
let md = '# Block reference\n\n> Generated from the documentation inside the engine (`npx tsx scripts/gen-block-docs.ts`). The same text is shown in the editor when you hover a block in the palette.\n\n';
md += cats.map(c => `- [${c}](#${c.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')})`).join('\n') + '\n\n';
for (const c of cats) {
  md += `## ${c}\n\n`;
  for (const b of blocks.filter(x => x.category === c)) {
    md += `### ${b.type}\n\n${b.doc?.summary ?? b.description}\n\n`;
    if (b.doc?.details) md += `${b.doc.details}\n\n`;
    md += pinTable('Inputs', b, 'inputs') + pinTable('Outputs', b, 'outputs');
    if (b.doc?.example) md += `*Example:* ${b.doc.example}\n\n`;
    if (b.doc?.notes?.length) md += b.doc.notes.map(n => `- ${n}`).join('\n') + '\n\n';
  }
}
writeFileSync(new URL('../../docs/BLOCKS.md', import.meta.url), md.trimEnd() + '\n');
console.log(`docs/BLOCKS.md: ${blocks.length} blocks`);
