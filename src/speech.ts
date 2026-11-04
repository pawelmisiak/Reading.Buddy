/**
 * Thin wrappers around the browser's Web Speech API:
 *  - SpeechRecognition to listen to the child reading
 *  - speechSynthesis to read words and stories aloud
 *
 * Everything that happens is written to the troubleshooting log (debugLog.ts).
 */
import { error as logError, info, warn } from './debugLog.ts';

// The Web Speech recognition API is not in TypeScript's DOM lib everywhere, so
// we declare the small part we use.
interface RecognitionAlternative {
  transcript: string;
  confidence?: number;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function recognitionSupported(): boolean {
  return getRecognitionCtor() !== undefined;
}

/** Which recognizer this browser offers (for the troubleshooting log). */
export function recognitionImpl(): string {
  const w = window as unknown as Record<string, unknown>;
  if (w.SpeechRecognition) return 'SpeechRecognition';
  if (w.webkitSpeechRecognition) return 'webkitSpeechRecognition';
  return 'none';
}

/** Turn a SpeechRecognition error code into a message a parent can act on. */
export function explainRecognitionError(code: string): string {
  switch (code) {
    case 'not-allowed':
      return window.isSecureContext
        ? 'The microphone is blocked. Allow it for this page (the icon at the left of the address bar). On a Mac, also check System Settings → Privacy & Security → Microphone and turn it on for your browser.'
        : 'The microphone only works on https:// pages. Start the app with npm run dev:lan and open the https:// address it prints.';
    case 'service-not-allowed':
      return 'The browser refused to start speech recognition. In Safari, turn on Siri / Dictation (Mac: System Settings → Keyboard → Dictation; iPad: Settings → General → Keyboard → Enable Dictation). In Chrome, check that the microphone is allowed for this site.';
    case 'network':
      return "The browser's online speech service couldn't be reached. Check the internet connection. Brave, Arc, Opera, Vivaldi and plain Chromium often don't include this service, so use Google Chrome, Microsoft Edge or Safari.";
    case 'audio-capture':
      return 'No microphone was found, or another app (Zoom, FaceTime…) is using it. Plug in or free up the microphone and try again.';
    case 'language-not-supported':
      return "This browser can't listen in the chosen language. Pick another one in ⚙️ Settings.";
    case 'bad-grammar':
      return 'The browser rejected the speech settings (bad-grammar). Please copy the troubleshooting log from ⚙️ Settings.';
    default:
      return `Speech recognition error: ${code}. Open ⚙️ Settings → Troubleshooting for details.`;
  }
}

export interface ListenerCallbacks {
  /** Text heard since the last final result; may still change. */
  onInterim(transcript: string): void;
  /** Text that the recognizer has settled on. */
  onFinal(transcript: string): void;
  onError(message: string): void;
  onStateChange(listening: boolean): void;
}

/** Restarts allowed in a row when sessions end at once without hearing anything. */
const MAX_QUICK_RESTARTS = 4;
const QUICK_SESSION_MS = 1500;

/**
 * Keeps listening until stop() is called. Browsers end recognition sessions on
 * their own after silence, so we restart transparently while active.
 */
export class Listener {
  private rec: Recognition | null = null;
  private active = false;
  private session = 0;
  private sessionStartedAt = 0;
  private gotResultThisSession = false;
  private quickRestarts = 0;
  private lastError = '';

  constructor(
    private readonly cb: ListenerCallbacks,
    private readonly lang = 'en-US',
  ) {}

  get listening(): boolean {
    return this.active;
  }

  start(): void {
    const Ctor = getRecognitionCtor();
    info('speech', 'Start listening requested', {
      impl: recognitionImpl(),
      lang: this.lang,
      secureContext: window.isSecureContext,
      origin: location.origin,
    });
    if (!Ctor) {
      logError('speech', 'No SpeechRecognition in this browser', { userAgent: navigator.userAgent });
      this.cb.onError('Speech recognition is not supported in this browser. Try Chrome, Edge or Safari.');
      return;
    }
    if (!window.isSecureContext) {
      logError('speech', 'Page is not a secure context; the microphone will be blocked', { origin: location.origin });
      this.cb.onError(explainRecognitionError('not-allowed'));
      return;
    }
    this.active = true;
    this.quickRestarts = 0;
    this.lastError = '';
    this.cb.onStateChange(true);
    this.spawn(Ctor);
  }

  stop(): void {
    if (this.active) info('speech', 'Stop listening');
    this.active = false;
    const rec = this.rec;
    this.rec = null;
    try {
      rec?.stop();
    } catch (err) {
      warn('speech', 'rec.stop() threw', err);
    }
    this.cb.onStateChange(false);
  }

  private fail(message: string): void {
    this.cb.onError(message);
    this.stop();
  }

  private spawn(Ctor: RecognitionCtor): void {
    const session = ++this.session;
    const tag = `session ${session}`;
    let rec: Recognition;
    try {
      rec = new Ctor();
    } catch (err) {
      logError('speech', `${tag}: could not create recognizer`, err);
      return this.fail(`Could not start listening: ${String(err)}`);
    }
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    // Lifecycle events: only logged, they help explain "nothing happens".
    for (const name of ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend']) {
      rec.addEventListener(name, () => info('speech', `${tag}: ${name}`));
    }
    rec.addEventListener('nomatch', () => warn('speech', `${tag}: nomatch (heard sound but no words)`));

    rec.onresult = (e) => {
      this.gotResultThisSession = true;
      this.quickRestarts = 0;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          info('speech', `${tag}: final`, { transcript: r[0].transcript, confidence: r[0].confidence });
          this.cb.onFinal(r[0].transcript);
        } else interim += r[0].transcript + ' ';
      }
      this.cb.onInterim(interim.trim());
    };

    rec.onerror = (e) => {
      this.lastError = e.error;
      const details = { error: e.error, message: e.message || undefined };
      if (e.error === 'no-speech' || e.error === 'aborted') {
        info('speech', `${tag}: ${e.error} (normal, will restart)`, details);
        return;
      }
      logError('speech', `${tag}: recognition error`, details);
      this.fail(explainRecognitionError(e.error));
    };

    rec.onend = () => {
      const ms = Date.now() - this.sessionStartedAt;
      info('speech', `${tag}: end`, { afterMs: ms, gotResult: this.gotResultThisSession, stillActive: this.active });
      if (!this.active || this.rec !== rec) return;
      // A session that ends at once without hearing anything, over and over,
      // means the browser can't really listen. Stop instead of looping.
      if (!this.gotResultThisSession && ms < QUICK_SESSION_MS) {
        this.quickRestarts++;
        if (this.quickRestarts >= MAX_QUICK_RESTARTS) {
          logError('speech', 'Recognition keeps ending right after it starts', {
            restarts: this.quickRestarts,
            lastError: this.lastError || null,
          });
          return this.fail(
            this.lastError
              ? explainRecognitionError(this.lastError)
              : 'Listening keeps stopping by itself. Check that the microphone works and is allowed, then open ⚙️ Settings → Troubleshooting → Test microphone.',
          );
        }
      }
      this.spawn(Ctor);
    };

    this.rec = rec;
    this.gotResultThisSession = false;
    this.sessionStartedAt = Date.now();
    try {
      rec.start();
      info('speech', `${tag}: rec.start() called`);
    } catch (err) {
      logError('speech', `${tag}: rec.start() threw`, err);
      this.fail(`Could not start listening: ${String(err)}`);
    }
  }
}

/** Ask for the microphone directly; gives clearer reasons than SpeechRecognition does. */
export async function probeMicrophone(): Promise<{ ok: boolean; detail: string }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, detail: 'navigator.mediaDevices.getUserMedia is missing (page not https:// or very old browser).' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tracks = stream.getAudioTracks();
    const label = tracks[0]?.label || 'unknown microphone';
    const state = tracks[0]?.readyState;
    tracks.forEach((t) => t.stop());
    return { ok: true, detail: `Microphone opened: "${label}" (${state}).` };
  } catch (err) {
    const name = (err as DOMException)?.name ?? 'Error';
    const reasons: Record<string, string> = {
      NotAllowedError: 'Permission denied by the user, the browser, or the operating system.',
      NotFoundError: 'No microphone found.',
      NotReadableError: 'The microphone exists but could not be opened (another app may be using it).',
      SecurityError: 'Blocked for security reasons (page not https://?).',
      AbortError: 'The browser aborted opening the microphone.',
    };
    return { ok: false, detail: `${name}: ${reasons[name] ?? (err as Error).message}` };
  }
}

/**
 * Listen for a few seconds and report what the recognizer did. Used by the
 * "Test microphone" button.
 */
export function testRecognition(lang: string, seconds = 6): Promise<string[]> {
  return new Promise((resolve) => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return resolve(['No SpeechRecognition in this browser.']);
    const events: string[] = [];
    const t0 = Date.now();
    const note = (s: string) => {
      const line = `+${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`;
      events.push(line);
      info('speech-test', line);
    };
    let rec: Recognition;
    try {
      rec = new Ctor();
    } catch (err) {
      return resolve([`Could not create recognizer: ${String(err)}`]);
    }
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    for (const name of ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'nomatch']) {
      rec.addEventListener(name, () => note(name));
    }
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1];
      note(`${r.isFinal ? 'final' : 'interim'} result: "${r[0].transcript}"`);
    };
    rec.onerror = (e) => note(`ERROR: ${e.error}${e.message ? ` (${e.message})` : ''}`);
    let done = false;
    rec.onend = () => {
      note('end');
      if (!done) {
        done = true;
        resolve(events);
      }
    };
    try {
      rec.start();
      note('rec.start() called');
    } catch (err) {
      note(`rec.start() threw: ${String(err)}`);
      return resolve(events);
    }
    setTimeout(() => {
      try {
        rec.stop();
      } catch {
        /* already ended */
      }
      setTimeout(() => {
        if (!done) {
          done = true;
          note('no end event after stop()');
          resolve(events);
        }
      }, 2000);
    }, seconds * 1000);
  });
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(lang.slice(0, 2)));
  return voices.find((v) => /natural|neural|samantha|google/i.test(v.name)) ?? voices[0];
}

export function ttsSupported(): boolean {
  return 'speechSynthesis' in window;
}

export function stopSpeaking(): void {
  if (ttsSupported()) speechSynthesis.cancel();
}

/**
 * Speak text aloud. `onWord` receives the character offset of each word as it
 * is spoken (where the browser supports boundary events).
 */
export function speak(
  text: string,
  opts: { rate?: number; lang?: string; onWord?: (charIndex: number) => void; onEnd?: () => void } = {},
): void {
  if (!ttsSupported()) {
    warn('tts', 'speechSynthesis not available');
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = opts.lang ?? 'en-US';
  u.rate = opts.rate ?? 0.9;
  const voice = pickVoice(u.lang);
  if (voice) u.voice = voice;
  u.onboundary = (e) => {
    if (e.name === 'word' || e.name === undefined) opts.onWord?.(e.charIndex);
  };
  u.onend = () => opts.onEnd?.();
  u.onerror = (e) => {
    if (e.error !== 'interrupted' && e.error !== 'canceled') warn('tts', 'Speech synthesis error', { error: e.error });
    opts.onEnd?.();
  };
  speechSynthesis.speak(u);
}
