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

/** Returns false when storage is unavailable or full. */
export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    /* storage unavailable: the app still works, it just won't remember */
    return false;
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
