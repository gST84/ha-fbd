import { AREA_DOMAINS, ATTRIBUTES, attributesOf, domainOf, parseNumber, registry, type PinType, type Program } from '@ha-fbd/engine';
import { JsonField, SelectField, TextField } from './fields';
import { DAY_NAMES, layout, isCoil } from './geometry';
import type { Edit } from './history';
import { deleteBlock, deleteBlocks, deleteWire, setParams } from './ops';
import type { AreaInfo, EntityInfo, FloorInfo, Problem, Selection } from './types';

const COUNT_BLOCKS = new Set(['AND', 'OR', 'XOR', 'ADD', 'MUL', 'MIN', 'MAX', 'MUX']);
const DATA_TYPES = ['BOOL', 'INT', 'REAL', 'STRING'].map(value => ({ value }));
const NUMERIC = new Set<string>(['INT', 'REAL', 'ANY_NUM']);
const COMMON_EVENTS = ['zha_event', 'mobile_app_notification_action', 'call_service', 'automation_triggered', 'script_started', 'homeassistant_start', 'homeassistant_started', 'deconz_event', 'hue_event', 'esphome.button', 'ios.action_fired', 'timer.finished'];

/** Typed text for a constant → stored value. Numbers accept "1.5" and "1,5"; anything else stays text (TIME: "5s"). */
function parseConst(type: PinType, raw: string): unknown {
  if (!NUMERIC.has(type)) return raw;
  const n = parseNumber(raw);
  return n === undefined ? raw : type === 'INT' ? Math.trunc(n) : n;
}

const DOMAIN_LABELS: Record<string, string> = { light: 'Lights', media_player: 'Media players', switch: 'Switches', fan: 'Fans', climate: 'Climate' };

interface Props {
  program: Program; selection: Selection | null; entities: EntityInfo[]; problems: Problem[];
  areas: AreaInfo[]; floors: FloorInfo[]; areasError?: string;
  edit: Edit; beginTx(): void; onClear(): void;
}

export function Properties({ program, selection, entities, problems, areas, floors, areasError, edit, beginTx, onClear }: Props) {
  if (!selection) return <p className="hint">Select a block or a wire to edit it. Shift-click or drag a box to select several; Ctrl/⌘ + C, X, V copy, cut and paste.</p>;
  const net = program.networks.find(n => n.id === selection.net);
  if (!net) return null;

  if (selection.kind === 'wire') {
    const [block, pin] = selection.id.split('.');
    const w = net.wires.find(x => x.to.block === block && x.to.pin === pin);
    if (!w) return null;
    return (
      <div className="props">
        <h3>Wire</h3>
        <p className="mono">{w.from.block}.{w.from.pin} → {w.to.block}.{w.to.pin}</p>
        <button className="danger" onClick={() => { edit(p => deleteWire(p, net.id, w.to)); onClear(); }}>Delete wire</button>
      </div>
    );
  }

  if (selection.ids.length > 1) {
    return (
      <div className="props" data-testid="props-multi">
        <h3>{selection.ids.length} blocks selected</h3>
        <p className="hint">Drag one of them to move all. Ctrl/⌘ + C copies, X cuts, V pastes into the active network. Delete removes them.</p>
        <button className="danger" onClick={() => { edit(p => deleteBlocks(p, net.id, selection.ids)); onClear(); }}>Delete {selection.ids.length} blocks</button>
      </div>
    );
  }

  const b = net.blocks.find(x => x.id === selection.ids[0]);
  if (!b) return null;
  const def = registry[b.type];
  const params = b.params ?? {};
  const l = layout(b);
  const wired = new Set(net.wires.filter(w => w.to.block === b.id).map(w => w.to.pin));
  const mine = problems.filter(p => p.blockId === b.id);

  const commit = (patch: Record<string, unknown>) => edit(p => setParams(p, net.id, b.id, patch));
  const typing = (patch: Record<string, unknown>) => edit(p => setParams(p, net.id, b.id, patch), 'drag');
  const str = (k: string) => (params[k] === undefined ? '' : String(params[k]));
  const ent = entities.find(e => e.entity_id === params.entityId);
  const entityHint = ent ? `now: ${ent.state} · ${ent.name}` : str('entityId') ? 'not found in Home Assistant' : undefined;
  const kind = str('kind') || 'switch';
  const domain = domainOf(params.entityId);
  const attrs = attributesOf(domain);
  const boolVars = program.variables.filter(v => v.type === 'BOOL');

  /** Room (area) or zone (floor) target of SET / RESET: pick where, and which kinds of devices it affects. */
  const roomFields = (effect: string) => {
    const areaId = str('areaId'), floorId = str('floorId');
    const domains = Array.isArray(params.domains) ? (params.domains as string[]) : ['light', 'media_player'];
    const area = areas.find(a => a.id === areaId);
    const floor = floors.find(f => f.id === floorId);
    const zoneAreas = floorId ? areas.filter(a => a.floorId === floorId) : [];
    const scope = floorId ? [...new Set(zoneAreas.flatMap(a => a.entities))] : area?.entities ?? [];
    const affected = scope.filter(e => domains.includes(domainOf(e))).sort();
    const toggleDomain = (d: string) => commit({ domains: domains.includes(d) ? domains.filter(x => x !== d) : AREA_DOMAINS.filter(x => x === d || domains.includes(x)) });
    const IND = '\u00a0\u00a0\u00a0– ';
    const known = floorId ? !!floor : !!area;
    const options: { value: string; label?: string }[] = [{ value: '', label: '— select —' }];
    if (!known && (areaId || floorId)) options.push({ value: floorId ? `floor:${floorId}` : `area:${areaId}`, label: `${floorId || areaId} (not found)` });
    for (const f of floors) {
      options.push({ value: `floor:${f.id}`, label: `Zone: ${f.name} (all rooms)` });
      for (const a of areas.filter(x => x.floorId === f.id)) options.push({ value: `area:${a.id}`, label: IND + a.name });
    }
    const loose = floors.length ? areas.filter(a => !a.floorId || !floors.some(f => f.id === a.floorId)) : areas;
    if (floors.length && loose.length) options.push({ value: '__other', label: 'Rooms without a zone' });
    for (const a of loose) options.push({ value: `area:${a.id}`, label: (floors.length ? IND : '') + a.name });
    const current = floorId ? `floor:${floorId}` : areaId ? `area:${areaId}` : '';
    const pick = (v: string) => {
      if (v === '__other') return;
      if (v.startsWith('floor:')) commit({ floorId: v.slice(6), areaId: undefined });
      else commit({ areaId: v.startsWith('area:') ? v.slice(5) : '', floorId: undefined });
    };
    return <>
      {areas.length
        ? <SelectField label={floors.length ? 'Zone or room' : 'Room (area)'} testId="p-area" value={current} options={options} onChange={pick} />
        : <TextField label="Room (area id)" testId="p-area" value={areaId} placeholder="living_room" beginTx={beginTx} onChange={v => typing({ areaId: v.trim() })}
            hint={areasError ? `Could not load the rooms (${areasError}). Type the area id instead, e.g. living_room.` : 'No rooms found in Home Assistant – type the area id.'} />}
      <div className="field"><span>Affects</span>
        <div className="days">
          {AREA_DOMAINS.map(d => (
            <label key={d} className={domains.includes(d) ? 'on' : undefined}>
              <input type="checkbox" data-testid={`domain-${d}`} checked={domains.includes(d)} onChange={() => toggleDomain(d)} />{DOMAIN_LABELS[d]}
            </label>))}
        </div>
      </div>
      {(area || floor) && (
        <p className="hint" data-testid="area-preview">
          {affected.length === 0 ? `No matching devices in this ${floor ? 'zone' : 'room'} right now.` : `${affected.length} device${affected.length === 1 ? '' : 's'} in “${(floor ?? area)!.name}”: `}
          {affected.slice(0, 12).join(', ')}{affected.length > 12 ? ` … +${affected.length - 12} more` : ''}
        </p>)}
      <p className="hint">{effect} when IN rises. Home Assistant looks up the devices of the {floor ? 'zone (all its rooms)' : 'room'} itself, so devices you add later are included.</p>
    </>;
  };

  return (
    <div className="props" data-testid="props">
      <h3>{b.type} <span className="mono muted">{b.id}</span></h3>
      <p className="hint">{def?.description.replace(/\s*\(params:[^)]*\)/, '')}</p>
      {mine.map((p, i) => <p key={i} className="error">⚠ {p.message}</p>)}

      {b.type === 'ENTITY_IN' && <>
        <TextField label="Entity" testId="p-entity" value={str('entityId')} list="fbd-entities" placeholder="sensor.living_room_temperature"
          beginTx={beginTx} onChange={v => typing({ entityId: v.trim() })} hint={entityHint} />
        <TextField label="Attribute (optional)" value={str('attribute')} beginTx={beginTx} onChange={v => typing({ attribute: v.trim() || undefined })} placeholder="e.g. brightness" />
        <SelectField label="Data type" testId="p-datatype" value={str('dataType') || 'BOOL'} options={DATA_TYPES} onChange={v => commit({ dataType: v })} />
        {(str('dataType') || 'BOOL') === 'BOOL' &&
          <TextField label="TRUE states (comma separated)" lazy beginTx={beginTx} testId="p-onstates" placeholder="default: on, true, home, open, detected"
            hint="Capital letters do not matter."
            value={Array.isArray(params.onStates) ? (params.onStates as string[]).join(', ') : ''}
            onChange={v => { const a = v.split(',').map(s => s.trim()).filter(Boolean); commit({ onStates: a.length ? a : undefined }); }} />}
      </>}

      {b.type === 'ENTITY_OUT' && <>
        <SelectField label="Output kind" testId="p-kind" value={kind} onChange={v => commit({ kind: v })}
          options={[{ value: 'switch', label: 'switch (BOOL → on / off)' }, { value: 'value', label: 'value (number → set value)' },
            { value: 'attribute', label: 'attribute (set brightness, hvac_mode …)' }, { value: 'service', label: 'service (rising edge → call)' }]} />
        <TextField label={kind === 'service' ? 'Target entity (optional)' : 'Entity'} testId="p-entity" value={str('entityId')} list="fbd-entities"
          placeholder="light.living_room" beginTx={beginTx} onChange={v => typing({ entityId: v.trim() })} hint={entityHint} />
        {kind === 'attribute' && (attrs.length
          ? <SelectField label="Attribute" testId="p-attribute" value={str('attribute')}
              options={[{ value: '', label: '— select —' }, ...attrs.map(a => ({ value: a, label: `${a} (${ATTRIBUTES[domain][a].type})` }))]}
              hint={ATTRIBUTES[domain]?.[str('attribute')]?.hint}
              onChange={v => commit({ attribute: v || undefined })} />
          : <p className="hint">{str('entityId') ? `No settable attributes are known for “${domain}” entities – use a service output instead.` : 'Pick an entity first to see its settable attributes.'}</p>)}
        {kind === 'service' && <>
          <TextField label="Service" testId="p-service" value={str('service')} placeholder="notify.mobile_app_phone" beginTx={beginTx} onChange={v => typing({ service: v.trim() })} />
          <JsonField label="Service data (JSON)" beginTx={beginTx} placeholder='{"message": "Door open"}'
            value={params.data as Record<string, unknown> | undefined} onCommit={v => commit({ data: v })} />
        </>}
      </>}

      {b.type === 'CONST' && <>
        <SelectField label="Data type" value={str('dataType') || 'BOOL'} options={[...DATA_TYPES, { value: 'TIME' }]}
          onChange={v => commit({ dataType: v, value: v === 'BOOL' ? false : v === 'STRING' ? '' : 0 })} />
        {(str('dataType') || 'BOOL') === 'BOOL'
          ? <SelectField label="Value" value={String(params.value === true)} options={[{ value: 'false', label: 'FALSE' }, { value: 'true', label: 'TRUE' }]} onChange={v => commit({ value: v === 'true' })} />
          : <TextField label="Value" testId="p-value" lazy={NUMERIC.has(str('dataType'))} value={str('value')} beginTx={beginTx}
              hint={NUMERIC.has(str('dataType')) ? 'Decimal point or comma both work.' : undefined}
              onChange={v => (NUMERIC.has(str('dataType')) ? commit({ value: parseConst(str('dataType') as PinType, v) }) : typing({ value: v }))} />}
      </>}

      {(b.type === 'VAR_READ' || b.type === 'VAR_WRITE') && (program.variables.length === 0
        ? <p className="error">Declare a variable first (Variables tab).</p>
        : <SelectField label="Variable" testId="p-var" value={str('name')}
            options={[{ value: '', label: '— select —' }, ...program.variables.map(v => ({ value: v.name, label: `${v.name} (${v.type})` }))]}
            onChange={v => { const decl = program.variables.find(x => x.name === v); commit({ name: v, varType: decl?.type ?? 'BOOL' }); }} />)}

      {isCoil(b.type) && <>
        <SelectField label="Target" testId="p-target" value={str('target') || 'variable'}
          options={[{ value: 'variable', label: b.type === 'TOGGLE' ? 'BOOL variable (flips on rising edge)' : 'BOOL variable (latches)' }, { value: 'entity', label: 'Home Assistant entity (on rising edge)' }, { value: 'room', label: 'Room / zone (on rising edge)' }]}
          onChange={v => commit(v === 'entity' ? { target: 'entity', name: undefined, varType: undefined, areaId: undefined, floorId: undefined, domains: undefined }
            : v === 'room' ? { target: 'room', name: undefined, varType: undefined, entityId: undefined, areaId: '', floorId: undefined, domains: ['light', 'media_player'] }
            : { target: 'variable', entityId: undefined, areaId: undefined, floorId: undefined, domains: undefined, name: boolVars[0]?.name ?? '', varType: 'BOOL' })} />
        {str('target') === 'room' ? roomFields(b.type === 'SET' ? 'Switches everything ON' : b.type === 'RESET' ? 'Switches everything OFF' : 'Switches everything OFF when something is on, otherwise everything ON,') : (str('target') || 'variable') === 'variable'
          ? (boolVars.length === 0
            ? <p className="error">Declare a BOOL variable first (Variables tab).</p>
            : <SelectField label="Variable" testId="p-var" value={str('name')}
                options={[{ value: '', label: '— select —' }, ...boolVars.map(v => ({ value: v.name, label: v.name }))]}
                onChange={v => commit({ name: v, varType: 'BOOL' })} />)
          : <TextField label="Entity" testId="p-entity" value={str('entityId')} list="fbd-entities" placeholder="light.living_room"
              beginTx={beginTx} onChange={v => typing({ entityId: v.trim() })} hint={entityHint ?? (b.type === 'SET' ? 'Turned ON when IN rises' : b.type === 'RESET' ? 'Turned OFF when IN rises' : 'Switched to the other state when IN rises')} />}
      </>}

      {b.type === 'EVENT_IN' && <>
        <TextField label="Event type" testId="p-eventtype" value={str('eventType')} list="fbd-events" placeholder="zha_event" beginTx={beginTx} onChange={v => typing({ eventType: v.trim() })} />
        <JsonField label="Only when the event data contains (JSON, optional)" testId="p-match" beginTx={beginTx} placeholder='{"command": "on"}'
          hint="Every key must match; nested objects are matched recursively."
          value={params.match as Record<string, unknown> | undefined} onCommit={v => commit({ match: v })} />
        <TextField label="Read a field into VAL (optional)" testId="p-valuepath" value={str('valuePath')} placeholder="args.level" beginTx={beginTx}
          hint="Path inside the event data, e.g. command or args.level. Adds a VAL output." onChange={v => typing({ valuePath: v.trim() || undefined })} />
        {params.valuePath ? <SelectField label="VAL data type" value={str('valueType') || 'STRING'} options={[...DATA_TYPES]} onChange={v => commit({ valueType: v })} /> : null}
      </>}

      {b.type === 'EVENT_OUT' && <>
        <TextField label="Event type" testId="p-eventtype" value={str('eventType')} list="fbd-events" placeholder="fbd_alarm" beginTx={beginTx} onChange={v => typing({ eventType: v.trim() })} />
        <JsonField label="Event data (JSON, optional)" beginTx={beginTx} placeholder='{"zone": "hall"}'
          value={params.data as Record<string, unknown> | undefined} onCommit={v => commit({ data: v })} />
      </>}

      {b.type === 'TIME_OF_DAY' && (() => {
        const start = str('start') || '00:00', end = str('end') || '00:00';
        const days = Array.isArray(params.days) ? (params.days as number[]) : [];
        const toggle = (d: number) => { const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort(); commit({ days: next.length && next.length < 7 ? next : undefined }); };
        return <>
          <label className="field"><span>From</span>
            <input type="time" data-testid="p-start" value={start} onChange={e => e.target.value && commit({ start: e.target.value })} /></label>
          <label className="field"><span>Until</span>
            <input type="time" data-testid="p-end" value={end} onChange={e => e.target.value && commit({ end: e.target.value })} /></label>
          <div className="field"><span>Days (none selected = every day)</span>
            <div className="days">
              {DAY_NAMES.map((n, i) => (
                <label key={n} className={days.includes(i + 1) ? 'on' : undefined}>
                  <input type="checkbox" data-testid={`day-${i + 1}`} checked={days.includes(i + 1)} onChange={() => toggle(i + 1)} />{n}
                </label>))}
            </div>
          </div>
          <p className="hint" data-testid="tod-summary">
            {start === end ? 'Q is TRUE all day' : `Q is TRUE from ${start} until ${end}${start > end ? ' (past midnight)' : ''}`}
            {days.length ? `, only on ${days.map(d => DAY_NAMES[d - 1]).join(', ')}` : ', every day'}. NOW gives the time since midnight, DAY the weekday (1 = Monday).
          </p>
        </>;
      })()}

      {COUNT_BLOCKS.has(b.type) &&
        <label className="field"><span>Number of inputs</span>
          <input type="number" min={2} max={16} value={Number(params.inputCount ?? 2)} data-testid="p-count"
            onChange={e => commit({ inputCount: Math.min(16, Math.max(2, Math.floor(Number(e.target.value) || 2))) })} /></label>}

      {l.ins.some(p => !wired.has(p.name)) && <h4>Unconnected inputs</h4>}
      {l.ins.filter(p => !wired.has(p.name)).map(p => p.type === 'BOOL'
        ? <SelectField key={p.name} label={`${p.name} (BOOL)`} value={params[p.name] === undefined ? '' : String(params[p.name])}
            options={[{ value: '', label: `default (${p.default ? 'TRUE' : 'FALSE'})` }, { value: 'false', label: 'FALSE' }, { value: 'true', label: 'TRUE' }]}
            onChange={v => commit({ [p.name]: v === '' ? undefined : v === 'true' })} />
        : <TextField key={p.name} label={`${p.name} (${p.type})`} testId={`const-${p.name}`} value={str(p.name)} beginTx={beginTx}
            lazy={NUMERIC.has(p.type)}
            placeholder={p.type === 'TIME' ? `${p.default ?? 0} ms or 5s, 2m, 1h` : String(p.default ?? 0)}
            onChange={v => (NUMERIC.has(p.type)
              ? commit({ [p.name]: v.trim() === '' ? undefined : parseConst(p.type, v) })
              : typing({ [p.name]: v === '' ? undefined : parseConst(p.type, v) }))} />)}

      <button className="danger" data-testid="delete-block" onClick={() => { edit(p => deleteBlock(p, net.id, b.id)); onClear(); }}>Delete block</button>
      <datalist id="fbd-events">{COMMON_EVENTS.map(e => <option key={e} value={e} />)}</datalist>
    </div>
  );
}
