/**
 * Minimal i18n: dictionary lookup with {placeholder} interpolation,
 * localStorage preference, browser-language default (ADR-0002).
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { broadcastPref, listenPrefs } from '../pref-sync';
import { formatDecimal } from '../number-format';
import { en, type MessageKey } from './en';
import { ar } from './ar';
import { az } from './az';
import { bg } from './bg';
import { bs } from './bs';
import { cs } from './cs';
import { da } from './da';
import { de } from './de';
import { el } from './el';
import { es } from './es';
import { fil } from './fil';
import { fr } from './fr';
import { he } from './he';
import { hi } from './hi';
import { hr } from './hr';
import { hu } from './hu';
import { hy } from './hy';
import { id } from './id';
import { it } from './it';
import { ja } from './ja';
import { ko } from './ko';
import { mk } from './mk';
import { mr } from './mr';
import { ms } from './ms';
import { nb } from './nb';
import { nl } from './nl';
import { nn } from './nn';
import { pl } from './pl';
import { ptBR } from './pt-br';
import { ro } from './ro';
import { rw } from './rw';
import { sq } from './sq';
import { sr } from './sr';
import { sv } from './sv';
import { ta } from './ta';
import { tr } from './tr';
import { uk } from './uk';
import { vi } from './vi';
import { zh } from './zh';
import { zhHant } from './zh-hant';
import { zhHk } from './zh-hk';
import { zhTw } from './zh-tw';

export type Lang =
  | 'en' | 'ar' | 'az' | 'bg' | 'bs' | 'cs' | 'da' | 'de' | 'el' | 'es'
  | 'fil' | 'fr' | 'he' | 'hi' | 'hr' | 'hu' | 'hy' | 'id' | 'it' | 'ja'
  | 'ko' | 'mk' | 'mr' | 'ms' | 'nb' | 'nl' | 'nn' | 'pl' | 'pt-BR' | 'ro'
  | 'rw' | 'sq' | 'sr' | 'sv' | 'ta' | 'tr' | 'uk' | 'vi'
  | 'zh' | 'zh-hant' | 'zh-hk';
/** User choice: 'system' follows the OS language live (first visit uses it). */
export type LangChoice = 'system' | Lang;

const DICTS: Record<Lang, Record<MessageKey, string>> = {
  en, ar, az, bg, bs, cs, da, de, el, es, fil, fr, he, hi, hr, hu, hy, id, it,
  ja, ko, mk, mr, ms, nb, nl, nn, pl, 'pt-BR': ptBR, ro, rw, sq, sr, sv, ta,
  tr, uk, vi, zh, 'zh-hant': zhHant, 'zh-hk': zhHk,
};

/**
 * Localized demo names from before the 2026-10-03 rename to 00001/00002.
 * Demos autosaved before the rename carry these as robot names and lack the
 * stable `welcome-example-` id; matching them lets a relaunched pre-rename
 * demo still offer its "End example" exit. Data for recognition, not UI copy.
 */
export const legacyExampleNames: ReadonlySet<string> = new Set(
  Object.values(DICTS).flatMap((dict) => [dict['welcome.exampleNameA'], dict['welcome.exampleNameB']]),
);

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
 * Traditional Chinese ships two selectable rows (2026-10-10): the generic
 * zh-hant row — a region-neutral full dictionary (zh-hant.ts), the home for a
 * bare `zh-Hant` or `zh-TW` system tag — and Hong Kong, region-named because
 * the underlying dictionaries differ by region. The zh-tw dictionary itself
 * still ships unselectable (its picker row was withdrawn 2026-10-07 for the
 * public round, fifth batch pending): it is the base the zh-hk override table
 * spreads over (zh-hk.ts), so wording changes made for Taiwan keep reaching
 * Hong Kong readers. Macau reads the Hong Kong row (`langFromTags`), per
 * v1.22's 区域就近回退.
 */
export const LANG_META: Record<Lang, { englishName: string; endonym: string }> = {
  zh: { englishName: 'Chinese (Simplified)', endonym: '简体中文' },
  'zh-hant': { englishName: 'Chinese (Traditional, Generic)', endonym: '繁體中文（通用）' },
  'zh-hk': { englishName: 'Chinese (Traditional, Hong Kong)', endonym: '繁體中文（中國香港）' },
  ar: { englishName: 'Arabic', endonym: 'العربية' },
  az: { englishName: 'Azerbaijani', endonym: 'Azərbaycanca' },
  bg: { englishName: 'Bulgarian', endonym: 'Български' },
  bs: { englishName: 'Bosnian', endonym: 'Bosanski' },
  cs: { englishName: 'Czech', endonym: 'Čeština' },
  da: { englishName: 'Danish', endonym: 'Dansk' },
  nl: { englishName: 'Dutch', endonym: 'Nederlands' },
  en: { englishName: 'English', endonym: 'English' },
  el: { englishName: 'Greek', endonym: 'Ελληνικά' },
  fil: { englishName: 'Filipino', endonym: 'Filipino' },
  fr: { englishName: 'French', endonym: 'Français' },
  de: { englishName: 'German', endonym: 'Deutsch' },
  he: { englishName: 'Hebrew', endonym: 'עברית' },
  hi: { englishName: 'Hindi', endonym: 'हिन्दी' },
  hr: { englishName: 'Croatian', endonym: 'Hrvatski' },
  hu: { englishName: 'Hungarian', endonym: 'Magyar' },
  hy: { englishName: 'Armenian', endonym: 'Հայերեն' },
  id: { englishName: 'Indonesian', endonym: 'Bahasa Indonesia' },
  it: { englishName: 'Italian', endonym: 'Italiano' },
  ja: { englishName: 'Japanese', endonym: '日本語' },
  ko: { englishName: 'Korean', endonym: '한국어' },
  mk: { englishName: 'Macedonian', endonym: 'Македонски' },
  ms: { englishName: 'Malay', endonym: 'Bahasa Melayu' },
  mr: { englishName: 'Marathi', endonym: 'मराठी' },
  nb: { englishName: 'Norwegian (Bokmål)', endonym: 'Norsk bokmål' },
  nn: { englishName: 'Norwegian (Nynorsk)', endonym: 'Norsk nynorsk' },
  pl: { englishName: 'Polish', endonym: 'Polski' },
  'pt-BR': { englishName: 'Portuguese (Brazilian)', endonym: 'Português (Brasil)' },
  ro: { englishName: 'Romanian', endonym: 'Română' },
  rw: { englishName: 'Kinyarwanda', endonym: 'Kinyarwanda' },
  sq: { englishName: 'Albanian', endonym: 'Shqip' },
  sr: { englishName: 'Serbian', endonym: 'Srpski' },
  es: { englishName: 'Spanish', endonym: 'Español' },
  sv: { englishName: 'Swedish', endonym: 'Svenska' },
  ta: { englishName: 'Tamil', endonym: 'தமிழ்' },
  tr: { englishName: 'Turkish', endonym: 'Türkçe' },
  uk: { englishName: 'Ukrainian', endonym: 'Українська' },
  vi: { englishName: 'Vietnamese', endonym: 'Tiếng Việt' },
};
const STORAGE_KEY = 'pb.lang';
const LANG_CODES = Object.keys(LANG_META) as Lang[];

/**
 * Picker order: 'Follow system' pinned first — it is a mode, not a language,
 * and it stays where the user learned it — then the registry sorted by its
 * English key, which is stable across engines, builds and whichever UI
 * language is active (a list that rearranges itself after a language switch
 * cannot be clicked from memory). One consequence is worth stating: Chinese
 * sorts first, so the three CJK rows head the list — the group our main
 * audience reaches for — with the Latin names in their own alphabetical order
 * behind them. Result in all forty-one UI languages.
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
 * Every localized "Follow system" label plus the bare word "system" — the
 * searchable aliases for the pinned mode row (language-search.ts). Both
 * scripts of Chinese are in here via their own dictionaries (跟随系统,
 * 跟隨系統), so either matches.
 */
export const SYSTEM_LABELS: readonly string[] = [...new Set([
  ...Object.values(DICTS).map((dict) => dict['prefs.langSystem']),
  zhTw['prefs.langSystem'],
  'system',
])];

/**
 * Browser tags → app language, first tag that matches any supported language
 * wins (that is what `navigator.languages` means: most preferred first). The
 * explicit `en` branch matters as much as the `zh` precedence: without it a
 * `['en-US', 'zh-CN']` list fell through English and opened in Chinese.
 *
 * Inside Chinese, Hans beats Hant only after the region check. The region
 * decides *which* Traditional row: Hong Kong and Macau tags read the Hong
 * Kong dictionary, while a Taiwan tag or a bare `zh-Hant` (no region) reads
 * the generic Traditional row (2026-10-10) — the region-neutral dictionary
 * those readers are better served by now that it ships.
 *
 * Portuguese ships only the Brazilian dictionary, so every `pt*` tag — a
 * bare `pt` or an unshipped region like `pt-PT` — lands on it (a Portuguese
 * speaker is far better served by Brazilian wording than by English).
 * Hebrew matches its historical `iw` alias too: some browsers and OS locales
 * still send the pre-2004 code. Filipino likewise matches its historical
 * `tl` (Tagalog) code — the OS locale tag that predates the `fil` rename.
 */
export function langFromTags(tags: readonly string[]): Lang {
  for (const l of tags) {
    if (/^zh-(hant-(hk|mo)|hk|mo)/i.test(l)) return 'zh-hk';
    if (/^zh-(hant(-tw)?|tw)/i.test(l)) return 'zh-hant';
    if (/^zh/i.test(l)) return 'zh';
    if (/^(he|iw)/i.test(l)) return 'he';
    if (/^ar/i.test(l)) return 'ar'; // arq/ars (Arabic variants) start with `ar` too
    if (/^(fil|tl)/i.test(l)) return 'fil'; // tl = pre-2013 Tagalog tag
    if (/^az/i.test(l)) return 'az';
    if (/^bg/i.test(l)) return 'bg';
    if (/^bs/i.test(l)) return 'bs';
    if (/^da/i.test(l)) return 'da';
    if (/^de/i.test(l)) return 'de';
    if (/^el/i.test(l)) return 'el';
    if (/^hi/i.test(l)) return 'hi';
    if (/^hr/i.test(l)) return 'hr';
    if (/^hu/i.test(l)) return 'hu';
    if (/^hy/i.test(l)) return 'hy'; // covers hye (Armenian old code)
    if (/^id/i.test(l)) return 'id';
    if (/^it/i.test(l)) return 'it';
    if (/^mk/i.test(l)) return 'mk';
    if (/^mr/i.test(l)) return 'mr';
    if (/^ms/i.test(l)) return 'ms';
    if (/^nb/i.test(l)) return 'nb';
    if (/^nn/i.test(l)) return 'nn';
    if (/^ro/i.test(l)) return 'ro';
    if (/^rw/i.test(l)) return 'rw'; // covers kin (Kinyarwanda old code)
    if (/^sq/i.test(l)) return 'sq'; // covers alb (Albanian old code)
    if (/^sr/i.test(l)) return 'sr';
    if (/^sv/i.test(l)) return 'sv';
    if (/^ta/i.test(l)) return 'ta';
    if (/^uk/i.test(l)) return 'uk'; // covers ukr (Ukrainian old code)
    if (/^vi/i.test(l)) return 'vi';
    if (/^pt/i.test(l)) return 'pt-BR';
    if (/^es/i.test(l)) return 'es';
    if (/^fr/i.test(l)) return 'fr';
    if (/^tr/i.test(l)) return 'tr';
    if (/^cs/i.test(l)) return 'cs';
    if (/^nl/i.test(l)) return 'nl';
    if (/^ja/i.test(l)) return 'ja';
    if (/^ko/i.test(l)) return 'ko';
    if (/^pl/i.test(l)) return 'pl';
    if (/^en/i.test(l)) return 'en';
  }
  return 'en';
}

/**
 * Languages that read right-to-left. The set is checked against the registry
 * at type level (`RTL_LANGS` is `Lang[]`), so a language cannot flip the UI
 * without an explicit entry here.
 */
export const RTL_LANGS: readonly Lang[] = ['ar', 'he'];
export const isRtl = (l: Lang): boolean => RTL_LANGS.includes(l);

function systemLang(): Lang {
  return langFromTags(navigator.languages ?? [navigator.language]);
}

export type TFunc = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * Locale-aware decimal rendering (number-format.ts): `fractionDigits` fixes
 * precision like toFixed(), omitting it keeps "0.5"/"1" short.
 */
export type NFunc = (value: number, fractionDigits?: number) => string;

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
  // The Taiwan row was withdrawn from the picker (2026-10-07, fifth batch
  // pending). A stored zh-tw choice migrates in place to the generic
  // Traditional dictionary its wording is a snapshot of: relaunching must
  // neither blank the UI nor silently flip to 'system', which would start
  // following the OS language instead of the choice the user actually made.
  if (saved === 'zh-tw') {
    localStorage.setItem(STORAGE_KEY, 'zh-hant');
    return 'zh-hant';
  }
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
  n: NFunc;
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
      n: (value, fractionDigits) => formatDecimal(value, lang, fractionDigits),
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
  // Document-level text direction. The `dir` attribute flips only what CSS
  // reads as direction-sensitive (block start, bidi ordering); the field
  // canvases draw their own pixels, and the physical containers — timeline
  // axis, numeric inputs, pairing labels — pin `direction: ltr` /
  // `unicode-bidi: isolate` in app.css, so geometry never mirrors. Runs in
  // every window (main + desktop prefs), each with its own document.
  useEffect(() => {
    document.documentElement.setAttribute('dir', isRtl(lang) ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

/** The name a language is listed under: its own, never an English exonym. */
export const langLabel = (l: Lang): string => LANG_META[l].endonym;
