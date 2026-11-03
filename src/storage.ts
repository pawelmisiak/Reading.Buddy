/** Small wrapper around localStorage that never throws (private mode, blocked storage). */

const PREFIX = 'readingBuddy.';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app still works, it just won't remember */
  }
}

export interface SessionRecord {
  date: string;
  title: string;
  level: string;
  accuracy: number;
  wordsRead: number;
  wpm: number;
  tricky: string[];
}
