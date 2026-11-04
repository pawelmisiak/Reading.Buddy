import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLevel } from '../src/levels';
import { MODEL, generateStory } from '../src/story';

function fakeReply(model: string) {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: JSON.stringify({ title: 'Sun Day', story: 'The sun is big. I like the sun.' }) }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('generateStory', () => {
  it('always asks for Claude Sonnet 5.5, with no fallback models', async () => {
    const fetchMock = vi.fn(async () => fakeReply('claude-sonnet-5-5'));
    vi.stubGlobal('fetch', fetchMock);

    const story = await generateStory({
      apiKey: 'sk-ant-test',
      level: getLevel('age4'),
      practiceWords: ['sun', 'big'],
      topic: '',
      childName: '',
    });

    expect(MODEL).toBe('claude-sonnet-5-5');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/v1/messages');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body).not.toHaveProperty('fallbacks');
    expect(story.usedWords).toEqual(['sun', 'big']);
  });

  it('rejects a reply that came from a different model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeReply('claude-opus-5-5')));
    await expect(
      generateStory({ apiKey: 'sk-ant-test', level: getLevel('age4'), practiceWords: [], topic: '', childName: '' }),
    ).rejects.toThrow(/Expected claude-sonnet-5-5/);
  });
});
