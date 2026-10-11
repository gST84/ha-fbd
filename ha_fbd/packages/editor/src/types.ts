import type { Value } from '@ha-fbd/engine';

/** Several blocks of one network, or one wire (id = "block.pin" of the target input). */
export type Selection =
  | { net: string; kind: 'blocks'; ids: string[] }
  | { net: string; kind: 'wire'; id: string };

export interface Problem { networkId?: string; blockId?: string; message: string }
export interface EntityInfo { entity_id: string; state: string; name: string }
export interface GlobalStatus { ha: string; entities: number; automations: { total: number; running: number } }
export interface AutomationStatus {
  id: string; name: string; running: boolean; ha: string; entities: number; scanMs: number; overruns: number; blocks: number;
  stats: { scans: number; lastMs: number; avgMs: number; maxMs: number };
}
export interface AutomationSummary {
  id: string; name: string; running: boolean; blocks: number; networks: number; problems: number; avgMs: number; overruns: number; scans: number;
}
export interface WatchFrame {
  scan: number; durationMs: number; values: Record<string, Value>; variables: Record<string, Value>;
  errors: { blockId: string; message: string }[]; commands: number;
}

/** A room (Home Assistant area) and the entities that live in it. */
export interface AreaInfo { id: string; name: string; entities: string[]; floorId?: string | null }
/** A zone (Home Assistant floor) that groups rooms. */
export interface FloorInfo { id: string; name: string; level?: number | null }
export interface ContextInfo { x: number; y: number; net: string; lx: number; ly: number; blockId?: string }
