/**
 * App storage for "My stories": a JSON file on the computer that runs the app,
 * shared by every device on the home network.
 *
 * Exposed by the Vite dev and preview servers (see vite.config.ts):
 *   GET    /api/stories        -> SavedStory[]
 *   POST   /api/stories        {story, levelId} -> {entry, added}
 *   DELETE /api/stories/:id    -> {ok: true}
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import type { Plugin } from 'vite';
import { addStory, removeStory, type SavedStory } from '../src/library.ts';
import type { Story } from '../src/story.ts';

const MAX_BODY_BYTES = 1_000_000;
const MAX_TEXT_CHARS = 50_000;

export class StoryStore {
  /** Serializes writes so two devices saving at once can't lose a story. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly file: string) {}

  async list(): Promise<SavedStory[]> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      return Array.isArray(data) ? (data as SavedStory[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  add(story: Story, levelId: string): Promise<{ entry: SavedStory; added: boolean }> {
    return this.update((list) => {
      const r = addStory(list, story, levelId);
      return { list: r.list, result: { entry: r.entry, added: r.added } };
    });
  }

  remove(id: string): Promise<boolean> {
    return this.update((list) => {
      const next = removeStory(list, id);
      return { list: next, result: next.length !== list.length };
    });
  }

  private update<T>(fn: (list: SavedStory[]) => { list: SavedStory[]; result: T }): Promise<T> {
    const run = this.queue.then(async () => {
      const { list, result } = fn(await this.list());
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(list, null, 2));
      await rename(tmp, this.file); // atomic: a crash never leaves a half-written file
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** Check and clean a story sent by the browser. Returns null if it isn't valid. */
export function parseStory(body: unknown): { story: Story; levelId: string } | null {
  if (!body || typeof body !== 'object') return null;
  const { story, levelId } = body as { story?: Partial<Story>; levelId?: unknown };
  if (!story || typeof story.text !== 'string' || !story.text.trim()) return null;
  if (story.text.length > MAX_TEXT_CHARS) return null;
  const words = Array.isArray(story.usedWords) ? story.usedWords.filter((w) => typeof w === 'string') : [];
  return {
    story: {
      title: typeof story.title === 'string' ? story.title.slice(0, 200) : 'My Story',
      text: story.text,
      usedWords: words.slice(0, 100).map((w) => w.slice(0, 50)),
      source: story.source === 'claude' ? 'claude' : 'library',
    },
    levelId: typeof levelId === 'string' ? levelId.slice(0, 20) : 'age6',
  };
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

export function createStoriesHandler(store: StoryStore) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/stories' && !url.pathname.startsWith('/api/stories/')) return next();
    const id = decodeURIComponent(url.pathname.slice('/api/stories/'.length));
    try {
      if (req.method === 'GET' && !id) return sendJson(res, 200, await store.list());
      if (req.method === 'POST' && !id) {
        let body: unknown;
        try {
          body = await readBody(req);
        } catch {
          return sendJson(res, 400, { error: 'Invalid request body.' });
        }
        const parsed = parseStory(body);
        if (!parsed) return sendJson(res, 400, { error: 'That story is empty or too long to save.' });
        return sendJson(res, 200, await store.add(parsed.story, parsed.levelId));
      }
      if (req.method === 'DELETE' && id) {
        return (await store.remove(id))
          ? sendJson(res, 200, { ok: true })
          : sendJson(res, 404, { error: 'Story not found.' });
      }
      return sendJson(res, 405, { error: 'Method not allowed.' });
    } catch (err) {
      console.error('[stories]', err);
      return sendJson(res, 500, { error: 'The app could not read or write its story file.' });
    }
  };
}

/** Vite plugin that serves /api/stories from both `vite` and `vite preview`. */
export function storiesApi(file: string): Plugin {
  const handler = createStoriesHandler(new StoryStore(file));
  return {
    name: 'reading-buddy-stories-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
  };
}
