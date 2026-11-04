import { LEVELS, WORD_LISTS, getLevel, sampleWords, type Level } from './levels';
import {
  applyHeard,
  initialState,
  skipWord,
  splitHeard,
  summarize,
  tokenize,
  type MatchOptions,
  type ReadState,
  type TokenizedText,
} from './matcher';
import { Listener, recognitionSupported, speak, stopSpeaking, ttsSupported } from './speech';
import { generateStory, libraryStory, practiceWordsDrill, simplifyText, wordsInText, type Story } from './story';
import { load, save, type SessionRecord } from './storage';
import { addStory, findSaved, removeStory, toStory, type SavedStory } from './library';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- persisted settings ----------
let level: Level = getLevel(load('level', 'age6'));
let practiceWords: string[] = load('practiceWords', []);
let apiKey: string = load('apiKey', '');
let lang: string = load('lang', 'en-US');
let history: SessionRecord[] = load('history', []);
let library: SavedStory[] = load('library', []);

// ---------- reading session ----------
let current: { story: Story; tokens: TokenizedText } | null = null;
let committed: ReadState = initialState(0);
let shown: ReadState = committed;
let startedAt = 0;
let lastProgressAt = 0;
let saved = false;
let wordEls: HTMLElement[] = [];

const listener = new Listener(
  {
    onInterim: (t) => {
      $('heard').textContent = t ? `I hear: “${t}”` : '';
      if (!current) return;
      shown = applyHeard(committed, current.tokens.words, splitHeard(t), matchOpts(false));
      render();
    },
    onFinal: (t) => {
      if (!current) return;
      committed = applyHeard(committed, current.tokens.words, splitHeard(t), matchOpts(true));
      shown = committed;
      progressed();
    },
    onError: (msg) => toast(msg),
    onStateChange: (on) => {
      const btn = $('micBtn');
      btn.classList.toggle('listening', on);
      btn.textContent = on ? '⏹ Stop' : '🎤 Start reading';
      if (!on) {
        $('heard').textContent = '';
        shown = committed;
        render();
        if (summarize(committed, current?.tokens.words ?? []).read > 0) showResults();
      }
    },
  },
  lang,
);

function matchOpts(penalize: boolean): MatchOptions {
  return {
    strictness: level.strictness,
    lookahead: level.lookahead,
    maxAttempts: level.maxAttempts,
    penalize,
  };
}

// ---------- rendering ----------
function loadStory(story: Story): void {
  stopSpeaking();
  if (listener.listening) listener.stop();
  const tokens = tokenize(story.text);
  if (tokens.words.length === 0) {
    toast('There are no words to read in that text.');
    return;
  }
  current = { story, tokens };
  resetReading();

  $('storyTitle').textContent = story.title;
  const box = $('storyText');
  box.replaceChildren();
  box.style.fontSize = `${level.fontSize}px`;
  const practiceSet = new Set(practiceWords.map((w) => w.toLowerCase()));
  wordEls = [];
  for (const part of tokens.parts) {
    if (part.wordIndex === null) {
      box.append(part.text);
      continue;
    }
    const span = document.createElement('span');
    span.className = 'w';
    if (practiceSet.has(part.text.toLowerCase())) span.classList.add('practice');
    span.textContent = part.text;
    span.dataset.i = String(part.wordIndex);
    span.title = 'Tap to hear this word';
    box.append(span);
    wordEls.push(span);
  }
  $('reader').classList.remove('hidden');
  $('results').classList.add('hidden');
  $('setup').classList.add('hidden');
  updateSaveButton();
  render();
  $('reader').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetReading(): void {
  committed = initialState(current?.tokens.words.length ?? 0);
  shown = committed;
  startedAt = 0;
  lastProgressAt = 0;
  saved = false;
  $('results').classList.add('hidden');
}

function render(): void {
  wordEls.forEach((el, i) => {
    const st = shown.statuses[i];
    el.classList.remove('correct', 'retried', 'wrong', 'missed', 'current');
    if (st !== 'pending') el.classList.add(st);
    if (i === shown.cursor && st !== 'wrong') el.classList.add('current');
  });
  const cur = wordEls[shown.cursor];
  if (cur && listener.listening) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function progressed(): void {
  const now = Date.now();
  if (!startedAt) startedAt = now;
  lastProgressAt = now;
  render();
  if (current && committed.cursor >= current.tokens.words.length) {
    if (listener.listening) listener.stop(); // onStateChange shows the results
    else showResults();
  }
}

function showResults(): void {
  if (!current) return;
  const words = current.tokens.words;
  const s = summarize(committed, words);
  const minutes = Math.max((lastProgressAt - startedAt) / 60000, 1 / 60);
  const wpm = startedAt ? Math.round((s.correct + s.retried) / minutes) : 0;
  const finished = committed.cursor >= words.length;
  const stars = s.accuracy >= 95 ? 3 : s.accuracy >= 80 ? 2 : s.accuracy >= 50 ? 1 : 0;

  $('resultsTitle').textContent = finished
    ? stars === 3
      ? 'Amazing reading! 🌟'
      : 'You finished! 🎉'
    : 'Nice work so far! 👍';
  $('stats').innerHTML = `
    <div class="stat"><b>${s.accuracy}%</b><span>words right</span></div>
    <div class="stat"><b>${s.read}/${s.total}</b><span>words read</span></div>
    <div class="stat"><b>${wpm}</b><span>words per minute</span></div>
    <div class="stat"><b>${s.retried}</b><span>fixed on a retry</span></div>`;

  const box = $('trickyBox');
  box.replaceChildren();
  const starsEl = document.createElement('div');
  starsEl.className = 'stars';
  starsEl.textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
  box.append(starsEl);
  if (s.trickyWords.length) {
    const wrap = document.createElement('div');
    wrap.className = 'tricky';
    wrap.innerHTML = '<p><b>Words to practise</b> (tap to hear):</p>';
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const w of s.trickyWords) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = w;
      c.onclick = () => speak(w, { rate: level.ttsRate * 0.85, lang });
      chips.append(c);
    }
    const add = document.createElement('button');
    add.className = 'secondary';
    add.textContent = '⭐ Add these to my practice words';
    add.onclick = () => {
      addPracticeWords(s.trickyWords);
      toast('Added to practice words. Make a story with them next!');
    };
    wrap.append(chips, add);
    box.append(wrap);
  }
  $('results').classList.remove('hidden');

  if (finished && !saved) {
    saved = true;
    history.unshift({
      date: new Date().toISOString(),
      title: current.story.title,
      level: level.label,
      accuracy: s.accuracy,
      wordsRead: s.read,
      wpm,
      tricky: s.trickyWords,
    });
    history = history.slice(0, 50);
    save('history', history);
    renderHistory();
  }
}

function renderHistory(): void {
  const el = $('history');
  if (!history.length) {
    el.innerHTML = '<p class="hint">Finished readings will show up here.</p>';
    return;
  }
  const rows = history
    .slice(0, 15)
    .map(
      (h) => `<tr>
        <td>${new Date(h.date).toLocaleDateString()}</td>
        <td>${escapeHtml(h.title)}</td>
        <td>${escapeHtml(h.level)}</td>
        <td>${h.accuracy}%</td>
        <td>${h.wpm}</td>
        <td>${escapeHtml(h.tricky.slice(0, 6).join(', '))}</td>
      </tr>`,
    )
    .join('');
  el.innerHTML = `<div class="history-wrap"><table>
    <thead><tr><th>Date</th><th>Text</th><th>Level</th><th>Right</th><th>WPM</th><th>Tricky words</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------- practice words ----------
function addPracticeWords(words: string[]): void {
  const set = new Set(practiceWords.map((w) => w.toLowerCase()));
  for (const raw of words) {
    const w = raw.trim();
    if (w && !set.has(w.toLowerCase())) {
      practiceWords.push(w);
      set.add(w.toLowerCase());
    }
  }
  save('practiceWords', practiceWords);
  renderChips();
}

function renderChips(): void {
  const box = $('wordChips');
  box.replaceChildren();
  if (!practiceWords.length) {
    box.innerHTML = '<span class="hint">No practice words yet.</span>';
  }
  for (const w of practiceWords) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = w;
    label.onclick = () => speak(w, { rate: level.ttsRate * 0.85, lang });
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = `Remove ${w}`;
    x.onclick = () => {
      practiceWords = practiceWords.filter((p) => p !== w);
      save('practiceWords', practiceWords);
      renderChips();
    };
    chip.append(label, x);
    box.append(chip);
  }
  $('storyWordsHint').textContent = practiceWords.length
    ? `Practice words: ${practiceWords.join(', ')}`
    : 'Tip: add practice words in the ⭐ tab and the story will use them.';
  ($('drill') as HTMLButtonElement).disabled = practiceWords.length === 0;
}

function updateModeHints(): void {
  $('storyModeHint').textContent = apiKey
    ? 'Stories are written fresh by Claude Sonnet 5.5.'
    : 'No Claude API key set, so a built-in story is used. Add a key in ⚙️ Settings for brand-new stories.';
  ($('simplifyPasted') as HTMLButtonElement).disabled = !apiKey;
}

// ---------- my stories ----------
function updateSaveButton(): void {
  const btn = $<HTMLButtonElement>('saveStory');
  const isSaved = !!current && !!findSaved(library, current.story.text);
  btn.textContent = isSaved ? '✓ Saved' : '💾 Save story';
  btn.disabled = isSaved;
}

function saveCurrentStory(): void {
  if (!current) return;
  const { list, added } = addStory(library, current.story, level.id);
  if (!added) return updateSaveButton();
  if (!save('library', list)) {
    toast("Couldn't save: this browser's storage is full or turned off. Try deleting some saved stories.");
    return;
  }
  library = list;
  updateSaveButton();
  renderLibrary();
  toast('Saved to 📚 My stories.');
}

function renderLibrary(): void {
  $('libraryCount').textContent = library.length ? ` (${library.length})` : '';
  const box = $('library');
  box.replaceChildren();
  if (!library.length) {
    box.innerHTML = '<p class="hint">No saved stories yet. Press 💾 Save story while reading to keep one here.</p>';
    return;
  }
  for (const s of library) {
    const item = document.createElement('div');
    item.className = 'saved';
    const info = document.createElement('div');
    info.className = 'saved-info';
    const title = document.createElement('b');
    title.textContent = s.title;
    const meta = document.createElement('span');
    meta.className = 'hint small';
    const words = s.practiceWords.length ? ` · words: ${s.practiceWords.slice(0, 6).join(', ')}` : '';
    meta.textContent = `${getLevel(s.levelId).label} · saved ${new Date(s.savedAt).toLocaleDateString()}${words}`;
    const preview = document.createElement('span');
    preview.className = 'saved-preview';
    preview.textContent = s.text.length > 110 ? `${s.text.slice(0, 110).trimEnd()}…` : s.text;
    info.append(title, meta, preview);

    const actions = document.createElement('div');
    actions.className = 'saved-actions';
    const read = document.createElement('button');
    read.className = 'primary';
    read.textContent = 'Read';
    read.onclick = () => loadStory(toStory(s));
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = '🗑';
    del.title = `Delete “${s.title}”`;
    del.onclick = () => {
      if (!confirm(`Delete “${s.title}” from My stories?`)) return;
      library = removeStory(library, s.id);
      save('library', library);
      renderLibrary();
      if (current) updateSaveButton();
    };
    actions.append(read, del);
    item.append(info, actions);
    box.append(item);
  }
}

// ---------- misc UI ----------
let toastTimer = 0;
function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.add('hidden'), 4500);
}

async function busy(btn: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
  btn.disabled = true;
  btn.classList.add('spinner');
  try {
    await fn();
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinner');
  }
}

function readToMe(): void {
  if (!current) return;
  if (!ttsSupported()) return toast('This browser cannot read aloud.');
  if (listener.listening) listener.stop();
  const { offsets } = current.tokens;
  const btn = $('readToMe');
  btn.textContent = '⏹ Stop reading';
  const clear = () => wordEls.forEach((el) => el.classList.remove('speaking'));
  speak(current.story.text, {
    rate: level.ttsRate,
    lang,
    onWord: (charIndex) => {
      clear();
      let i = offsets.findIndex((o) => o > charIndex) - 1;
      if (i < 0) i = charIndex >= offsets[offsets.length - 1] ? offsets.length - 1 : 0;
      wordEls[i]?.classList.add('speaking');
    },
    onEnd: () => {
      clear();
      btn.textContent = '🔊 Read to me';
    },
  });
}

// ---------- wiring ----------
function init(): void {
  const levelSel = $<HTMLSelectElement>('level');
  for (const l of LEVELS) levelSel.add(new Option(`${l.label} · ${l.grade}`, l.id));
  levelSel.value = level.id;
  levelSel.onchange = () => {
    level = getLevel(levelSel.value);
    save('level', level.id);
    $('storyText').style.fontSize = `${level.fontSize}px`;
  };

  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document
        .querySelectorAll<HTMLElement>('.tabpanel')
        .forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
    };
  });

  $('usePasted').onclick = () => {
    const text = $<HTMLTextAreaElement>('pasteText').value.trim();
    if (!text) return toast('Paste some text first.');
    const firstLine = text.split('\n')[0].slice(0, 60);
    loadStory({ title: firstLine.length < 60 ? firstLine : 'My Text', text, usedWords: wordsInText(text, practiceWords), source: 'library' });
  };

  $('simplifyPasted').onclick = (e) =>
    busy(e.currentTarget as HTMLButtonElement, async () => {
      const text = $<HTMLTextAreaElement>('pasteText').value.trim();
      if (!text) throw new Error('Paste some text first.');
      loadStory(await simplifyText({ apiKey, level, text }));
    });

  $('makeStory').onclick = (e) =>
    busy(e.currentTarget as HTMLButtonElement, async () => {
      const topic = $<HTMLInputElement>('topic').value.trim();
      const childName = $<HTMLInputElement>('childName').value.trim();
      const story = apiKey
        ? await generateStory({ apiKey, level, practiceWords, topic, childName })
        : libraryStory(level, practiceWords);
      loadStory(story);
      const missing = practiceWords.filter((w) => !story.usedWords.includes(w));
      if (practiceWords.length && missing.length && story.source === 'library') {
        toast(`This built-in story doesn't include: ${missing.join(', ')}. Add an API key for custom stories.`);
      }
    });

  $('drill').onclick = () => loadStory(practiceWordsDrill(practiceWords));

  const addFromInput = () => {
    const input = $<HTMLInputElement>('wordInput');
    addPracticeWords(input.value.split(/[\s,;]+/));
    input.value = '';
  };
  $('addWords').onclick = addFromInput;
  $<HTMLInputElement>('wordInput').onkeydown = (e) => {
    if (e.key === 'Enter') addFromInput();
  };
  const listSel = $<HTMLSelectElement>('wordListSelect');
  for (const name of Object.keys(WORD_LISTS)) listSel.add(new Option(name, name));
  $('loadList').onclick = () => addPracticeWords(sampleWords(WORD_LISTS[listSel.value], 8));
  $('clearWords').onclick = () => {
    practiceWords = [];
    save('practiceWords', practiceWords);
    renderChips();
  };

  $('micBtn').onclick = () => {
    if (listener.listening) return listener.stop();
    if (!recognitionSupported()) return toast('Speech recognition needs Chrome, Edge or Safari.');
    stopSpeaking();
    if (current && committed.cursor >= current.tokens.words.length) resetReading();
    $('results').classList.add('hidden');
    listener.start();
    render();
  };
  $('readToMe').onclick = () => {
    if ($('readToMe').textContent?.startsWith('⏹')) {
      stopSpeaking();
      return;
    }
    readToMe();
  };
  $('skipBtn').onclick = () => {
    committed = skipWord(committed);
    shown = committed;
    progressed();
  };
  $('restartBtn').onclick = () => {
    if (listener.listening) listener.stop();
    resetReading();
    render();
  };
  $('saveStory').onclick = saveCurrentStory;
  $('newText').onclick = () => {
    if (listener.listening) listener.stop();
    stopSpeaking();
    $('reader').classList.add('hidden');
    $('results').classList.add('hidden');
    $('setup').classList.remove('hidden');
  };
  $('storyText').onclick = (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.w');
    if (el) speak(el.textContent ?? '', { rate: level.ttsRate * 0.85, lang });
  };

  // Settings dialog
  const dialog = $<HTMLDialogElement>('settings');
  const keyInput = $<HTMLInputElement>('apiKey');
  const langSel = $<HTMLSelectElement>('lang');
  const dys = $<HTMLInputElement>('dyslexiaFont');
  dys.checked = load('dyslexia', false);
  document.body.classList.toggle('dyslexia', dys.checked);
  $('openSettings').onclick = () => {
    keyInput.value = apiKey;
    langSel.value = lang;
    dialog.showModal();
  };
  dialog.onclose = () => {
    apiKey = keyInput.value.trim();
    save('apiKey', apiKey);
    if (langSel.value !== lang) {
      lang = langSel.value;
      save('lang', lang);
      toast('Language saved. Reload the page to listen in the new language.');
    }
    save('dyslexia', dys.checked);
    document.body.classList.toggle('dyslexia', dys.checked);
    updateModeHints();
  };

  if (!recognitionSupported()) {
    toast('Heads up: this browser cannot listen. Use Chrome, Edge or Safari for read-along.');
  }

  renderChips();
  updateModeHints();
  renderHistory();
  renderLibrary();
}

init();
