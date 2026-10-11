# @ha-fbd/engine

IEC 61131-3 style function block diagram engine. Pure TypeScript, no Home Assistant dependency.

    npm install
    npm test          # 24 tests
    npm run typecheck
    npm run build

## Usage

    import { Runtime, CyclicScheduler } from '@ha-fbd/engine';

    const rt = new Runtime(program, { io: { getEntity: id => haStates[id] } });
    new CyclicScheduler(rt, 100, result => {
      for (const cmd of result.commands) callHomeAssistant(cmd);   // switch / value / service
      publishToEditor(result.values);                               // live watch
    }).start();

## Semantics (PLC-like)
- One scan = read inputs, evaluate blocks in topological order, commit variables, return commands.
- Variables are read at scan start and written at scan end. Feedback loops must go through a variable.
- Unconnected input pins use the block param with the pin's name (e.g. `{ "PT": "5s" }`), else the pin default.
- ENTITY_OUT only emits on change (switch/value) or rising edge (service).
- ENTITY_IN holds the last valid value when the entity is unavailable and sets AVAIL = FALSE.
- TIME values are milliseconds; "T#5s", "5s", "2m", "1h" are accepted as params.
