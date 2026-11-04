/**
 * "My stories": texts the family chose to keep. Pure list operations; main.ts
 * persists the list with storage.ts.
 */
import type { Story } from './story';

export interface SavedStory {
  id: string;
  title: string;
  text: string;
  /** Level id the story was saved at (see levels.ts). */
  levelId: string;
  source: Story['source'];
  /** Practice words the story contains. */
  practiceWords: string[];
  savedAt: string;
}

export const MAX_SAVED = 200;

function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

export function findSaved(list: SavedStory[], text: string): SavedStory | undefined {
  return list.find((s) => sameText(s.text, text));
}

/**
 * Add a story to the front of the list. A story with the same text is not
 * duplicated; the existing entry is returned instead.
 */
export function addStory(
  list: SavedStory[],
  story: Story,
  levelId: string,
  now: Date = new Date(),
): { list: SavedStory[]; entry: SavedStory; added: boolean } {
  const existing = findSaved(list, story.text);
  if (existing) return { list, entry: existing, added: false };
  const entry: SavedStory = {
    id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: story.title.trim() || 'My Story',
    text: story.text,
    levelId,
    source: story.source,
    practiceWords: story.usedWords,
    savedAt: now.toISOString(),
  };
  return { list: [entry, ...list].slice(0, MAX_SAVED), entry, added: true };
}

export function removeStory(list: SavedStory[], id: string): SavedStory[] {
  return list.filter((s) => s.id !== id);
}

export function toStory(saved: SavedStory): Story {
  return { title: saved.title, text: saved.text, usedWords: saved.practiceWords, source: saved.source };
}
