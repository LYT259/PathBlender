/**
 * Minimal i18n: dictionary lookup with {placeholder} interpolation,
 * localStorage preference, browser-language default (ADR-0002).
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { zh } from './zh';
import { zhTw } from './zh-tw';

export type Lang = 'en' | 'zh' | 'zh-tw';

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, zh, 'zh-tw': zhTw };
const LANG_LABEL: Record<Lang, string> = { en: 'English', zh: '简体中文', 'zh-tw': '繁體中文' };
const STORAGE_KEY = 'ghpb.lang';

export type TFunc = (key: MessageKey, vars?: Record<string, string | number>) => string;

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m,
  );
}

function detectLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'en' || saved === 'zh' || saved === 'zh-tw') return saved;
  const langs = navigator.languages ?? [navigator.language];
  for (const l of langs) {
    if (/^zh-(tw|hant|hk|mo)/i.test(l)) return 'zh-tw';
    if (/^zh/i.test(l)) return 'zh';
  }
  return 'en';
}

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang: (l) => {
        localStorage.setItem(STORAGE_KEY, l);
        setLangState(l);
      },
      t: (key, vars) => interpolate((DICTS[lang] ?? en)[key] ?? en[key], vars),
    }),
    [lang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

export const LANGUAGES = Object.keys(LANG_LABEL) as Lang[];
export const langLabel = (l: Lang): string => LANG_LABEL[l];
