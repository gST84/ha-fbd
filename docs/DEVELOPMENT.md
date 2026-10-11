# Development

Node.js 22+ and npm. The repo is an npm workspace.

```
npm install
npm test                 # builds the engine, then engine + server + editor unit tests
npm run build            # engine → editor bundle (into packages/server/public) → server
```

## Run against your real Home Assistant

1. In Home Assistant: *Profile → Security → Long-lived access tokens → Create token*.
2. ```
   HA_URL=http://homeassistant.local:8123 HA_TOKEN=xxxx DATA_DIR=./data npm run dev -w @ha-fbd/server
   ```
3. Open <http://localhost:8099>. Rebuild the editor with `npm run dev -w @ha-fbd/editor` (watch mode).

| Variable | Meaning |
|---|---|
| `HA_URL`, `HA_TOKEN` | Development credentials (in the add-on `SUPERVISOR_TOKEN` is used instead) |
| `DATA_DIR` | Where automations are stored (default `./data`) |
| `PORT` | HTTP port (default 8099) |
| `SCAN_MS` | Scan cycle in ms (default 100) |
| `INGRESS_ONLY=1` | Only accept the Supervisor's ingress address |
| `LOG_LEVEL` | debug / info / warning / error |

## Tests

| Suite | Command | Covers |
|---|---|---|
| Engine | `npm test -w @ha-fbd/engine` | blocks, compiler, runtime, time of day, rooms |
| Server | `npm test -w @ha-fbd/server` | HA client against a fake websocket, host, store, REST API |
| Editor unit | `npm test -w @ha-fbd/editor` | pure edit operations (`ops.ts`), layout, migration |
| Browser E2E | `cd packages/editor && npx tsx test/e2e.ts` (also `e2e-features.ts`, `e2e-features2.ts`) | the real editor in headless Chromium against a fake HA |

The browser tests need `playwright` with a Chromium install (`npx playwright install chromium`) and write screenshots to `$SHOTS` (default `/home/claude/shots` – set `SHOTS=./shots`).

## Regenerating docs and screenshots

```
npx tsx scripts/gen-block-docs.ts        # docs/BLOCKS.md from the engine's block documentation
SHOTS=./shots npx tsx packages/editor/test/e2e-features2.ts   # fresh screenshots, copy the ones you need to docs/screenshots
```

## Adding a block

1. Define a `BlockDef` in `packages/engine/src/blocks/*.ts` (pins, `validate`, `exec`) and add it to that file's export list.
2. Document it in `packages/engine/src/docs.ts` – every pin must be documented (a test enforces it).
3. Optionally add it to a family in `families.ts` so it appears in the “change block type” menu.
4. Add default parameters in `packages/editor/src/ops.ts` (`defaultParams`) and a subtitle in `geometry.ts` if it has parameters.
5. For a property form add a section in `Properties.tsx`.
6. Add engine tests; run `npm test`; regenerate `docs/BLOCKS.md`.

To retire a block without breaking saved programs, set `hidden: true` (it still runs) and add a migration to `migrateLegacy` in `ops.ts`.

## Packaging

```
npm run package:addon    # → dist-addon/ha_fbd  (copy to the "addons" share)
```
The editor bundle is built inside the Docker image, so only sources are staged. Bump `version` in `addon/ha_fbd/config.yaml` and add an entry to `CHANGELOG.md` for every release.
