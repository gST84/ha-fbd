// Stages a ready-to-copy local add-on folder:  <repo>/dist-addon/ha_fbd
// Only needed to test an unreleased build as a *local* add-on (Samba "addons" share);
// normal installs add the GitHub repository to the add-on store instead.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, '..', 'dist-addon', 'ha_fbd');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copy = (from) => {
  const src = path.join(root, from);
  if (!existsSync(src)) return;
  cpSync(src, path.join(out, from), { recursive: true });
};

// add-on definition
for (const f of ['config.yaml', 'Dockerfile', '.dockerignore', 'DOCS.md', 'CHANGELOG.md', 'icon.png', 'logo.png']) copy(f);

// monorepo sources (no tests, no build output, no node_modules)
copy('package.json');
for (const pkg of ['engine', 'editor', 'server']) {
  copy(`packages/${pkg}/package.json`);
  copy(`packages/${pkg}/tsconfig.json`);
  copy(`packages/${pkg}/src`);
}
copy('packages/editor/build.mjs');
copy('packages/editor/index.html');   // the editor bundle is built inside the image

console.log(`Add-on staged in ${out}\nCopy the folder "ha_fbd" to  \\\\<your-ha>\\addons\\`);
