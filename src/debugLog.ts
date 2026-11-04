/**
 * Troubleshooting log. Every entry goes to the browser console (prefixed with
 * [ReadingBuddy]) and to an in-app buffer shown under Settings → Troubleshooting,
 * so problems can be diagnosed on a tablet without developer tools.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  time: string;
  level: LogLevel;
  area: string;
  message: string;
  data?: unknown;
}

const MAX_ENTRIES = 400;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();

export function log(level: LogLevel, area: string, message: string, data?: unknown): void {
  const entry: LogEntry = { time: new Date().toISOString(), level, area, message, data };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  const line = `[ReadingBuddy] [${area}] ${message}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (data === undefined) fn(line);
  else fn(line, data);
  listeners.forEach((l) => l());
}

export const info = (area: string, message: string, data?: unknown) => log('info', area, message, data);
export const warn = (area: string, message: string, data?: unknown) => log('warn', area, message, data);
export const error = (area: string, message: string, data?: unknown) => log('error', area, message, data);

export function getEntries(): readonly LogEntry[] {
  return entries;
}

export function clearLog(): void {
  entries.length = 0;
  listeners.forEach((l) => l());
}

export function onLogChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function stringify(data: unknown): string {
  if (data instanceof Error) return `${data.name}: ${data.message}`;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export function formatLog(): string {
  return entries
    .map((e) => {
      const t = e.time.slice(11, 23);
      const d = e.data === undefined ? '' : ` ${stringify(e.data)}`;
      return `${t} ${e.level.toUpperCase().padEnd(5)} [${e.area}] ${e.message}${d}`;
    })
    .join('\n');
}

/** Log uncaught errors too, so nothing fails silently. */
export function installGlobalHandlers(): void {
  window.addEventListener('error', (e) => error('page', 'Uncaught error', { message: e.message, source: `${e.filename}:${e.lineno}` }));
  window.addEventListener('unhandledrejection', (e) => error('page', 'Unhandled promise rejection', e.reason));
}
