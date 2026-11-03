# 📖 Reading Buddy

A read-along app for kids. Paste a story or a news article (or have one written for you), press the
microphone, and read out loud. Words turn **green** when read correctly and **red** when they're skipped or
misread, so the child sees their progress live.

## Features

- **Read-along with live feedback**: uses the browser's speech recognition to follow the reader word by word.
  - 🟢 green: read correctly
  - 🟢 with an orange wavy underline: got it right on a second try
  - 🔴 red: skipped, or still wrong after the allowed tries
  - 🟡 yellow highlight: the word to read next
- **Age levels** (4–5, 6–7, 8–9, 10–12): change text size, story length and vocabulary, how forgiving the
  matching is, and how fast "Read to me" talks.
- **Practice words**: type in the words that come home from school, or load Dolch sight-word lists. Practice
  words are shown in bold inside stories.
- **Custom stories**: with a Claude API key, Reading Buddy writes a new story at the chosen level that uses
  every practice word, about whatever topic the child likes. Without a key it uses a built-in story library.
- **Make it easier**: rewrites a pasted text (e.g. a news article) at the child's reading level.
- **Read to me**: reads the text aloud, highlighting each word. Tap any word to hear just that word.
- **Results and reading log**: accuracy, words per minute, stars, and a "words to practise" list that can be
  added to the practice words with one tap. Finished readings are kept in a log.
- **Easier-to-read mode**: dyslexia-friendly font and extra spacing.

## Running it

Requires Node 20+.

```bash
npm install
npm run dev
```

Open the printed URL (http://localhost:5173) in **Chrome, Edge or Safari**. Firefox doesn't support speech
recognition yet. The microphone only works on `localhost` or over HTTPS.

### On your home network (tablets, phones, other computers)

```bash
npm run dev:lan
```

This serves the app over HTTPS and prints a **Network** address such as `https://192.168.1.23:5173`. Open
that address on any device on the same Wi-Fi. HTTPS is needed because browsers only allow the microphone
on `https://` addresses (or `localhost`).

The certificate is self-signed, so each device shows a one-time "connection is not private" warning the
first time. Tap **Advanced** → **Proceed** (Chrome/Edge) or **Show Details** → **visit this website**
(Safari). It's safe here because you're connecting to your own computer.

To keep it running without the dev tooling, build once and serve the result:

```bash
npm run serve:lan
```

That uses port 4173 instead of 5173. Notes:
- The computer running it has to stay on, and devices need internet access for speech recognition.
- If a device can't connect, allow Node through the computer's firewall for private networks.
- Each device keeps its own API key, practice words and reading log (they're stored in the browser).
- If the cached certificate is removed, a new one is generated and devices show the warning again.

Other commands:

```bash
npm test         # unit tests for the word matching engine
npm run build    # type-check and build to dist/
```

## Story generation (optional)

Open ⚙️ Settings and paste a Claude API key (from https://console.anthropic.com). The key is stored in this
browser's local storage and is sent only to the Anthropic API. This is fine for a family using the app on
their own device. **Before publishing the app for other people, move the Claude calls in `src/story.ts` to a
small backend** so that no key lives in the browser.

## How the matching works

`src/matcher.ts` holds the logic, which is pure and unit tested:

1. The text is split into words. Each word has a status and a cursor points at the next word to read.
2. Every word the recognizer hears is compared with the word at the cursor and a few words ahead
   (`lookahead`). A match ahead means the words in between were skipped and are marked red.
3. A word that doesn't match counts as a wrong try. After `maxAttempts` wrong tries the word turns red
   and the cursor moves on, so a child never gets stuck.
4. Comparison ignores case and punctuation, treats numbers and number words as the same (3 = three),
   accepts homophones the recognizer can't tell apart (there/their, to/two), and, at the younger levels,
   allows small spelling slips in long words.
5. Interim (still-changing) recognizer results only move the cursor forward. Only settled results count
   as mistakes.

## Privacy note

In Chrome and Edge, speech recognition audio goes to the browser maker's servers for processing. Reading
history and practice words stay in the browser's local storage.

## Project layout

```
index.html        page markup
src/main.ts       UI and app state
src/matcher.ts    word matching engine
src/speech.ts     speech recognition and text-to-speech wrappers
src/story.ts      Claude story generation and the built-in story library
src/levels.ts     age levels and Dolch word lists
src/storage.ts    localStorage helpers
tests/            unit tests (Vitest)
```
