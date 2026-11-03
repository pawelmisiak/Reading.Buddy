/**
 * Thin wrappers around the browser's Web Speech API:
 *  - SpeechRecognition to listen to the child reading
 *  - speechSynthesis to read words and stories aloud
 */

// The Web Speech recognition API is not in TypeScript's DOM lib everywhere, so
// we declare the small part we use.
interface RecognitionAlternative {
  transcript: string;
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

export interface ListenerCallbacks {
  /** Text heard since the last final result; may still change. */
  onInterim(transcript: string): void;
  /** Text that the recognizer has settled on. */
  onFinal(transcript: string): void;
  onError(message: string): void;
  onStateChange(listening: boolean): void;
}

/**
 * Keeps listening until stop() is called. Browsers end recognition sessions on
 * their own after silence, so we restart transparently while active.
 */
export class Listener {
  private rec: Recognition | null = null;
  private active = false;

  constructor(
    private readonly cb: ListenerCallbacks,
    private readonly lang = 'en-US',
  ) {}

  get listening(): boolean {
    return this.active;
  }

  start(): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      this.cb.onError('Speech recognition is not supported in this browser. Try Chrome, Edge or Safari.');
      return;
    }
    this.active = true;
    this.cb.onStateChange(true);
    this.spawn(Ctor);
  }

  stop(): void {
    this.active = false;
    this.rec?.stop();
    this.rec = null;
    this.cb.onStateChange(false);
  }

  private spawn(Ctor: RecognitionCtor): void {
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.cb.onFinal(r[0].transcript);
        else interim += r[0].transcript + ' ';
      }
      this.cb.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // harmless; we restart
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.cb.onError('Microphone access was blocked. Allow the microphone for this page and try again.');
      } else {
        this.cb.onError(`Speech recognition error: ${e.error}`);
      }
      this.stop();
    };
    rec.onend = () => {
      if (this.active && this.rec === rec) this.spawn(Ctor);
    };

    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      this.cb.onError(`Could not start listening: ${String(err)}`);
      this.stop();
    }
  }
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
  if (!ttsSupported()) return;
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
  u.onerror = () => opts.onEnd?.();
  speechSynthesis.speak(u);
}
