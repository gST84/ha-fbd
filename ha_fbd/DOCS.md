# FBD Automation

Program Home Assistant automations as IEC 61131-3 function block diagrams.

## Options

| Option | Default | Meaning |
|---|---|---|
| `scan_ms` | 100 | PLC scan cycle in milliseconds (20–1000) |
| `write_on_first_scan` | true | Write the computed output state when the program starts |
| `log_level` | info | debug, info, warning or error |

## Using it
- The start page lists your **automations**. Each one has its own program, variables and scan loop and can be started and stopped separately.
- **+ New automation** creates one and opens the editor. Deploy validates, saves and starts it.
- Hover a block in the palette for help. Click the **name** of a block (AND, TON, …) to swap it for a related block.
- Right-click a block or the canvas for copy / cut / paste / delete. Ctrl/⌘ + C / X / V work too; shift-click or drag a box to select several; the side panels can be resized.

- **Time of day** (in the Timers section) gives TRUE inside a time window (also past midnight, optionally only on chosen weekdays) in Home Assistant's own time zone.
- **SET / RESET with target “Room”** switch all lights / media players / switches / fans / climate devices of a Home Assistant room (area) – or of a whole **zone** (floor, with all its rooms) – on (SET) or off (RESET) when the input rises. Rooms and zones are read from Home Assistant (Settings → Areas, Zones & Labels → Floors); the dropdown lists each zone with its rooms below it. Older “Room out” blocks are converted automatically.
- **PID** (section *Control*) is a basic PID controller: connect the measured value to `PV`, set `SP`, `KP`, and optionally `TI` / `TD`; `OUT` stays between `OUT_MIN` and `OUT_MAX`. See the block help for tuning tips.
- The theme (top right) is **Auto** (follows your Home Assistant light/dark setting), **Light** or **Dark**.

## Notes
- Programs from earlier versions are converted automatically into the automation "My first automation".
- The program, and the values of *retain* variables, are stored in `/data` and included in Home Assistant backups.
- Outputs are only written when they change (switch/value) or on a rising edge (service call).
