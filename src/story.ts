import Anthropic from '@anthropic-ai/sdk';
import type { Level } from './levels';

export interface Story {
  title: string;
  text: string;
  /** Practice words that actually appear in the story. */
  usedWords: string[];
  source: 'claude' | 'library';
}

/**
 * Every Claude request in the app uses exactly this model. No refusal
 * fallbacks are configured, so a request is never re-run on another model.
 */
export const MODEL = 'claude-sonnet-5-5';

const STORY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    story: { type: 'string' },
  },
  required: ['title', 'story'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You write reading practice texts for children who are learning to read aloud with a reading app.
Everything you write must be kind, safe and appropriate for young children: no violence, scary content, brand names or real people.
Write plain prose only: no headings, lists, emoji, or markdown. Use simple punctuation. Spell numbers as words.`;

function makeClient(apiKey: string): Anthropic {
  // The key belongs to the parent and is kept in this browser only. For a
  // public deployment, move this call to a small backend instead.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

async function askClaude(apiKey: string, prompt: string): Promise<{ title: string; story: string }> {
  const client = makeClient(apiKey);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: STORY_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  // The API reports which model actually answered; refuse anything else.
  if (!response.model.startsWith(MODEL)) {
    throw new Error(`Expected ${MODEL} but the reply came from ${response.model}.`);
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('Claude could not write this story. Try different words or a different topic.');
  }
  const text = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  const parsed = JSON.parse(text) as { title?: string; story?: string };
  if (!parsed.story) throw new Error('The story came back empty. Please try again.');
  return { title: parsed.title?.trim() || 'My Story', story: parsed.story.trim() };
}

export function wordsInText(text: string, words: string[]): string[] {
  const lower = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}'’]+/gu, ' ')} `;
  return words.filter((w) => lower.includes(` ${w.toLowerCase()} `));
}

export async function generateStory(opts: {
  apiKey: string;
  level: Level;
  practiceWords: string[];
  topic: string;
  childName: string;
}): Promise<Story> {
  const { level, practiceWords, topic, childName } = opts;
  const [min, max] = level.storyWords;
  const prompt = [
    `Write an original short story for a child aged ${level.label.replace('Ages ', '')} (${level.grade}).`,
    `Length: between ${min} and ${max} words.`,
    `Reading level: ${level.style}`,
    practiceWords.length
      ? `The child is practising these words from school. Use every one of them at least once, and use the trickiest ones two or three times, in natural sentences: ${practiceWords.join(', ')}.`
      : '',
    topic ? `Topic or theme: ${topic}.` : 'Pick a fun, gentle topic (animals, friendship, nature, a small adventure).',
    childName ? `The main character can be named ${childName}.` : '',
    'Give the story a short title.',
  ]
    .filter(Boolean)
    .join('\n');

  const { title, story } = await askClaude(opts.apiKey, prompt);
  return { title, text: story, usedWords: wordsInText(story, practiceWords), source: 'claude' };
}

/** Rewrite pasted text (e.g. a news story) at the child's reading level. */
export async function simplifyText(opts: { apiKey: string; level: Level; text: string }): Promise<Story> {
  const { level, text } = opts;
  const prompt = [
    `Rewrite the text below so a child aged ${level.label.replace('Ages ', '')} (${level.grade}) can read it aloud.`,
    `Reading level: ${level.style}`,
    `Keep the important facts, leave out anything frightening or upsetting, and keep it under ${level.storyWords[1]} words.`,
    'Give it a short title.',
    '',
    '<text>',
    text,
    '</text>',
  ].join('\n');
  const { title, story } = await askClaude(opts.apiKey, prompt);
  return { title, text: story, usedWords: [], source: 'claude' };
}

/** Offline stories, used when no API key is set. */
const LIBRARY: Record<string, { title: string; text: string }[]> = {
  age4: [
    {
      title: 'The Big Red Ball',
      text: 'I see a ball. The ball is red. It is a big red ball. I can play with the ball. Look! The ball can jump. Up, up, up it goes. Down it comes. Come and play with me. We can run and play.',
    },
    {
      title: 'Where Is My Cat?',
      text: 'Where is my cat? Is my cat in the box? No, not in the box. Is my cat up here? No, not up here. I look and look. Here is my cat! My little cat is in my bed. Funny cat!',
    },
  ],
  age6: [
    {
      title: 'Pip and the Rainy Day',
      text: 'Pip the puppy woke up and looked out the window. It was a rainy day. "Oh no," said Pip. "Now I cannot go out to play." His friend Tess the cat came over. "We can play inside," she said. "Let us build a big fort with the blankets." They put the blankets over two chairs. Then they went inside the fort with a book. Tess read the book out loud, and Pip listened. When the rain stopped, they saw a rainbow. "That was the best rainy day ever," said Pip.',
    },
    {
      title: 'The Garden Surprise',
      text: 'Mia planted a little seed in the garden. Every day she gave it water. Every day she looked to see if it had grown. At first there was nothing at all. Then one morning she saw a tiny green leaf. "It is growing!" she said. The plant grew taller and taller. One day it had a big yellow flower that was as bright as the sun. Mia smiled and said, "Thank you for growing, little seed."',
    },
  ],
  age8: [
    {
      title: 'The Lighthouse Keeper',
      text: 'On a rocky island far from the town, there was an old lighthouse. A woman named Rosa took care of it, and every night she climbed one hundred stairs to turn on the light. One stormy evening, the light would not turn on. Rosa could hear the waves crashing against the rocks, and she knew that a fishing boat was coming home. She checked the wires and found one that had come loose. With careful hands, she fixed it, and the great light began to shine across the dark water. A few minutes later, the fishing boat sailed safely into the harbor. The next morning, the fishermen brought Rosa a basket of fresh bread to say thank you. "Your light brought us home," they said. Rosa smiled. That was the best part of her job.',
    },
    {
      title: 'The Missing Library Book',
      text: 'Leo could not find his library book anywhere. He looked under his bed, behind the couch, and even inside the refrigerator. The book was due back tomorrow, and he was worried. His sister Ava offered to help. "Let us think like detectives," she said. "Where were you when you last read it?" Leo remembered reading in the backyard, under the apple tree. They ran outside together. There, tucked between two roots, was the book, a little damp but safe. Leo hugged it. "Thank you, Detective Ava," he said. From then on, Leo always put his book back on the shelf.',
    },
  ],
  age10: [
    {
      title: 'The Clockmaker’s Apprentice',
      text: 'In a narrow street that smelled of cinnamon and rain, there was a tiny shop filled with ticking clocks. The clockmaker, Mr. Halden, was very old, and his hands had started to shake. One autumn afternoon, a curious girl named Juniper pressed her nose against the window, watching the gears spin inside a clock with a glass face. Mr. Halden noticed her and waved her inside. "Would you like to learn?" he asked. Juniper nodded so quickly that her hat nearly fell off. Every day after school, she practiced. She learned how a tiny spring stores energy, how a pendulum keeps a steady rhythm, and how patience matters more than speed. Some days, nothing worked, and she wanted to give up. But Mr. Halden reminded her that every expert was once a beginner. Months later, the town hall clock stopped just before the winter festival. Mr. Halden could no longer climb the tower, so Juniper went instead. Inside, she found a gear with one broken tooth. Carefully, she replaced it with one she had made herself. At midnight, the great bell rang out across the snowy town, and everyone cheered. Juniper realized that she had not just fixed a clock. She had found something she truly loved.',
    },
  ],
};

export function libraryStory(level: Level, practiceWords: string[]): Story {
  const pool = LIBRARY[level.id] ?? LIBRARY.age6;
  // Prefer the story that already contains the most practice words.
  let best = pool[Math.floor(Math.random() * pool.length)];
  let bestCount = wordsInText(best.text, practiceWords).length;
  for (const s of pool) {
    const c = wordsInText(s.text, practiceWords).length;
    if (c > bestCount) {
      best = s;
      bestCount = c;
    }
  }
  return {
    title: best.title,
    text: best.text,
    usedWords: wordsInText(best.text, practiceWords),
    source: 'library',
  };
}

export function practiceWordsDrill(words: string[]): Story {
  return {
    title: 'Word Warm-Up',
    text: words.join('   '),
    usedWords: words,
    source: 'library',
  };
}
