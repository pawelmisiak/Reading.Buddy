import { describe, expect, it } from 'vitest';
import { MAX_SAVED, addStory, findSaved, removeStory, toStory } from '../src/library';
import type { Story } from '../src/story';

const story: Story = { title: 'Sun Day', text: 'The sun is big.', usedWords: ['sun'], source: 'claude' };

describe('library', () => {
  it('adds a story to the front with its level and practice words', () => {
    const { list, entry, added } = addStory([], story, 'age4', new Date('2026-11-04T10:00:00Z'));
    expect(added).toBe(true);
    expect(list).toEqual([entry]);
    expect(entry).toMatchObject({ title: 'Sun Day', levelId: 'age4', practiceWords: ['sun'], savedAt: '2026-11-04T10:00:00.000Z' });
    expect(toStory(entry)).toEqual(story);
  });

  it('does not save the same text twice', () => {
    const first = addStory([], story, 'age4');
    const again = addStory(first.list, { ...story, text: '  The sun   is big. ' }, 'age6');
    expect(again.added).toBe(false);
    expect(again.list).toHaveLength(1);
    expect(findSaved(again.list, 'The sun is big.')).toBe(first.entry);
  });

  it('removes a story by id', () => {
    const a = addStory([], story, 'age4');
    const b = addStory(a.list, { ...story, text: 'Another one.' }, 'age4');
    expect(removeStory(b.list, a.entry.id).map((s) => s.text)).toEqual(['Another one.']);
  });

  it('keeps at most MAX_SAVED stories', () => {
    let list = addStory([], story, 'age4').list;
    for (let i = 0; i < MAX_SAVED + 5; i++) list = addStory(list, { ...story, text: `Story ${i}` }, 'age4').list;
    expect(list).toHaveLength(MAX_SAVED);
    expect(list[0].text).toBe(`Story ${MAX_SAVED + 4}`);
  });
});
