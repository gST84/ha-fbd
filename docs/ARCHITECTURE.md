# Architecture

```
┌────────── Home Assistant ──────────┐
│  websocket API (Supervisor proxy)  │
└───────▲──────────────┬─────────────┘
        │ commands     │ states, events
┌───────┴──────────────▼─────────────┐   ┌────────────────────┐
│ packages/server                    │   │ packages/editor    │
│  HAClient  – auth, entity cache,   │◀──│ React + SVG, built │
│              events, areas, tz     │   │ with esbuild into  │
│  ProgramHost (one per automation)  │   │ server/public      │
│   └─ Runtime (packages/engine)     │──▶│ REST + SSE (watch) │
│  AutomationManager, Store, HTTP    │   └────────────────────┘
└────────────────────────────────────┘
```

## packages/engine (pure TypeScript)
- **Types:** `BOOL, INT, REAL, STRING, TIME`; pin types additionally `ANY` and `ANY_NUM`.
- **BlockDef:** `type`, `category`, `inputs(params)`, `outputs(params)`, optional `init`, `validate`, `exec`, and `hidden` (kept for old programs, not shown in the palette – used by the legacy `AREA_OUT`).
- **compile:** checks pin types, one driver per input and parameter validity, then orders blocks by Kahn's topological sort. Loops are only allowed through variables.
- **Runtime.scan():** reads variables, executes blocks in order, writes variables, and returns the values (for the live view) and `OutputCommand`s.
- **OutputCommand:** `switch | value | attribute | service | event | area`. Commands are produced on change or on a rising edge, and the first scan only writes when `writeOnFirstScan` is set.
- **IOAdapter:** `getEntity(id)` and `drainEvents()`, implemented by the server. `ctx.clock()` gives the local time of day in Home Assistant's time zone.
- **docs.ts / families.ts:** the hover documentation and the block families used by the “change block type” menu. A test checks that every pin of every listed block is documented.

## packages/server
- **HAClient** – websocket authentication, entity state cache, event subscriptions, `fireEvent`, areas (area / device / entity registries, so devices inherit their device's area), time zone, `callService` (with `target`).
- **ProgramHost** – runs one automation: scan timer, deploy / start / stop, log, translates `OutputCommand`s to service calls (`area` → one call per device kind with `target: { area_id }` or, for a zone, `{ floor_id }`).
- **AutomationManager** – many automations, legacy migration, restart of the ones that were running.
- **Store** – `automations/<id>.json` (program) and `state/<id>.json` (run flag and *retain* variables) below `DATA_DIR` (`/data` in the add-on).
- **HTTP** – static editor + JSON API, `INGRESS_ONLY=1` restricts access to the Supervisor's ingress address.

### REST API (all under `/api`)

| Route | Meaning |
|---|---|
| `GET /automations`, `POST /automations` | list / create |
| `GET/PUT/DELETE /automations/:id` | program |
| `POST /automations/:id/validate | deploy | start | stop | duplicate` | lifecycle |
| `GET /automations/:id/status | log` | status, log |
| `GET /automations/:id/watch` | Server-Sent Events with live values |
| `GET /export`, `GET /export?id=:id` | download all / one automation as an export file (`{ format: "ha-fbd-export", version: 1, automations: Program[] }`) |
| `POST /import` | export file or a single program → new, stopped automations |
| `GET /status`, `GET /entities`, `GET /areas` (rooms + zones/floors), `GET /blocks` | data for the editor |

## packages/editor
- `ops.ts` – pure, immutable program edits (add / move / wire / paste / change type / migrate legacy blocks); everything the UI changes goes through here, which makes undo / redo trivial (`history.ts`).
- `geometry.ts` – block layout, subtitles, wire routing. `NetworkView.tsx` – SVG rendering and interaction. `Properties.tsx` – per-block forms. `Palette.tsx` – palette and hover help.
- Theme: `data-theme` on `<html>`; *Auto* reads Home Assistant's dark-mode flag from the parent page (Ingress is same-origin) and falls back to the browser setting.

## Program file format

```json
{
  "version": 1,
  "name": "Hall light",
  "variables": [{ "name": "visitor", "type": "BOOL", "kind": "local", "init": false }],
  "networks": [{
    "id": "net_1", "title": "",
    "blocks": [
      { "id": "entity_in_1", "type": "ENTITY_IN", "x": 60, "y": 20, "params": { "entityId": "binary_sensor.motion", "dataType": "BOOL" } },
      { "id": "tof_1", "type": "TOF", "x": 260, "y": 20, "params": { "PT": "3m" } },
      { "id": "reset_1", "type": "RESET", "x": 460, "y": 20, "params": { "target": "room", "areaId": "living_room", "domains": ["light"] } }
    ],
    "wires": [
      { "from": { "block": "entity_in_1", "pin": "OUT" }, "to": { "block": "tof_1", "pin": "IN" } },
      { "from": { "block": "tof_1", "pin": "Q" }, "to": { "block": "reset_1", "pin": "IN" } }
    ]
  }]
}
```
