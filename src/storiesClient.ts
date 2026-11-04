/** Browser side of app storage: talks to /api/stories (server/storiesApi.ts). */
import type { SavedStory } from './library';
import type { Story } from './story';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  } catch {
    throw new Error("Can't reach the Reading Buddy app on your computer. Is it still running?");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      res.status === 404 && !data.error
        ? 'This copy of the app has no story storage. Start it with npm run dev:lan or npm run serve:lan.'
        : (data.error ?? `Saving failed (error ${res.status}).`),
    );
  }
  return data;
}

export function fetchStories(): Promise<SavedStory[]> {
  return call<SavedStory[]>('/api/stories');
}

export function saveStory(story: Story, levelId: string): Promise<{ entry: SavedStory; added: boolean }> {
  return call('/api/stories', { method: 'POST', body: JSON.stringify({ story, levelId }) });
}

export async function deleteStory(id: string): Promise<void> {
  await call(`/api/stories/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
