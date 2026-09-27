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
import { zhHk } from './zh-hk';
import { zhTw } from './zh-tw';

export type Lang = 'en' | 'es' | 'fr' | 'tr' | 'zh' | 'zh-hk' | 'zh-tw';
/** User choice: 'system' follows the OS language live (first visit uses it). */
export type LangChoice = 'system' | Lang;

const DICTS: Record<Lang, Record<MessageKey, string>> = {
  en, es, fr, tr, zh, 'zh-hk': zhHk, 'zh-tw': zhTw,
};

/**
 * Language registry (report §7.2 v1.20): one row per language, holding the name
 * it is sorted by and the name it is displayed by. `Record<Lang, …>` makes
 * adding a code to `Lang` without adding a row a compile error.
 *
 * `englishName` is the **sort key**, and it is ASCII on purpose: the order then
 * comes out of a plain string comparison instead of `Intl.Collator`, whose
 * treatment of the two CJK labels differs between V8 and WebKit — precisely the
 * dev-server-vs-desktop-shell drift the GHPaths v1.31 sync warned about.
 * `endonym` is what the picker shows: a language is named in its own language,
 * because a user who cannot read the UI cannot read an English exonym either.
 *
 * Traditional Chinese is two rows (v1.23, user directive): the regions are
 * named in the label because the dictionaries differ by region, and the labels
 * follow the naming the user asked for. Macau has no row of its own — it reads
 * the Hong Kong one (`langFromTags`), per v1.22's 区域就近回退.
 */
const LANG_META: Record<Lang, { englishName: string; endonym: string }> = {
  zh: { englishName: 'Chinese (Simplified)', endonym: '简体中文' },
  'zh-hk': { englishName: 'Chinese (Traditional, Hong Kong)', endonym: '繁體中文（中國香港）' },
  'zh-tw': { englishName: 'Chinese (Traditional, Taiwan)', endonym: '繁體中文（中國台灣）' },
  en: { englishName: 'English', endonym: 'English' },
  fr: { englishName: 'French', endonym: 'Français' },
  es: { englishName: 'Spanish', endonym: 'Español' },
  tr: { englishName: 'Turkish', endonym: 'Türkçe' },
};
const STORAGE_KEY = 'ghpb.lang';
const LANG_CODES = Object.keys(LANG_META) as Lang[];

/**
 * Picker order: 'Follow system' pinned first — it is a mode, not a language,
 * and it stays where the user learned it — then the registry sorted by its
 * English key, which is stable across engines, builds and whichever UI
 * language is active (a list that rearranges itself after a language switch
 * cannot be clicked from memory). One consequence is worth stating: Chinese
 * sorts first, so the three CJK rows head the list — the group our main
 * audience reaches for — with the Latin names in their own alphabetical order
 * behind them. Result in all seven UI languages:
 * 简体中文 · 繁體中文（中國香港） · 繁體中文（中國台灣） · English · Français ·
 * Español · Türkçe.
 */
export const LANGUAGES: readonly LangChoice[] = [
  'system',
  ...[...LANG_CODES].sort((a, b) => {
    const ka = LANG_META[a].englishName;
    const kb = LANG_META[b].englishName;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }),
];

/**
 * Browser tags → app language, first tag that matches any supported language
 * wins (that is what `navigator.languages` means: most preferred first). The
 * explicit `en` branch matters as much as the `zh` precedence: without it a
 * `['en-US', 'zh-CN']` list fell through English and opened in Chinese.
 *
 * Inside Chinese, Hans beats Hant only after the region check, and the region
 * decides *which* Traditional dictionary: HK and MO share one, TW and a bare
 * `zh-Hant` (no region — the largest user group) get the Taiwan one.
 */
export function langFromTags(tags: readonly string[]): Lang {
  for (const l of tags) {
    if (/^zh-(hant-(hk|mo)|hk|mo)/i.test(l)) return 'zh-hk';
    if (/^zh-(hant(-tw)?|tw)/i.test(l)) return 'zh-tw';
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

/** The name a language is listed under: its own, never an English exonym. */
export const langLabel = (l: Lang): string => LANG_META[l].endonym;
