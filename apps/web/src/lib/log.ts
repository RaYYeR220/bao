/** One JSON line per event, so Vercel's log search can filter by `event`. */
type Level = 'info' | 'warn' | 'error';

function write(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (process.env.BAO_SILENT_LOGS) return;
  const line = JSON.stringify({ level, event, ...fields }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

const warned = new Set<string>();

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
  /** Logs a missing-dependency notice once per process. */
  once: (event: string, fields?: Record<string, unknown>) => {
    if (warned.has(event)) return;
    warned.add(event);
    write('warn', event, fields);
  },
};

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : JSON.stringify(e);
}
