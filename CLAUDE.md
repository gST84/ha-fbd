# FBD Automation – project notes for Claude Code

Home Assistant add-on to program automations as IEC 61131-3 function block diagrams (TIA-Portal-style stacked networks, internal variables, PLC-like cyclic scan, default 100 ms). TypeScript only. Tested on a real Home Assistant OS as a local add-on (Samba/SSH deploy). The owner communicates in Dutch or English – reply in the language of the message. Docs are in English.

## Layout
- `packages/engine` – pure TS engine: block definitions (`src/blocks/*.ts`), `compile.ts` (type check, one driver per input, topological order, loops only via variables), `runtime.ts` (scan: variables read at start, written at end; commands on change / rising edge), `docs.ts` (hover docs; every pin of every listed block must be documented), `families.ts` (block-type menu).
- `packages/server` – HA websocket client, `ProgramHost` per automation, `AutomationManager`, `Store`, HTTP + SSE API.
- `packages/editor` – React + SVG editor (esbuild → `packages/server/public`). `ops.ts` holds all pure program edits (undo/redo relies on identity-preserving results).
- `addon/ha_fbd` – add-on definition (config.yaml, Dockerfile, DOCS.md, icon/logo). `scripts/package-addon.mjs` stages a ready-to-copy folder in `dist-addon/ha_fbd` (the Dockerfile needs sources inside the add-on folder).
- `docs/` – documentation; `docs/BLOCKS.md` is generated: `npx tsx scripts/gen-block-docs.ts` (CI fails when it is stale). Screenshots come from the browser tests (`SHOTS=./shots`).

## Commands
- `npm install`, `npm test` (engine + server + editor unit tests), `npm run build`, `npm run package:addon`.
- Browser E2E (needs playwright + Chromium): `cd packages/editor && npx tsx test/e2e.ts` (also `e2e-features.ts`, `e2e-features2.ts`). They use a fake HA websocket (`test/harness.ts`).
- Use `tsx --test --test-force-exit` for node tests (hangs otherwise).

## Decisions and conventions
- Room (area) switching is a *target* of SET / RESET (`target: "room"`, `areaId`, `domains`); SET = turn_on, RESET = turn_off, on a rising edge. The old `AREA_OUT` block is `hidden: true` (still runs) and `migrateLegacy` in `ops.ts` converts it on load.
- `TIME_OF_DAY` lives in the Timers category. It uses HA's time zone (`ctx.clock()`).
- Editor numeric inputs are lazy drafts parsed with `parseNumber` (accepts `1,5` and `1.5`).
- The add-on UI is Ingress-only (`INGRESS_ONLY=1`).
- Version: `addon/ha_fbd/config.yaml` + `CHANGELOG.md` – bump both for every release (currently 0.5.0).

## Open idea
Restructure into a real Home Assistant add-on repository (`repository.yaml`, sources inside the add-on folder) so the add-on can be installed straight from GitHub instead of copying `dist-addon/ha_fbd`. Not decided.
