import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const LANGUAGES = [
  { code: 'en', name: 'English', speech: 'en-IN' },
  { code: 'ta', name: 'தமிழ்', speech: 'ta-IN' },
  { code: 'hi', name: 'हिन्दी', speech: 'hi-IN' },
  { code: 'te', name: 'తెలుగు', speech: 'te-IN' },
  { code: 'ml', name: 'മലയാളം', speech: 'ml-IN' },
  { code: 'kn', name: 'ಕನ್ನಡ', speech: 'kn-IN' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];

export interface LocaleFile {
  strings: Record<string, string>;
  voiceIntents: Record<string, string[]>;
}

// Each locale is a separate lazily-loaded chunk: users only download their own language.
const loaders = import.meta.glob<LocaleFile>('./locales/*.json', { import: 'default' });
const cache = new Map<string, LocaleFile>();
async function load(lang: string): Promise<LocaleFile> {
  const hit = cache.get(lang);
  if (hit) return hit;
  const loader = loaders[`./locales/${lang}.json`] ?? loaders['./locales/en.json'];
  const data = await loader();
  cache.set(lang, data);
  return data;
}

interface I18nState {
  lang: Lang;
  ready: boolean;
  setLang(l: Lang): void;
  t(key: string, params?: Record<string, string | number>): string;
  voiceIntents: Record<string, string[]>;
  speechLocale: string;
  formatDateTime(d: string | Date): string;
  formatDate(d: string | Date): string;
  formatTime(d: string | Date): string;
}

const Ctx = createContext<I18nState | null>(null);
const STORAGE_KEY = 'rhc_lang'; // non-sensitive UI preference only

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved as Lang;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [en, setEn] = useState<LocaleFile | null>(null);
  const [current, setCurrent] = useState<LocaleFile | null>(null);

  useEffect(() => {
    void load('en').then(setEn);
  }, []);
  useEffect(() => {
    let alive = true;
    void load(lang).then((d) => alive && setCurrent(d));
    document.documentElement.lang = lang;
    return () => {
      alive = false;
    };
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18nState>(() => {
    const locale = `${lang}-IN`;
    const fmt = (o: Intl.DateTimeFormatOptions) => (d: string | Date) =>
      new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kolkata', ...o }).format(new Date(d));
    return {
      lang,
      ready: Boolean(current && en),
      setLang,
      t(key, params) {
        let s = current?.strings[key] ?? en?.strings[key] ?? key;
        if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
        return s;
      },
      // English phrases are always merged in: many users mix English words into speech.
      voiceIntents: mergeIntents(current?.voiceIntents, lang === 'en' ? undefined : en?.voiceIntents),
      speechLocale: LANGUAGES.find((l) => l.code === lang)!.speech,
      formatDateTime: fmt({ dateStyle: 'medium', timeStyle: 'short' }),
      formatDate: fmt({ weekday: 'short', day: 'numeric', month: 'short' }),
      formatTime: fmt({ hour: 'numeric', minute: '2-digit' }),
    };
  }, [lang, current, en, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function mergeIntents(a?: Record<string, string[]>, b?: Record<string, string[]>) {
  const out: Record<string, string[]> = {};
  for (const src of [a, b]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) out[k] = [...(out[k] ?? []), ...v];
  }
  return out;
}

export function useI18n(): I18nState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
