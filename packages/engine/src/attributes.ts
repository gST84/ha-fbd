import type { DataType } from './types.js';

/** An attribute of an HA entity that can be set through a service call. */
export interface AttributeDef {
  type: Exclude<DataType, 'TIME'>;
  service: string;   // service name inside the entity's domain
  key: string;       // key in the service data that carries the value
  hint?: string;
}
const a = (type: AttributeDef['type'], service: string, key: string, hint?: string): AttributeDef => ({ type, service, key, hint });

/** domain → attribute → how to set it. Anything not listed can still be done with a "service" output. */
export const ATTRIBUTES: Record<string, Record<string, AttributeDef>> = {
  light: {
    brightness: a('INT', 'turn_on', 'brightness', '0–255 (also turns the light on)'),
    brightness_pct: a('INT', 'turn_on', 'brightness_pct', '0–100 % (also turns the light on)'),
    color_temp_kelvin: a('INT', 'turn_on', 'color_temp_kelvin', 'colour temperature in Kelvin'),
    effect: a('STRING', 'turn_on', 'effect'),
  },
  climate: {
    temperature: a('REAL', 'set_temperature', 'temperature', 'target temperature'),
    target_temp_high: a('REAL', 'set_temperature', 'target_temp_high'),
    target_temp_low: a('REAL', 'set_temperature', 'target_temp_low'),
    hvac_mode: a('STRING', 'set_hvac_mode', 'hvac_mode', 'heat, cool, auto, off …'),
    preset_mode: a('STRING', 'set_preset_mode', 'preset_mode'),
    fan_mode: a('STRING', 'set_fan_mode', 'fan_mode'),
    swing_mode: a('STRING', 'set_swing_mode', 'swing_mode'),
    humidity: a('REAL', 'set_humidity', 'humidity'),
  },
  cover: {
    position: a('INT', 'set_cover_position', 'position', '0 closed – 100 open'),
    tilt_position: a('INT', 'set_cover_tilt_position', 'tilt_position', '0–100'),
  },
  valve: { position: a('INT', 'set_valve_position', 'position', '0–100') },
  fan: {
    percentage: a('INT', 'set_percentage', 'percentage', '0–100'),
    preset_mode: a('STRING', 'set_preset_mode', 'preset_mode'),
    direction: a('STRING', 'set_direction', 'direction', 'forward / reverse'),
    oscillating: a('BOOL', 'oscillate', 'oscillating'),
  },
  humidifier: { humidity: a('INT', 'set_humidity', 'humidity'), mode: a('STRING', 'set_mode', 'mode') },
  water_heater: { temperature: a('REAL', 'set_temperature', 'temperature'), operation_mode: a('STRING', 'set_operation_mode', 'operation_mode') },
  media_player: {
    volume_level: a('REAL', 'volume_set', 'volume_level', '0.0–1.0'),
    is_volume_muted: a('BOOL', 'volume_mute', 'is_volume_muted'),
    source: a('STRING', 'select_source', 'source'),
    sound_mode: a('STRING', 'select_sound_mode', 'sound_mode'),
  },
  vacuum: { fan_speed: a('STRING', 'set_fan_speed', 'fan_speed') },
  input_number: { value: a('REAL', 'set_value', 'value') },
  number: { value: a('REAL', 'set_value', 'value') },
  input_text: { value: a('STRING', 'set_value', 'value') },
  text: { value: a('STRING', 'set_value', 'value') },
  input_select: { option: a('STRING', 'select_option', 'option') },
  select: { option: a('STRING', 'select_option', 'option') },
};

export const domainOf = (entityId: unknown): string => String(entityId ?? '').split('.')[0];
export const attributesOf = (domain: string): string[] => Object.keys(ATTRIBUTES[domain] ?? {});
export const attributeDef = (domain: string, attribute: string): AttributeDef | undefined => ATTRIBUTES[domain]?.[attribute];
