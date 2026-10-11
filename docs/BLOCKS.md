# Block reference

> Generated from the documentation inside the engine (`npx tsx scripts/gen-block-docs.ts`). The same text is shown in the editor when you hover a block in the palette.

- [Variables & I/O](#variables-i-o)
- [Logic](#logic)
- [Compare](#compare)
- [Math](#math)
- [Selection](#selection)
- [Convert](#convert)
- [Timers](#timers)
- [Edge](#edge)
- [Bistable](#bistable)
- [Counters](#counters)

## Variables & I/O

### CONST

A fixed value.

Pick the data type and type the value in the properties panel. For decimals both 1.5 and 1,5 work.

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | The constant |

- For simple cases you can skip this block: unconnected inputs are constants too.

### ENTITY_IN

Read a Home Assistant entity.

Reads the state (or one attribute) of an entity and converts it to the chosen data type. BOOL is TRUE for on, true, home, open, detected (you can change this list; capitals do not matter).

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | The value |
| `AVAIL` | BOOL | FALSE while the entity is missing, unavailable or unknown |

*Example:* binary_sensor.hall_motion → BOOL.

- While the entity is unavailable, OUT keeps its last good value.

### ENTITY_OUT

Write to a Home Assistant entity.

Kinds: switch (BOOL → turn on/off), value (number → set value), attribute (set one attribute such as brightness or hvac_mode), service (call any service on a rising edge).

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | BOOL | Value to write (only written when it changes) |

*Example:* GT result → light.living (switch).

- Setting brightness on a light also turns the light on.
- Outputs are only sent when the value changes, never every scan.

### VAR_READ

Read an internal variable.

Variables are the memory of your program. They are shared between networks of the same automation. A variable is read at the START of a scan.

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | Value of the variable |

*Example:* Feed back a result from the previous scan (e.g. toggle).

### VAR_WRITE

Write an internal variable.

The value is stored at the END of the scan, so blocks that read the same variable in this scan still see the old value.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | BOOL | New value |

*Example:* Remember "last mode" for the next scan.

### SET

Set a BOOL variable (or switch an entity / a whole room ON) while IN is TRUE.

Like a SET coil in TIA Portal. With a variable target it forces the variable TRUE every scan IN is TRUE, and the variable keeps TRUE afterwards until a RESET block clears it. With an entity target it turns the entity on at the rising edge of IN. With a room target every selected kind of device (lights, media players, switches, fans, climate) in the chosen Home Assistant area is turned on at the rising edge of IN – Home Assistant looks up the devices itself.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | BOOL | Condition |

*Example:* Doorbell pressed → SET "visitor"; "visitor seen" → RESET "visitor".

- Room target: choose which kinds of devices are affected – "switch" may also include sockets of e.g. a fridge. The area must exist in Home Assistant (Settings → Areas).
- If SET and RESET on the same variable are both TRUE, the block that comes later in the program wins.

### RESET

Reset a BOOL variable (or switch an entity / a whole room OFF) while IN is TRUE.

Counterpart of SET. With a variable target it forces the variable FALSE while IN is TRUE. With an entity target it turns the entity off at the rising edge of IN. With a room target every selected kind of device in the chosen Home Assistant area is switched off at the rising edge of IN.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | BOOL | Condition |

*Example:* Good-night button → RESET room "living room": lights + media players off.

### EVENT_IN

React to a Home Assistant event.

Q is TRUE for exactly one scan when an event of this type arrives. Use "match" to filter on the event data, and "valuePath" to read a field of the event into VAL (e.g. "command").

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `Q` | BOOL | One-scan pulse when a matching event arrived |

*Example:* eventType zha_event, match {"device_ieee":"00:15:…","command":"on"} → wall switch pressed.

- Events are not remembered while the add-on is stopped.

### EVENT_OUT

Fire a Home Assistant event.

On a rising edge of IN an event with this type and data is fired on the Home Assistant bus. Other automations (or your own EVENT_IN) can listen to it.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | BOOL | Rising edge fires the event |

*Example:* Alarm triggered → fire "fbd_alarm" with {"zone":"hall"}.

## Logic

### AND

TRUE when ALL inputs are TRUE.

Choose the number of inputs (2–16) in the properties panel. An unconnected input counts as FALSE unless you set it to TRUE there.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | BOOL | BOOL condition |
| `IN2` | BOOL | BOOL condition |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | TRUE only if every input is TRUE |

*Example:* Motion detected AND it is dark → switch the light on.

### OR

TRUE when AT LEAST ONE input is TRUE.

Choose the number of inputs (2–16) in the properties panel. An unconnected input counts as FALSE unless you set it to TRUE there.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | BOOL | BOOL condition |
| `IN2` | BOOL | BOOL condition |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | TRUE if any input is TRUE |

*Example:* Front door open OR back door open → alarm pre-warning.

### XOR

TRUE when an ODD number of inputs are TRUE.

Choose the number of inputs (2–16) in the properties panel. An unconnected input counts as FALSE unless you set it to TRUE there.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | BOOL | BOOL condition |
| `IN2` | BOOL | BOOL condition |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | TRUE if an odd number of inputs are TRUE |

*Example:* Two switches that both toggle the same light (staircase switch).

### NOT

Inverts a BOOL.

TRUE becomes FALSE and FALSE becomes TRUE.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | BOOL | BOOL |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | The opposite of IN |

*Example:* Window open → NOT → "window closed".

## Compare

### GT

TRUE when IN1 > IN2.

Compares two numbers. Unconnected inputs are constants – type the value in the properties panel.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY_NUM | Left value |
| `IN2` | ANY_NUM | Right value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | TRUE while IN1 > IN2 |

*Example:* Temperature GT 25 → fan on.

### GE

TRUE when IN1 ≥ IN2.

Compares two numbers. Unconnected inputs are constants – type the value in the properties panel.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY_NUM | Left value |
| `IN2` | ANY_NUM | Right value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | TRUE while IN1 ≥ IN2 |

*Example:* Battery GE 20 → OK.

### LT

TRUE when IN1 < IN2.

Compares two numbers. Unconnected inputs are constants – type the value in the properties panel.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY_NUM | Left value |
| `IN2` | ANY_NUM | Right value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | TRUE while IN1 < IN2 |

*Example:* Lux LT 50 → it is dark.

### LE

TRUE when IN1 ≤ IN2.

Compares two numbers. Unconnected inputs are constants – type the value in the properties panel.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY_NUM | Left value |
| `IN2` | ANY_NUM | Right value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | TRUE while IN1 ≤ IN2 |

*Example:* Humidity LE 40 → air is dry.

### EQ

TRUE when IN1 = IN2.

Works with numbers, text and booleans. Text is compared exactly (case sensitive).

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY | Left value |
| `IN2` | ANY | Right value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | TRUE while IN1 = IN2 |

*Example:* Mode EQ "away" → alarm on.

### NE

TRUE when IN1 ≠ IN2.

Works with numbers, text and booleans. Text is compared exactly (case sensitive).

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY | Left value |
| `IN2` | ANY | Right value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | TRUE while IN1 ≠ IN2 |

*Example:* State NE "unavailable".

## Math

### ADD

Sum of all inputs.

Choose the number of inputs (2–16) in the properties panel. The result is a REAL (decimal) number.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY_NUM | Number |
| `IN2` | ANY_NUM | Number |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | REAL | Result |

*Example:* Power of three phases added up.

### SUB

IN1 − IN2.

Two inputs. Unconnected inputs are constants you set in the properties panel.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY_NUM | First value |
| `IN2` | ANY_NUM | Second value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | REAL | Result |

*Example:* Target temperature − actual temperature = error.

### MUL

Product of all inputs.

Choose the number of inputs (2–16) in the properties panel. The result is a REAL (decimal) number.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY_NUM | Number |
| `IN2` | ANY_NUM | Number |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | REAL | Result |

*Example:* Volume × price.

### DIV

IN1 ÷ IN2.

Two inputs. Unconnected inputs are constants you set in the properties panel.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY_NUM | First value |
| `IN2` | ANY_NUM | Second value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | REAL | Result |

*Example:* Energy ÷ hours = average power.

- Dividing by 0 gives 0 (no error).

### MOD

Remainder of IN1 ÷ IN2.

Two inputs. Unconnected inputs are constants you set in the properties panel.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY_NUM | First value |
| `IN2` | ANY_NUM | Second value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | REAL | Result |

*Example:* Counter MOD 2 = 0 → every second pulse.

- Dividing by 0 gives 0.

### ABS

Absolute value (drops the minus sign).

Always returns zero or a positive number.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | ANY_NUM | Number |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | REAL | |IN| |

### MIN

Smallest of all inputs.

Choose the number of inputs (2–16) in the properties panel. The result is a REAL (decimal) number.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY_NUM | Number |
| `IN2` | ANY_NUM | Number |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | REAL | Result |

*Example:* Coldest of several room sensors.

### MAX

Largest of all inputs.

Choose the number of inputs (2–16) in the properties panel. The result is a REAL (decimal) number.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN1` | ANY_NUM | Number |
| `IN2` | ANY_NUM | Number |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | REAL | Result |

*Example:* Hottest of several room sensors.

### LIMIT

Clamp IN between MN and MX.

If IN is below MN the result is MN; above MX the result is MX; otherwise IN passes through.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `MN` | ANY_NUM | Lower limit (default 0) |
| `IN` | ANY_NUM | Value to limit |
| `MX` | ANY_NUM | Upper limit (default 100) |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | REAL | The limited value |

*Example:* Brightness calculation limited to 0–255 before it goes to a light.

## Selection

### SEL

Choose between two values with a BOOL.

Works with any data type. Both values are always evaluated; G only decides which one is passed on.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `G` | BOOL | FALSE → IN0, TRUE → IN1 |
| `IN0` | ANY | Value when G is FALSE |
| `IN1` | ANY | Value when G is TRUE |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | ANY | The selected value |

*Example:* Night mode ? 20 % : 80 % brightness.

### MUX

Choose one of several values by number.

K = 0 selects IN0, K = 1 selects IN1 … K is clamped to the available inputs. Set the number of inputs in the properties panel.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `K` | ANY_NUM | Index (0, 1, 2 …) |
| `IN0` | ANY | Candidate value |
| `IN1` | ANY | Candidate value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | ANY | The selected value |

*Example:* Scene number → brightness for that scene.

## Convert

### TO_BOOL

Convert any value to BOOL.

Numbers: 0 = FALSE, anything else TRUE. Text: "on", "true", "1", "yes", "home", "open", "detected" = TRUE.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | ANY | Any value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | BOOL | The value as BOOL |

### TO_INT

Convert any value to INT.

Decimals are cut off (7.9 → 7). Text is parsed ("12" → 12, "1,5" → 1). TRUE = 1.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | ANY | Any value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | INT | The value as INT |

### TO_REAL

Convert any value to REAL.

Text is parsed as a number; both "1.5" and "1,5" work. TRUE = 1, FALSE = 0.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | ANY | Any value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | REAL | The value as REAL |

### TO_STRING

Convert any value to STRING.

Numbers and booleans become text.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | ANY | Any value |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `OUT` | STRING | The value as STRING |

## Timers

### TON

On-delay timer: Q turns TRUE after IN has been TRUE for PT.

If IN drops before the time has passed, the timer resets and Q never turns on.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | BOOL | Start / hold the timer |
| `PT` | TIME | Delay. Type e.g. 5s, 2m, 1h or milliseconds (default 1000 ms) |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `Q` | BOOL | TRUE once PT has elapsed (while IN stays TRUE) |
| `ET` | TIME | Elapsed time in ms |

*Example:* Door open for 5 minutes → send a notification.

- IN   __/‾‾‾‾‾‾‾‾\____
- Q    ____‾‾‾‾‾‾\____   (after PT)

### TOF

Off-delay timer: Q stays TRUE for PT after IN drops.

Q turns on immediately with IN and turns off PT after IN went FALSE. If IN comes back during the delay, the delay restarts.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | BOOL | Trigger |
| `PT` | TIME | Hold time. Type e.g. 3s, 5m, 1h (default 1000 ms) |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `Q` | BOOL | TRUE while IN is TRUE and for PT afterwards |
| `ET` | TIME | Elapsed off-delay in ms |

*Example:* Motion sensor → TOF 3 min → hallway light (light stays on after the last motion).

- IN   __/‾‾‾\________
- Q    __/‾‾‾‾‾‾‾‾\___   (stays on for PT)

### TP

Pulse timer: Q is TRUE for exactly PT after a rising edge.

Further edges during the pulse are ignored (not retriggerable).

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `IN` | BOOL | Rising edge starts the pulse |
| `PT` | TIME | Pulse length (default 1000 ms) |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `Q` | BOOL | TRUE during the pulse |
| `ET` | TIME | Elapsed pulse time in ms |

*Example:* Button press → open the garage door relay for 1 s.

### TIME_OF_DAY

Time of day: TRUE inside a time window.

Q is TRUE from the start time until the end time (local time of Home Assistant). A window may run past midnight, e.g. 22:00 → 06:00. If start and end are the same the window is the whole day. Optionally pick the weekdays on which it applies.

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `Q` | BOOL | TRUE while the time is inside the window (and the weekday matches) |
| `NOW` | TIME | Current time of day in milliseconds since midnight – compare it with GT / LT |
| `DAY` | INT | Weekday: 1 = Monday … 7 = Sunday |

*Example:* Motion AND TIME_OF_DAY 22:00–06:00 → dim night light.

- For windows past midnight the weekday is the day the window started on (Friday 22:00–06:00 includes Saturday 03:00).
- Use R_TRIG on Q to do something once at the start time.

## Edge

### R_TRIG

Rising edge: Q is TRUE for ONE scan when CLK goes FALSE → TRUE.

Use it to turn a level (switch is on) into an event (switch was just turned on).

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `CLK` | BOOL | Signal to watch |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `Q` | BOOL | One-scan pulse on the rising edge |

*Example:* Button pressed → R_TRIG → toggle something once.

- If CLK is already TRUE in the very first scan after (re)start, that counts as a rising edge.

### F_TRIG

Falling edge: Q is TRUE for ONE scan when CLK goes TRUE → FALSE.

Use it to react when something just ended.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `CLK` | BOOL | Signal to watch |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `Q` | BOOL | One-scan pulse on the falling edge |

*Example:* Washing machine power drops → F_TRIG → "laundry done" notification.

## Bistable

### SR

Flip-flop, SET dominant.

S1 turns Q1 on, R turns it off, and Q1 remembers its state. If both are TRUE, SET wins.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `S1` | BOOL | Set |
| `R` | BOOL | Reset |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `Q1` | BOOL | Stored state |

*Example:* Alarm triggered (S1) stays on until acknowledged (R).

### RS

Flip-flop, RESET dominant.

S turns Q1 on, R1 turns it off, and Q1 remembers its state. If both are TRUE, RESET wins.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `S` | BOOL | Set |
| `R1` | BOOL | Reset |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `Q1` | BOOL | Stored state |

*Example:* Heating latch that always switches off when the window opens.

## Counters

### CTU

Count up on every rising edge of CU.

Q turns TRUE when the count reaches PV. R resets the count to 0.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `CU` | BOOL | Count pulse (counts on FALSE → TRUE) |
| `R` | BOOL | Reset to 0 |
| `PV` | INT | Preset value (default 10) |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `Q` | BOOL | TRUE when CV ≥ PV |
| `CV` | INT | Current count |

*Example:* Count doorbell presses.

### CTD

Count down on every rising edge of CD.

LD loads the count with PV. Q turns TRUE when the count reaches 0.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `CD` | BOOL | Count pulse (counts on FALSE → TRUE) |
| `LD` | BOOL | Load PV into the counter |
| `PV` | INT | Preset value (default 10) |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `Q` | BOOL | TRUE when CV ≤ 0 |
| `CV` | INT | Current count |

*Example:* Remaining pills in a dispenser.

### CTUD

Up/down counter.

CU counts up, CD counts down, R resets to 0, LD loads PV. If CU and CD pulse at the same time nothing changes.

**Inputs**

| Pin | Type | Meaning |
|---|---|---|
| `CU` | BOOL | Count up |
| `CD` | BOOL | Count down |
| `R` | BOOL | Reset to 0 |
| `LD` | BOOL | Load PV |
| `PV` | INT | Preset value (default 10) |

**Outputs**

| Pin | Type | Meaning |
|---|---|---|
| `QU` | BOOL | TRUE when CV ≥ PV |
| `QD` | BOOL | TRUE when CV ≤ 0 |
| `CV` | INT | Current count |

*Example:* People in a room: entry sensor counts up, exit sensor counts down.
