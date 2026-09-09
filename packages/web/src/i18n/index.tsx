/**
 * Minimal i18n: dictionary lookup with {placeholder} interpolation,
 * localStorage preference, browser-language default (ADR-0002).
 */

import { createContext, useContext, useMemo, useState, type ReactNode , useEffect} from 'react';
import { broadcastPref, listenPrefs } from '../pref-sync';
import { en, type MessageKey } from './en';
import { zh } from './zh';
import { zhTw } from './zh-tw';

export type Lang = 'en' | 'zh' | 'zh-tw';
/** User choice: 'system' follows the OS language live (first visit uses it). */
export type LangChoice = 'system' | Lang;

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, zh, 'zh-tw': zhTw };
const LANG_LABEL: Record<LangChoice, string> = {
  system: '跟随系统 / Follow system',
  en: 'English',
  zh: '简体中文',
  'zh-tw': '繁體中文',
};
const STORAGE_KEY = 'ghpb.lang';

function systemLang(): Lang {
  const langs = navigator.languages ?? [navigator.language];
  for (const l of langs) {
    if (/^zh-(tw|hant|hk|mo)/i.test(l)) return 'zh-tw';
    if (/^zh/i.test(l)) return 'zh';
  }
  return 'en';
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
  return saved === 'en' || saved === 'zh' || saved === 'zh-tw' || saved === 'system'
    ? saved
    : 'system';
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

export const LANGUAGES = ['system', 'en', 'zh', 'zh-tw'] as const satisfies LangChoice[];
export const langLabel = (l: LangChoice): string => LANG_LABEL[l];
