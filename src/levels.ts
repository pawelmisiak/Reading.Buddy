import type { Strictness } from './matcher';

export interface Level {
  id: string;
  label: string;
  grade: string;
  /** Font size of the reading text, in px. */
  fontSize: number;
  /** Target length for generated stories. */
  storyWords: [number, number];
  /** Guidance for the story writer. */
  style: string;
  strictness: Strictness;
  lookahead: number;
  maxAttempts: number;
  /** Speech rate for "Read to me". */
  ttsRate: number;
}

export const LEVELS: Level[] = [
  {
    id: 'age4',
    label: 'Ages 4–5',
    grade: 'Pre-K / Kindergarten',
    fontSize: 44,
    storyWords: [30, 60],
    style:
      'Very short sentences of 3 to 6 words. Mostly one-syllable sight words and simple CVC words (cat, sun, big). Lots of repetition. One idea per sentence.',
    strictness: 'lenient',
    lookahead: 2,
    maxAttempts: 3,
    ttsRate: 0.75,
  },
  {
    id: 'age6',
    label: 'Ages 6–7',
    grade: 'Grades 1–2',
    fontSize: 36,
    storyWords: [80, 130],
    style:
      'Short sentences of 5 to 10 words. Simple everyday words, a little dialogue, a clear beginning, middle and end.',
    strictness: 'lenient',
    lookahead: 3,
    maxAttempts: 3,
    ttsRate: 0.85,
  },
  {
    id: 'age8',
    label: 'Ages 8–9',
    grade: 'Grades 3–4',
    fontSize: 30,
    storyWords: [150, 220],
    style:
      'Sentences of varied length, some two- and three-syllable words, dialogue, and a small problem the characters solve.',
    strictness: 'normal',
    lookahead: 3,
    maxAttempts: 2,
    ttsRate: 0.95,
  },
  {
    id: 'age10',
    label: 'Ages 10–12',
    grade: 'Grades 5–6',
    fontSize: 26,
    storyWords: [250, 350],
    style:
      'Richer vocabulary, descriptive language, paragraphs, and a plot with a twist. Still friendly and age-appropriate.',
    strictness: 'normal',
    lookahead: 4,
    maxAttempts: 2,
    ttsRate: 1,
  },
];

export function getLevel(id: string): Level {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[1];
}

/** Dolch sight word lists, the words most US schools send home. */
export const WORD_LISTS: Record<string, string[]> = {
  'Dolch Pre-Primer': 'a and away big blue can come down find for funny go help here I in is it jump little look make me my not one play red run said see the three to two up we where yellow you'.split(' '),
  'Dolch Primer': 'all am are at ate be black brown but came did do eat four get good have he into like must new no now on our out please pretty ran ride saw say she so soon that there they this too under want was well went what white who will with yes'.split(' '),
  'Dolch 1st Grade': 'after again an any as ask by could every fly from give going had has her him his how just know let live may of old once open over put round some stop take thank them then think walk were when'.split(' '),
  'Dolch 2nd Grade': "always around because been before best both buy call cold does don't fast first five found gave goes green its made many off or pull read right sing sit sleep tell their these those upon us use very wash which why wish work would write your".split(' '),
  'Dolch 3rd Grade': 'about better bring carry clean cut done draw drink eight fall far full got grow hold hot hurt if keep kind laugh light long much myself never only own pick seven shall show six small start ten today together try warm'.split(' '),
};

/** Pick a few random words from a list (for quick practice sets). */
export function sampleWords(list: string[], n: number): string[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
