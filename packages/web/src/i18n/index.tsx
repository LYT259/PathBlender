/**
 * Minimal i18n: dictionary lookup with {placeholder} interpolation,
 * localStorage preference, browser-language default (ADR-0002).
 */

import { createContext, useContext, useMemo, useState, type ReactNode , useEffect} from 'react';
import { broadcastPref, listenPrefs } from '../pref-sync';
import { en, type MessageKey } from './en';
import { es } from './es';
import { fr } from './fr';
import { tr } from './tr';
import { zh } from './zh';
import { zhTw } from './zh-tw';

export type Lang = 'en' | 'es' | 'fr' | 'tr' | 'zh' | 'zh-tw';
/** User choice: 'system' follows the OS language live (first visit uses it). */
export type LangChoice = 'system' | Lang;

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, es, fr, tr, zh, 'zh-tw': zhTw };

/**
 * Endonyms — each language in its own alphabet and wording, which is what the
 * language pickers show. 'system' is absent on purpose: it is a mode, not a
 * language, and both pickers label it through `prefs.langSystem` so it reads
 * like the rest of the surrounding UI.
 */
const LANG_LABEL: Record<Lang, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  tr: 'Türkçe',
  zh: '简体中文',
  'zh-tw': '繁體中文',
};
const STORAGE_KEY = 'ghpb.lang';
const LANG_CODES = Object.keys(LANG_LABEL) as Lang[];

/**
 * Picker order (report §7.2 asked for alphabetical): 'Follow system' pinned
 * first — it is a mode, and it stays where the user learned it — then the
 * endonyms compared with a collator **pinned to English**. Pinning is the
 * point: a collator that followed the UI locale would reshuffle the list under
 * the user's cursor every time they switched language (a `zh` collator sorts
 * 简体中文/繁體中文 by pinyin and pulls them in front of the Latin names), and
 * nobody can hit the same row twice in a row that way. Sorting the label the
 * user sees, instead of an English exonym table, means one rule that still
 * holds when P2 adds Português or עברית. Result in all six UI languages:
 * English · Español · Français · Türkçe · 简体中文 · 繁體中文.
 */
const ENDONYM_ORDER = new Intl.Collator('en', { sensitivity: 'base' });
export const LANGUAGES: readonly LangChoice[] = [
  'system',
  ...[...LANG_CODES].sort((a, b) => ENDONYM_ORDER.compare(LANG_LABEL[a], LANG_LABEL[b])),
];

/**
 * Browser tags → app language, first tag that matches any supported language
 * wins (that is what `navigator.languages` means: most preferred first). The
 * explicit `en` branch matters as much as the `zh` precedence: without it a
 * `['en-US', 'zh-CN']` list fell through English and opened in Chinese.
 */
export function langFromTags(tags: readonly string[]): Lang {
  for (const l of tags) {
    if (/^zh-(tw|hant|hk|mo)/i.test(l)) return 'zh-tw';
    if (/^zh/i.test(l)) return 'zh';
    if (/^es/i.test(l)) return 'es';
    if (/^fr/i.test(l)) return 'fr';
    if (/^tr/i.test(l)) return 'tr';
    if (/^en/i.test(l)) return 'en';
  }
  return 'en';
}

function systemLang(): Lang {
  return langFromTags(navigator.languages ?? [navigator.language]);
}

export type TFunc = (key: MessageKey, vars?: Record<string, string | number>) => string;

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m,
  );
}

/** Persisted choice (defaults to 'system' on first visit). */
function savedChoice(): LangChoice {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === null || saved === 'system') return 'system';
  // Checked against the dictionary table, not a literal chain: the chain had
  // to be edited for every language added and silently reset an unknown-but-
  // valid choice (es/fr/tr saved in one window read back as 'system' in the
  // desktop prefs window). `includes` rather than `in` so inherited keys
  // ('toString') cannot masquerade as a language code.
  return (LANG_CODES as string[]).includes(saved) ? (saved as Lang) : 'system';
}

interface I18nContextValue {
  /** The resolved display language (never 'system'). */
  lang: Lang;
  /** The user's persisted choice ('system' when following the OS). */
  langChoice: LangChoice;
  setLang: (l: LangChoice) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<LangChoice>(savedChoice);
  const lang: Lang = choice === 'system' ? systemLang() : choice;
  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      langChoice: choice,
      setLang: (l) => {
        localStorage.setItem(STORAGE_KEY, l);
        setChoiceState(l);
        // Other windows (desktop prefs) apply instantly.
        broadcastPref('lang', l);
      },
      t: (key, vars) => interpolate((DICTS[lang] ?? en)[key] ?? en[key], vars),
    }),
    [lang, choice],
  );
  // Apply preferences changed in another window (no re-broadcast — the
  // same-value echo terminates the loop).
  useEffect(
    () =>
      listenPrefs((key, v) => {
        if (key === 'lang') {
          localStorage.setItem(STORAGE_KEY, v);
          setChoiceState(v as LangChoice);
        }
      }),
    [],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

export const langLabel = (l: Lang): string => LANG_LABEL[l];
