export type Level = 'debug' | 'info' | 'warning' | 'error';
export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}
const order: Record<Level, number> = { debug: 0, info: 1, warning: 2, error: 3 };

export function createLogger(level: Level = 'info', sink: (line: string) => void = l => console.log(l)): Logger {
  const emit = (lvl: Level, tag: string) => (msg: string) => {
    if (order[lvl] >= order[level]) sink(`${new Date().toISOString()} ${tag} ${msg}`);
  };
  return { debug: emit('debug', 'DEBUG'), info: emit('info', 'INFO '), warn: emit('warning', 'WARN '), error: emit('error', 'ERROR') };
}
export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
