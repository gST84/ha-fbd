# FBD Automation – project notes for Claude Code

Home Assistant add-on to program automations as IEC 61131-3 function block diagrams (TIA-Portal-style stacked networks, internal variables, PLC-like cyclic scan, default 100 ms). TypeScript only. The repo is a Home Assistant add-on repository (`repository.yaml` + add-on folder `ha_fbd/`); users add the GitHub URL to the add-on store. The owner communicates in Dutch or English – reply in the language of the message. Docs are in English.

## Layout
Everything that is built lives inside `ha_fbd/` (the Supervisor uses that folder as Docker build context); it is also the npm workspace root. Paths below are relative to `ha_fbd/`.
- `config.yaml`, `Dockerfile`, `.dockerignore`, `DOCS.md`, `CHANGELOG.md`, icon/logo – add-on definition.
- `packages/engine` – pure TS engine: block definitions (`src/blocks/*.ts`), `compile.ts` (type check, one driver per input, topological order, loops only via variables), `runtime.ts` (scan: variables read at start, written at end; commands on change / rising edge), `docs.ts` (hover docs; every pin of every listed block must be documented), `families.ts` (block-type menu).
- `packages/server` – HA websocket client, `ProgramHost` per automation, `AutomationManager`, `Store`, HTTP + SSE API.
- `packages/editor` – React + SVG editor (esbuild → `packages/server/public`). `ops.ts` holds all pure program edits (undo/redo relies on identity-preserving results).
- `scripts/package-addon.mjs` stages a folder in `<repo>/dist-addon/ha_fbd` for testing as a *local* add-on (Samba/SSH).
- `<repo>/docs/` – documentation; `docs/BLOCKS.md` is generated: `npx tsx scripts/gen-block-docs.ts` from `ha_fbd/` (CI fails when it is stale). Screenshots come from the browser tests (`SHOTS=./shots`).

## Commands
Run from `ha_fbd/`.
- `npm install`, `npm test` (engine + server + editor unit tests), `npm run build`, `npm run package:addon`.
- Browser E2E (needs playwright + Chromium): `cd packages/editor && npx tsx test/e2e.ts` (also `e2e-features.ts`, `e2e-features2.ts`). They use a fake HA websocket (`test/harness.ts`).
- Use `tsx --test --test-force-exit` for node tests (hangs otherwise).

## Decisions and conventions
- Room (area) switching is a *target* of SET / RESET (`target: "room"`, `areaId` *or* `floorId` (zone = HA floor, wins over areaId), `domains`); SET = turn_on, RESET = turn_off, on a rising edge. The old `AREA_OUT` block is `hidden: true` (still runs) and `migrateLegacy` in `ops.ts` converts it on load.
- `TIME_OF_DAY` lives in the Timers category. It uses HA's time zone (`ctx.clock()`).
- Editor numeric inputs are lazy drafts parsed with `parseNumber` (accepts `1,5` and `1.5`).
- The add-on UI is Ingress-only (`INGRESS_ONLY=1`).
- Version: `ha_fbd/config.yaml` + `ha_fbd/CHANGELOG.md` – bump both for every release (currently 0.7.4). Pushing the bump to `main` is the release: installed add-ons pick it up from the repository.
- No other file named `config.yaml` / `config.json` may exist anywhere in the repo – the Supervisor treats each one as an add-on.
- Export / import (`GET /api/export`, `POST /api/import`, file format `ha-fbd-export`): programs only; imports always become new, stopped automations.
