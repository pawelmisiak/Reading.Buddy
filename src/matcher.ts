/**
 * Matching engine: compares what the speech recognizer heard against the text
 * the child is reading, and decides which words were read correctly.
 *
 * Everything here is pure (no DOM, no speech APIs) so it can be unit tested.
 */

export type WordStatus =
  | 'pending' // not reached yet
  | 'correct' // read correctly on the first try (green)
  | 'retried' // read correctly after one or more wrong tries (green, marked)
  | 'wrong' // the child is on this word and said something else (red, may still turn green)
  | 'missed'; // skipped or never read correctly (red)

export type Strictness = 'lenient' | 'normal' | 'strict';

export interface TextPart {
  text: string;
  /** Index into `words`, or null for spaces / punctuation. */
  wordIndex: number | null;
}

export interface TokenizedText {
  parts: TextPart[];
  words: string[];
  /** Character offset of each word in the original text (for read-aloud highlighting). */
  offsets: number[];
}

export interface ReadState {
  statuses: WordStatus[];
  attempts: number[];
  /** Index of the next word the child is expected to read. */
  cursor: number;
}

export interface MatchOptions {
  strictness: Strictness;
  /** How many words ahead we look when the child skips words. */
  lookahead: number;
  /** Wrong tries allowed on a word before we mark it red and move on. */
  maxAttempts: number;
  /**
   * When false (used for interim, still-changing results) mismatches are
   * ignored: only matches advance the cursor.
   */
  penalize: boolean;
}

const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function tokenize(text: string): TokenizedText {
  const parts: TextPart[] = [];
  const words: string[] = [];
  const offsets: number[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start), wordIndex: null });
    parts.push({ text: m[0], wordIndex: words.length });
    words.push(m[0]);
    offsets.push(start);
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), wordIndex: null });
  return { parts, words, offsets };
}

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
];

const ALIASES: Record<string, string> = {
  mr: 'mister',
  mrs: 'missus',
  dr: 'doctor',
  st: 'street',
  ok: 'okay',
  // Words that sound the same: a recognizer cannot tell them apart, so the
  // child should not be penalised for the spelling it picks.
  too: 'to',
  two: 'to',
  their: 'there',
  theyre: 'there',
  hear: 'here',
  write: 'right',
  wright: 'right',
  know: 'no',
  knew: 'new',
  for: 'four',
  fore: 'four',
  won: 'one',
  ate: 'eight',
  sea: 'see',
  bee: 'be',
  buy: 'by',
  bye: 'by',
  hour: 'our',
  son: 'sun',
  wood: 'would',
  flour: 'flower',
  meet: 'meat',
  week: 'weak',
  pear: 'pair',
  bear: 'bare',
  tail: 'tale',
  whole: 'hole',
  red: 'read',
  blew: 'blue',
  night: 'knight',
  wear: 'where',
  ware: 'where',
};

/** Lowercase, drop apostrophes/hyphens, map numbers and homophones to one spelling. */
export function normalizeWord(word: string): string {
  let w = word.toLowerCase().replace(/[’'\-]/g, '');
  if (/^\d+$/.test(w)) {
    const n = Number(w);
    if (n < NUMBER_WORDS.length) w = NUMBER_WORDS[n];
  }
  return ALIASES[w] ?? w;
}

/** Split a recognizer transcript into normalized words. */
export function splitHeard(transcript: string): string[] {
  return Array.from(transcript.matchAll(WORD_RE), (m) => normalizeWord(m[0])).filter(Boolean);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Does the heard word count as a correct reading of the expected word? */
export function wordsMatch(expected: string, heard: string, strictness: Strictness): boolean {
  const e = normalizeWord(expected);
  const h = normalizeWord(heard);
  if (e === h) return true;
  if (strictness === 'strict') return false;
  // Plural / possessive endings the recognizer often adds or drops.
  if (e + 's' === h || h + 's' === e) return true;
  const longest = Math.max(e.length, h.length);
  if (longest < 4) return false; // short words must be exact
  const allowed = strictness === 'lenient' ? (longest >= 7 ? 2 : 1) : longest >= 8 ? 1 : 0;
  return levenshtein(e, h) <= allowed;
}

export function initialState(wordCount: number): ReadState {
  return {
    statuses: Array<WordStatus>(wordCount).fill('pending'),
    attempts: Array<number>(wordCount).fill(0),
    cursor: 0,
  };
}

export function cloneState(s: ReadState): ReadState {
  return { statuses: [...s.statuses], attempts: [...s.attempts], cursor: s.cursor };
}

/**
 * Feed heard words into the reading state. Returns a new state; the input is
 * not modified.
 */
export function applyHeard(
  state: ReadState,
  words: string[],
  heard: string[],
  opts: MatchOptions,
): ReadState {
  const s = cloneState(state);
  for (const h of heard) {
    if (s.cursor >= words.length) break;

    // Look for the heard word at the cursor, or a little ahead (skipped words).
    let found = -1;
    const end = Math.min(words.length - 1, s.cursor + opts.lookahead);
    for (let j = s.cursor; j <= end; j++) {
      if (wordsMatch(words[j], h, opts.strictness)) {
        found = j;
        break;
      }
    }

    if (found >= 0) {
      for (let k = s.cursor; k < found; k++) s.statuses[k] = 'missed';
      s.statuses[found] = s.attempts[found] > 0 ? 'retried' : 'correct';
      s.cursor = found + 1;
      continue;
    }

    if (!opts.penalize) continue;

    // Re-reading the word just finished is normal; don't count it against them.
    if (s.cursor > 0 && wordsMatch(words[s.cursor - 1], h, opts.strictness)) continue;

    s.attempts[s.cursor]++;
    if (s.attempts[s.cursor] >= opts.maxAttempts) {
      s.statuses[s.cursor] = 'missed';
      s.cursor++;
    } else {
      s.statuses[s.cursor] = 'wrong';
    }
  }
  return s;
}

/** Mark the current word as missed and move on (the "skip" button). */
export function skipWord(state: ReadState): ReadState {
  const s = cloneState(state);
  if (s.cursor < s.statuses.length) {
    s.statuses[s.cursor] = 'missed';
    s.cursor++;
  }
  return s;
}

export interface Summary {
  total: number;
  read: number;
  correct: number;
  retried: number;
  missed: number;
  accuracy: number; // 0..100, over words reached so far
  trickyWords: string[];
}

export function summarize(state: ReadState, words: string[]): Summary {
  let correct = 0;
  let retried = 0;
  let missed = 0;
  const tricky = new Set<string>();
  state.statuses.forEach((st, i) => {
    if (st === 'correct') correct++;
    else if (st === 'retried') retried++;
    else if (st === 'missed') missed++;
    if (st === 'retried' || st === 'missed' || st === 'wrong') tricky.add(words[i].toLowerCase());
  });
  const read = correct + retried + missed;
  return {
    total: words.length,
    read,
    correct,
    retried,
    missed,
    accuracy: read === 0 ? 0 : Math.round(((correct + retried) / read) * 100),
    trickyWords: [...tricky],
  };
}
