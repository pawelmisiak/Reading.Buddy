import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoryStore, createStoriesHandler, parseStory } from '../server/storiesApi';

let dir: string;
let file: string;
let server: Server;
let base: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rb-stories-'));
  file = join(dir, 'data', 'stories.json');
  const handler = createStoriesHandler(new StoryStore(file));
  server = createServer((req, res) =>
    handler(req, res, () => {
      res.statusCode = 404;
      res.end('not api');
    }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

const story = { title: 'Sun Day', text: 'The sun is big.', usedWords: ['sun'], source: 'claude' };
const post = (body: unknown) =>
  fetch(`${base}/api/stories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('stories API', () => {
  it('starts empty, saves to the file, lists and deletes', async () => {
    expect(await (await fetch(`${base}/api/stories`)).json()).toEqual([]);

    const saved = await (await post({ story, levelId: 'age4' })).json();
    expect(saved.added).toBe(true);
    expect(saved.entry).toMatchObject({ title: 'Sun Day', levelId: 'age4', practiceWords: ['sun'] });

    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    expect(onDisk).toHaveLength(1);

    const list = await (await fetch(`${base}/api/stories`)).json();
    expect(list.map((s: { id: string }) => s.id)).toEqual([saved.entry.id]);

    expect((await fetch(`${base}/api/stories/${saved.entry.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await fetch(`${base}/api/stories`)).json()).toEqual([]);
    expect((await fetch(`${base}/api/stories/${saved.entry.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('does not duplicate a story', async () => {
    await post({ story, levelId: 'age4' });
    const again = await (await post({ story, levelId: 'age4' })).json();
    expect(again.added).toBe(false);
    expect(await (await fetch(`${base}/api/stories`)).json()).toHaveLength(1);
  });

  it('keeps every story when several devices save at once', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => post({ story: { ...story, text: `Story ${i}` }, levelId: 'age6' })));
    expect(await (await fetch(`${base}/api/stories`)).json()).toHaveLength(10);
  });

  it('rejects empty or invalid stories', async () => {
    expect((await post({ story: { text: '   ' } })).status).toBe(400);
    const bad = await fetch(`${base}/api/stories`, { method: 'POST', body: '{not json' });
    expect(bad.status).toBe(400);
  });

  it('leaves other URLs alone', async () => {
    expect(await (await fetch(`${base}/index.html`)).text()).toBe('not api');
  });
});

describe('parseStory', () => {
  it('cleans unexpected fields', () => {
    expect(parseStory({ story: { text: 'Hi.', source: 'evil', usedWords: ['a', 3] } })).toEqual({
      story: { title: 'My Story', text: 'Hi.', usedWords: ['a'], source: 'library' },
      levelId: 'age6',
    });
  });
});
