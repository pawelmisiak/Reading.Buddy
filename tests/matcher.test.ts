import { describe, expect, it } from 'vitest';
import {
  applyHeard,
  initialState,
  normalizeWord,
  skipWord,
  splitHeard,
  summarize,
  tokenize,
  wordsMatch,
  type MatchOptions,
} from '../src/matcher';

const opts: MatchOptions = { strictness: 'normal', lookahead: 3, maxAttempts: 2, penalize: true };

function read(text: string, ...chunks: string[]) {
  const { words } = tokenize(text);
  let s = initialState(words.length);
  for (const c of chunks) s = applyHeard(s, words, splitHeard(c), opts);
  return { s, words };
}

describe('tokenize', () => {
  it('keeps punctuation and spacing as non-word parts', () => {
    const t = tokenize('Hi, Sam! Don’t run.');
    expect(t.words).toEqual(['Hi', 'Sam', 'Don’t', 'run']);
    expect(t.parts.map((p) => p.text).join('')).toBe('Hi, Sam! Don’t run.');
    expect(t.offsets).toEqual([0, 4, 9, 15]);
  });
});

describe('wordsMatch', () => {
  it('ignores case, apostrophes and numbers vs words', () => {
    expect(wordsMatch("Don't", 'dont', 'strict')).toBe(true);
    expect(wordsMatch('three', '3', 'strict')).toBe(true);
    expect(normalizeWord('Two')).toBe(normalizeWord('to'));
  });
  it('accepts homophones', () => {
    expect(wordsMatch('their', 'there', 'normal')).toBe(true);
  });
  it('is exact for short words', () => {
    expect(wordsMatch('cat', 'hat', 'lenient')).toBe(false);
  });
  it('allows small differences in long words when lenient', () => {
    expect(wordsMatch('elephant', 'elefant', 'lenient')).toBe(true);
    expect(wordsMatch('elephant', 'elefant', 'strict')).toBe(false);
  });
});

describe('applyHeard', () => {
  it('marks words read in order as correct', () => {
    const { s } = read('The cat sat on the mat.', 'the cat sat', 'on the mat');
    expect(s.statuses.every((x) => x === 'correct')).toBe(true);
    expect(s.cursor).toBe(6);
  });

  it('marks skipped words as missed', () => {
    const { s } = read('The big red dog ran.', 'the dog ran');
    expect(s.statuses).toEqual(['correct', 'missed', 'missed', 'correct', 'correct']);
  });

  it('marks a word wrong, then retried when corrected', () => {
    const { s } = read('I like apples.', 'I like', 'oranges', 'apples');
    expect(s.statuses).toEqual(['correct', 'correct', 'retried']);
  });

  it('gives up on a word after maxAttempts wrong tries', () => {
    const { s } = read('The giraffe ate.', 'the', 'garage', 'garbage');
    expect(s.statuses.slice(0, 2)).toEqual(['correct', 'missed']);
    expect(s.cursor).toBe(2);
  });

  it('does not penalise repeating the previous word', () => {
    const { s } = read('We ran home.', 'we ran ran home');
    expect(s.statuses).toEqual(['correct', 'correct', 'correct']);
  });

  it('interim (non-penalising) results only advance on matches', () => {
    const { words } = tokenize('Look at the moon.');
    const s = applyHeard(initialState(words.length), words, splitHeard('look zzz'), { ...opts, penalize: false });
    expect(s.statuses).toEqual(['correct', 'pending', 'pending', 'pending']);
    expect(s.attempts[1]).toBe(0);
  });

  it('does not modify the input state', () => {
    const { words } = tokenize('Hello there.');
    const s0 = initialState(words.length);
    applyHeard(s0, words, ['hello'], opts);
    expect(s0.cursor).toBe(0);
  });
});

describe('skipWord and summarize', () => {
  it('summarizes accuracy and tricky words', () => {
    const { s, words } = read('I like apples a lot.', 'I like', 'oranges', 'apples');
    const done = skipWord(skipWord(s));
    const sum = summarize(done, words);
    expect(sum.read).toBe(5);
    expect(sum.missed).toBe(2);
    expect(sum.accuracy).toBe(60);
    expect(sum.trickyWords).toEqual(['apples', 'a', 'lot']);
  });
});
