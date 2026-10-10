/** Human readable documentation for every block (shown when hovering a block in the editor palette). */
export interface BlockDoc {
  summary: string;
  details: string;
  /** key = pin name, or a wildcard like "IN*" for IN1, IN2, … */
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  example?: string;
  notes?: string[];
}

export function pinDoc(doc: BlockDoc | undefined, side: 'inputs' | 'outputs', name: string): string | undefined {
  const table = doc?.[side];
  return table?.[name] ?? table?.[name.replace(/\d+$/, '*')];
}

const gate = (summary: string, out: string, example: string): BlockDoc => ({
  summary,
  details: 'Choose the number of inputs (2–16) in the properties panel. An unconnected input counts as FALSE unless you set it to TRUE there.',
  inputs: { 'IN*': 'BOOL condition' }, outputs: { OUT: out }, example,
});
const cmp = (op: string, example: string, any = false): BlockDoc => ({
  summary: `TRUE when IN1 ${op} IN2.`,
  details: any ? 'Works with numbers, text and booleans. Text is compared exactly (case sensitive).' : 'Compares two numbers. Unconnected inputs are constants – type the value in the properties panel.',
  inputs: { IN1: 'Left value', IN2: 'Right value' }, outputs: { OUT: `TRUE while IN1 ${op} IN2` }, example,
});
const nary = (summary: string, example: string): BlockDoc => ({
  summary, details: 'Choose the number of inputs (2–16) in the properties panel. The result is a REAL (decimal) number.',
  inputs: { 'IN*': 'Number' }, outputs: { OUT: 'Result' }, example,
});
const bin = (summary: string, notes: string[], example: string): BlockDoc => ({
  summary, details: 'Two inputs. Unconnected inputs are constants you set in the properties panel.',
  inputs: { IN1: 'First value', IN2: 'Second value' }, outputs: { OUT: 'Result' }, notes, example,
});
const conv = (to: string, how: string): BlockDoc => ({
  summary: `Convert any value to ${to}.`, details: how,
  inputs: { IN: 'Any value' }, outputs: { OUT: `The value as ${to}` },
});

export const BLOCK_DOCS: Record<string, BlockDoc> = {
  AND: gate('TRUE when ALL inputs are TRUE.', 'TRUE only if every input is TRUE', 'Motion detected AND it is dark → switch the light on.'),
  OR: gate('TRUE when AT LEAST ONE input is TRUE.', 'TRUE if any input is TRUE', 'Front door open OR back door open → alarm pre-warning.'),
  XOR: gate('TRUE when an ODD number of inputs are TRUE.', 'TRUE if an odd number of inputs are TRUE', 'Two switches that both toggle the same light (staircase switch).'),
  NOT: { summary: 'Inverts a BOOL.', details: 'TRUE becomes FALSE and FALSE becomes TRUE.', inputs: { IN: 'BOOL' }, outputs: { OUT: 'The opposite of IN' }, example: 'Window open → NOT → "window closed".' },

  GT: cmp('>', 'Temperature GT 25 → fan on.'), GE: cmp('≥', 'Battery GE 20 → OK.'), LT: cmp('<', 'Lux LT 50 → it is dark.'),
  LE: cmp('≤', 'Humidity LE 40 → air is dry.'), EQ: cmp('=', 'Mode EQ "away" → alarm on.', true), NE: cmp('≠', 'State NE "unavailable".', true),

  ADD: nary('Sum of all inputs.', 'Power of three phases added up.'),
  MUL: nary('Product of all inputs.', 'Volume × price.'),
  MIN: nary('Smallest of all inputs.', 'Coldest of several room sensors.'),
  MAX: nary('Largest of all inputs.', 'Hottest of several room sensors.'),
  SUB: bin('IN1 − IN2.', [], 'Target temperature − actual temperature = error.'),
  DIV: bin('IN1 ÷ IN2.', ['Dividing by 0 gives 0 (no error).'], 'Energy ÷ hours = average power.'),
  MOD: bin('Remainder of IN1 ÷ IN2.', ['Dividing by 0 gives 0.'], 'Counter MOD 2 = 0 → every second pulse.'),
  ABS: { summary: 'Absolute value (drops the minus sign).', details: 'Always returns zero or a positive number.', inputs: { IN: 'Number' }, outputs: { OUT: '|IN|' } },
  LIMIT: {
    summary: 'Clamp IN between MN and MX.', details: 'If IN is below MN the result is MN; above MX the result is MX; otherwise IN passes through.',
    inputs: { MN: 'Lower limit (default 0)', IN: 'Value to limit', MX: 'Upper limit (default 100)' }, outputs: { OUT: 'The limited value' },
    example: 'Brightness calculation limited to 0–255 before it goes to a light.',
  },

  SEL: {
    summary: 'Choose between two values with a BOOL.', details: 'Works with any data type. Both values are always evaluated; G only decides which one is passed on.',
    inputs: { G: 'FALSE → IN0, TRUE → IN1', IN0: 'Value when G is FALSE', IN1: 'Value when G is TRUE' }, outputs: { OUT: 'The selected value' },
    example: 'Night mode ? 20 % : 80 % brightness.',
  },
  MUX: {
    summary: 'Choose one of several values by number.', details: 'K = 0 selects IN0, K = 1 selects IN1 … K is clamped to the available inputs. Set the number of inputs in the properties panel.',
    inputs: { K: 'Index (0, 1, 2 …)', 'IN*': 'Candidate value' }, outputs: { OUT: 'The selected value' },
    example: 'Scene number → brightness for that scene.',
  },

  TO_BOOL: conv('BOOL', 'Numbers: 0 = FALSE, anything else TRUE. Text: "on", "true", "1", "yes", "home", "open", "detected" = TRUE.'),
  TO_INT: conv('INT', 'Decimals are cut off (7.9 → 7). Text is parsed ("12" → 12, "1,5" → 1). TRUE = 1.'),
  TO_REAL: conv('REAL', 'Text is parsed as a number; both "1.5" and "1,5" work. TRUE = 1, FALSE = 0.'),
  TO_STRING: conv('STRING', 'Numbers and booleans become text.'),

  TON: {
    summary: 'On-delay timer: Q turns TRUE after IN has been TRUE for PT.', details: 'If IN drops before the time has passed, the timer resets and Q never turns on.',
    inputs: { IN: 'Start / hold the timer', PT: 'Delay. Type e.g. 5s, 2m, 1h or milliseconds (default 1000 ms)' },
    outputs: { Q: 'TRUE once PT has elapsed (while IN stays TRUE)', ET: 'Elapsed time in ms' },
    example: 'Door open for 5 minutes → send a notification.',
    notes: ['IN   __/‾‾‾‾‾‾‾‾\\____', 'Q    ____‾‾‾‾‾‾\\____   (after PT)'],
  },
  TOF: {
    summary: 'Off-delay timer: Q stays TRUE for PT after IN drops.', details: 'Q turns on immediately with IN and turns off PT after IN went FALSE. If IN comes back during the delay, the delay restarts.',
    inputs: { IN: 'Trigger', PT: 'Hold time. Type e.g. 3s, 5m, 1h (default 1000 ms)' }, outputs: { Q: 'TRUE while IN is TRUE and for PT afterwards', ET: 'Elapsed off-delay in ms' },
    example: 'Motion sensor → TOF 3 min → hallway light (light stays on after the last motion).',
    notes: ['IN   __/‾‾‾\\________', 'Q    __/‾‾‾‾‾‾‾‾\\___   (stays on for PT)'],
  },
  TP: {
    summary: 'Pulse timer: Q is TRUE for exactly PT after a rising edge.', details: 'Further edges during the pulse are ignored (not retriggerable).',
    inputs: { IN: 'Rising edge starts the pulse', PT: 'Pulse length (default 1000 ms)' }, outputs: { Q: 'TRUE during the pulse', ET: 'Elapsed pulse time in ms' },
    example: 'Button press → open the garage door relay for 1 s.',
  },

  R_TRIG: {
    summary: 'Rising edge: Q is TRUE for ONE scan when CLK goes FALSE → TRUE.', details: 'Use it to turn a level (switch is on) into an event (switch was just turned on).',
    inputs: { CLK: 'Signal to watch' }, outputs: { Q: 'One-scan pulse on the rising edge' }, example: 'Button pressed → R_TRIG → toggle something once.',
    notes: ['If CLK is already TRUE in the very first scan after (re)start, that counts as a rising edge.'],
  },
  F_TRIG: {
    summary: 'Falling edge: Q is TRUE for ONE scan when CLK goes TRUE → FALSE.', details: 'Use it to react when something just ended.',
    inputs: { CLK: 'Signal to watch' }, outputs: { Q: 'One-scan pulse on the falling edge' }, example: 'Washing machine power drops → F_TRIG → "laundry done" notification.',
  },
  SR: {
    summary: 'Flip-flop, SET dominant.', details: 'S1 turns Q1 on, R turns it off, and Q1 remembers its state. If both are TRUE, SET wins.',
    inputs: { S1: 'Set', R: 'Reset' }, outputs: { Q1: 'Stored state' }, example: 'Alarm triggered (S1) stays on until acknowledged (R).',
  },
  RS: {
    summary: 'Flip-flop, RESET dominant.', details: 'S turns Q1 on, R1 turns it off, and Q1 remembers its state. If both are TRUE, RESET wins.',
    inputs: { S: 'Set', R1: 'Reset' }, outputs: { Q1: 'Stored state' }, example: 'Heating latch that always switches off when the window opens.',
  },

  CTU: {
    summary: 'Count up on every rising edge of CU.', details: 'Q turns TRUE when the count reaches PV. R resets the count to 0.',
    inputs: { CU: 'Count pulse (counts on FALSE → TRUE)', R: 'Reset to 0', PV: 'Preset value (default 10)' }, outputs: { Q: 'TRUE when CV ≥ PV', CV: 'Current count' }, example: 'Count doorbell presses.',
  },
  CTD: {
    summary: 'Count down on every rising edge of CD.', details: 'LD loads the count with PV. Q turns TRUE when the count reaches 0.',
    inputs: { CD: 'Count pulse (counts on FALSE → TRUE)', LD: 'Load PV into the counter', PV: 'Preset value (default 10)' }, outputs: { Q: 'TRUE when CV ≤ 0', CV: 'Current count' }, example: 'Remaining pills in a dispenser.',
  },
  CTUD: {
    summary: 'Up/down counter.', details: 'CU counts up, CD counts down, R resets to 0, LD loads PV. If CU and CD pulse at the same time nothing changes.',
    inputs: { CU: 'Count up', CD: 'Count down', R: 'Reset to 0', LD: 'Load PV', PV: 'Preset value (default 10)' },
    outputs: { QU: 'TRUE when CV ≥ PV', QD: 'TRUE when CV ≤ 0', CV: 'Current count' }, example: 'People in a room: entry sensor counts up, exit sensor counts down.',
  },

  CONST: {
    summary: 'A fixed value.', details: 'Pick the data type and type the value in the properties panel. For decimals both 1.5 and 1,5 work.',
    outputs: { OUT: 'The constant' }, notes: ['For simple cases you can skip this block: unconnected inputs are constants too.'],
  },
  ENTITY_IN: {
    summary: 'Read a Home Assistant entity.', details: 'Reads the state (or one attribute) of an entity and converts it to the chosen data type. BOOL is TRUE for on, true, home, open, detected (you can change this list; capitals do not matter).',
    outputs: { OUT: 'The value', AVAIL: 'FALSE while the entity is missing, unavailable or unknown' },
    example: 'binary_sensor.hall_motion → BOOL.', notes: ['While the entity is unavailable, OUT keeps its last good value.'],
  },
  ENTITY_OUT: {
    summary: 'Write to a Home Assistant entity.', details: 'Kinds: switch (BOOL → turn on/off), value (number → set value), attribute (set one attribute such as brightness or hvac_mode), service (call any service on a rising edge).',
    inputs: { IN: 'Value to write (only written when it changes)', EN: 'Service kind: a rising edge calls the service' },
    example: 'GT result → light.living (switch).', notes: ['Setting brightness on a light also turns the light on.', 'Outputs are only sent when the value changes, never every scan.'],
  },
  VAR_READ: {
    summary: 'Read an internal variable.', details: 'Variables are the memory of your program. They are shared between networks of the same automation. A variable is read at the START of a scan.',
    outputs: { OUT: 'Value of the variable' }, example: 'Feed back a result from the previous scan (e.g. toggle).',
  },
  VAR_WRITE: {
    summary: 'Write an internal variable.', details: 'The value is stored at the END of the scan, so blocks that read the same variable in this scan still see the old value.',
    inputs: { IN: 'New value' }, example: 'Remember "last mode" for the next scan.',
  },
  SET: {
    summary: 'Set a BOOL variable (or switch an entity / a whole room ON) while IN is TRUE.', details: 'Like a SET coil in TIA Portal. With a variable target it forces the variable TRUE every scan IN is TRUE, and the variable keeps TRUE afterwards until a RESET block clears it. With an entity target it turns the entity on at the rising edge of IN. With a room target every selected kind of device (lights, media players, switches, fans, climate) in the chosen Home Assistant area is turned on at the rising edge of IN – Home Assistant looks up the devices itself.',
    inputs: { IN: 'Condition' }, example: 'Doorbell pressed → SET "visitor"; "visitor seen" → RESET "visitor".',
    notes: ['Room target: choose which kinds of devices are affected – "switch" may also include sockets of e.g. a fridge. The area must exist in Home Assistant (Settings → Areas).', 'If SET and RESET on the same variable are both TRUE, the block that comes later in the program wins.'],
  },
  RESET: {
    summary: 'Reset a BOOL variable (or switch an entity / a whole room OFF) while IN is TRUE.', details: 'Counterpart of SET. With a variable target it forces the variable FALSE while IN is TRUE. With an entity target it turns the entity off at the rising edge of IN. With a room target every selected kind of device in the chosen Home Assistant area is switched off at the rising edge of IN.',
    inputs: { IN: 'Condition' }, example: 'Good-night button → RESET room "living room": lights + media players off.',
  },
  EVENT_IN: {
    summary: 'React to a Home Assistant event.', details: 'Q is TRUE for exactly one scan when an event of this type arrives. Use "match" to filter on the event data, and "valuePath" to read a field of the event into VAL (e.g. "command").',
    outputs: { Q: 'One-scan pulse when a matching event arrived', VAL: 'The picked field of the last matching event (only with a valuePath)' },
    example: 'eventType zha_event, match {"device_ieee":"00:15:…","command":"on"} → wall switch pressed.',
    notes: ['Events are not remembered while the add-on is stopped.'],
  },
  TIME_OF_DAY: {
    summary: 'Time of day: TRUE inside a time window.', details: 'Q is TRUE from the start time until the end time (local time of Home Assistant). A window may run past midnight, e.g. 22:00 → 06:00. If start and end are the same the window is the whole day. Optionally pick the weekdays on which it applies.',
    outputs: { Q: 'TRUE while the time is inside the window (and the weekday matches)', NOW: 'Current time of day in milliseconds since midnight – compare it with GT / LT', DAY: 'Weekday: 1 = Monday … 7 = Sunday' },
    example: 'Motion AND TIME_OF_DAY 22:00–06:00 → dim night light.',
    notes: ['For windows past midnight the weekday is the day the window started on (Friday 22:00–06:00 includes Saturday 03:00).', 'Use R_TRIG on Q to do something once at the start time.'],
  },
  AREA_OUT: {
    summary: 'Legacy: use SET / RESET with target "room".', details: 'On a rising edge of EN every selected kind of device in the chosen Home Assistant area is switched off (or on): lights, media players, switches, fans or climate devices. Home Assistant looks up the devices itself, so new devices you add to the room are included automatically.',
    inputs: { EN: 'Rising edge triggers the action' },
    example: 'Good-night button → ROOM OUT living room: lights + media players off.',
    notes: ['Choose which kinds of devices are affected – "switch" may also include sockets of e.g. a fridge.', 'The area must exist in Home Assistant (Settings → Areas).'],
  },
  EVENT_OUT: {
    summary: 'Fire a Home Assistant event.', details: 'On a rising edge of IN an event with this type and data is fired on the Home Assistant bus. Other automations (or your own EVENT_IN) can listen to it.',
    inputs: { IN: 'Rising edge fires the event' }, example: 'Alarm triggered → fire "fbd_alarm" with {"zone":"hall"}.',
  },
};
