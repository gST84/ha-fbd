// Stages a complete, ready-to-copy local add-on folder:  dist-addon/ha_fbd
// Copy that folder to the Samba "addons" share of your Home Assistant.
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-addon', 'ha_fbd');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copy = (from, to = from) => {
  const src = path.join(root, from);
  if (!existsSync(src)) return;
  cpSync(src, path.join(out, to), { recursive: true });
};

// add-on definition (config.yaml, Dockerfile, DOCS.md)
for (const f of readdirSync(path.join(root, 'addon', 'ha_fbd'))) copy(path.join('addon', 'ha_fbd', f), f);

// monorepo sources (no tests, no build output, no node_modules)
copy('package.json');
for (const pkg of ['engine', 'editor', 'server']) {
  copy(`packages/${pkg}/package.json`);
  copy(`packages/${pkg}/tsconfig.json`);
  copy(`packages/${pkg}/src`);
}
copy('packages/editor/build.mjs');
copy('packages/editor/index.html');
copy('packages/server/public/console.html');   // the editor bundle is built inside the image

console.log(`Add-on staged in ${out}\nCopy the folder "ha_fbd" to  \\\\<your-ha>\\addons\\`);
