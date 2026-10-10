// Bundles the editor into ../server/public (index.html + assets/app.js + assets/app.css).
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../server/public');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [path.join(here, 'src/main.tsx')],
  outdir: path.join(publicDir, 'assets'),
  entryNames: 'app',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  logLevel: 'info',
};

mkdirSync(publicDir, { recursive: true });
copyFileSync(path.join(here, 'index.html'), path.join(publicDir, 'index.html'));
if (watch) { const ctx = await context(options); await ctx.watch(); console.log('watching…'); }
else await build(options);
