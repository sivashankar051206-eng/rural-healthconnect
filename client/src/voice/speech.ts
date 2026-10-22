/**
 * Thin wrappers around the browser Web Speech API (speech-to-text + text-to-speech).
 * Voice is an OPTIONAL accessibility layer: every function degrades gracefully.
 * Recognition audio is processed by the browser's speech service; no audio is sent to our backend.
 */
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

function ctor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const recognitionSupported = (): boolean => typeof window !== 'undefined' && Boolean(ctor());
export const synthesisSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

export type ListenError = 'denied' | 'no-speech' | 'unsupported' | 'network' | 'aborted' | 'error';

let active: RecognitionLike | null = null;

/** Listens once and resolves with the best transcript alternatives. */
export function listenOnce(locale: string, timeoutMs = 8000): Promise<string[]> {
  const C = ctor();
  if (!C) return Promise.reject<string[]>('unsupported' satisfies ListenError);
  stopListening();
  return new Promise((resolve, reject) => {
    const r = new C();
    active = r;
    r.lang = locale;
    r.interimResults = false;
    r.maxAlternatives = 3;
    r.continuous = false;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      active = null;
      fn();
    };
    const timer = setTimeout(() => {
      r.abort();
      finish(() => reject('no-speech' satisfies ListenError));
    }, timeoutMs);
    r.onresult = (e) => {
      const alts: string[] = [];
      const first = e.results[0];
      for (let i = 0; i < first.length; i += 1) alts.push(first[i].transcript);
      finish(() => resolve(alts));
    };
    r.onerror = (e) => {
      const map: Record<string, ListenError> = {
        'not-allowed': 'denied',
        'service-not-allowed': 'denied',
        'no-speech': 'no-speech',
        network: 'network',
        aborted: 'aborted',
      };
      finish(() => reject(map[e.error] ?? 'error'));
    };
    r.onend = () => finish(() => reject('no-speech' satisfies ListenError));
    try {
      r.start();
    } catch {
      finish(() => reject('error' satisfies ListenError));
    }
  });
}

export function stopListening() {
  try {
    active?.abort();
  } catch {
    /* ignore */
  }
  active = null;
}

/** Speaks text in the chosen language; picks a matching installed voice when available. */
export function speak(text: string, locale: string): Promise<void> {
  if (!synthesisSupported()) return Promise.resolve();
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale;
    u.rate = 0.9; // slightly slower for clarity
    const base = locale.split('-')[0];
    const voice = synth.getVoices().find((v) => v.lang === locale) ?? synth.getVoices().find((v) => v.lang.startsWith(base));
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}

export function stopSpeaking() {
  if (synthesisSupported()) window.speechSynthesis.cancel();
}
