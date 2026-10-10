import { attributeDef, domainOf, type OutputCommand } from '@ha-fbd/engine';

export interface ServiceCall { domain: string; service: string; data: Record<string, unknown>; entityId?: string }

const TURN_ON_OFF = new Set(['light', 'switch', 'fan', 'input_boolean', 'humidifier', 'siren', 'climate', 'media_player',
  'automation', 'remote', 'water_heater', 'script', 'scene']);

/** Translate an engine OutputCommand into a Home Assistant service call. */
export function commandToServiceCall(cmd: Exclude<OutputCommand, { kind: 'event' | 'area' }>): ServiceCall {
  if (cmd.kind === 'attribute') {
    const def = attributeDef(domainOf(cmd.entityId), cmd.attribute);
    if (!def) throw new Error(`"${cmd.attribute}" cannot be set on ${cmd.entityId}`);
    return { domain: domainOf(cmd.entityId), service: def.service, data: { [def.key]: cmd.value }, entityId: cmd.entityId };
  }
  if (cmd.kind === 'service') {
    const [domain, service] = cmd.service.split('.');
    return { domain, service, data: cmd.data, entityId: cmd.entityId };
  }
  const entityId = cmd.entityId;
  const domain = entityId.split('.')[0];

  if (cmd.kind === 'switch') {
    const on = cmd.value;
    switch (domain) {
      case 'cover': return { domain, service: on ? 'open_cover' : 'close_cover', data: {}, entityId };
      case 'valve': return { domain, service: on ? 'open_valve' : 'close_valve', data: {}, entityId };
      case 'lock': return { domain, service: on ? 'lock' : 'unlock', data: {}, entityId };       // TRUE = locked
      case 'vacuum': return { domain, service: on ? 'start' : 'return_to_base', data: {}, entityId };
    }
    const d = TURN_ON_OFF.has(domain) ? domain : 'homeassistant';
    return { domain: d, service: on ? 'turn_on' : 'turn_off', data: {}, entityId };
  }

  // kind === 'value'
  const v = cmd.value;
  switch (domain) {
    case 'input_number':
    case 'number': return { domain, service: 'set_value', data: { value: v }, entityId };
    case 'climate':
    case 'water_heater': return { domain, service: 'set_temperature', data: { temperature: v }, entityId };
    case 'fan': return { domain, service: 'set_percentage', data: { percentage: v }, entityId };
    case 'cover': return { domain, service: 'set_cover_position', data: { position: v }, entityId };
    case 'humidifier': return { domain, service: 'set_humidity', data: { humidity: v }, entityId };
    case 'light': return { domain, service: 'turn_on', data: { brightness_pct: v }, entityId };
  }
  throw new Error(`Value output is not supported for domain "${domain}" (use a service output instead)`);
}
