/**
 * Minimal i18n: dictionary lookup with {placeholder} interpolation,
 * localStorage preference, browser-language default (ADR-0002).
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { broadcastPref, listenPrefs } from '../pref-sync';
import { formatDecimal } from '../number-format';
import { en, type MessageKey } from './en';
import { enGb } from './en-gb';
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
import { zhHk } from './zh-hk';
import { zhMo } from './zh-mo';
import { zhTw } from './zh-tw';

export type Lang =
  | 'en' | 'en-GB' | 'ar' | 'az' | 'bg' | 'bs' | 'cs' | 'da' | 'de' | 'el'
  | 'es' | 'fil' | 'fr' | 'he' | 'hi' | 'hr' | 'hu' | 'hy' | 'id' | 'it'
  | 'ja' | 'ko' | 'mk' | 'mr' | 'ms' | 'nb' | 'nl' | 'nn' | 'pl' | 'pt-BR'
  | 'ro' | 'rw' | 'sq' | 'sr' | 'sv' | 'ta' | 'tr' | 'uk' | 'vi'
  | 'zh' | 'zh-hk' | 'zh-mo' | 'zh-tw';
/** User choice: 'system' follows the OS language live (first visit uses it). */
export type LangChoice = 'system' | Lang;

const DICTS: Record<Lang, Record<MessageKey, string>> = {
  en, 'en-GB': enGb, ar, az, bg, bs, cs, da, de, el, es, fil, fr, he, hi,
  hr, hu, hy, id, it, ja, ko, mk, mr, ms, nb, nl, nn, pl, 'pt-BR': ptBR,
  ro, rw, sq, sr, sv, ta, tr, uk, vi, zh, 'zh-hk': zhHk, 'zh-mo': zhMo,
  'zh-tw': zhTw,
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
 * it is sorted by, the name it is displayed by, and the short text mark the
 * picker shows beside the check icon. `Record<Lang, …>` makes adding a code to
 * `Lang` without adding a row a compile error.
 *
 * `englishName` is the **sort key**, and it is ASCII on purpose: the order then
 * comes out of a plain string comparison instead of `Intl.Collator`, whose
 * treatment of the two CJK labels differs between V8 and WebKit — precisely the
 * dev-server-vs-desktop-shell drift the GHPaths v1.31 sync warned about.
 * `endonym` is what the picker shows: a language is named in its own language,
 * because a user who cannot read the UI cannot read an English exonym either.
 * `mark` is a short script/region cue (简/繁/EN/あ…) from the explicit per-row
 * map below — never derived by slicing the code, because script and code
 * diverge (sr's dictionary is Latin-script; zh-hk/zh-mo/zh-tw all share 繁).
 *
 * Traditional Chinese ships three region-named selectable rows (2026-10-11):
 * Hong Kong, Macau and Taiwan. The dictionaries layer — zh-hk.ts is an
 * override table over zh-tw.ts, zh-mo.ts over zh-hk.ts (CLDR parentLocales
 * zh-Hant-MO → zh-Hant-HK) — so wording changes made for Taiwan keep reaching
 * Hong Kong and Macau readers. The region-neutral generic Traditional row
 * (zh-hant) was withdrawn the same day: it was a byte-identical snapshot of
 * the Taiwan dictionary, so bare `zh-Hant` tags and stored `zh-hant` choices
 * land on zh-tw with identical wording.
 */
export const LANG_META: Record<Lang, { englishName: string; endonym: string; mark: string }> = {
  zh: { englishName: 'Chinese (Simplified)', endonym: '简体中文', mark: '简' },
  'zh-hk': { englishName: 'Chinese (Traditional, Hong Kong)', endonym: '繁體中文（香港）', mark: '繁' },
  'zh-mo': { englishName: 'Chinese (Traditional, Macau)', endonym: '繁體中文（澳門）', mark: '繁' },
  'zh-tw': { englishName: 'Chinese (Traditional, Taiwan)', endonym: '繁體中文（台灣）', mark: '繁' },
  ar: { englishName: 'Arabic', endonym: 'العربية', mark: 'ع' },
  az: { englishName: 'Azerbaijani', endonym: 'Azərbaycanca', mark: 'AZ' },
  bg: { englishName: 'Bulgarian', endonym: 'Български', mark: 'БГ' },
  bs: { englishName: 'Bosnian', endonym: 'Bosanski', mark: 'BS' },
  cs: { englishName: 'Czech', endonym: 'Čeština', mark: 'CS' },
  da: { englishName: 'Danish', endonym: 'Dansk', mark: 'DA' },
  nl: { englishName: 'Dutch', endonym: 'Nederlands', mark: 'NL' },
  en: { englishName: 'English (United States)', endonym: 'English (United States)', mark: 'EN' },
  'en-GB': { englishName: 'English (United Kingdom)', endonym: 'English (United Kingdom)', mark: 'EN' },
  el: { englishName: 'Greek', endonym: 'Ελληνικά', mark: 'Α' },
  fil: { englishName: 'Filipino', endonym: 'Filipino', mark: 'FIL' },
  fr: { englishName: 'French', endonym: 'Français', mark: 'FR' },
  de: { englishName: 'German', endonym: 'Deutsch', mark: 'DE' },
  he: { englishName: 'Hebrew', endonym: 'עברית', mark: 'א' },
  hi: { englishName: 'Hindi', endonym: 'हिन्दी', mark: 'अ' },
  hr: { englishName: 'Croatian', endonym: 'Hrvatski', mark: 'HR' },
  hu: { englishName: 'Hungarian', endonym: 'Magyar', mark: 'HU' },
  hy: { englishName: 'Armenian', endonym: 'Հայերեն', mark: 'Հ' },
  id: { englishName: 'Indonesian', endonym: 'Bahasa Indonesia', mark: 'ID' },
  it: { englishName: 'Italian', endonym: 'Italiano', mark: 'IT' },
  ja: { englishName: 'Japanese', endonym: '日本語', mark: 'あ' },
  ko: { englishName: 'Korean', endonym: '한국어', mark: '한' },
  mk: { englishName: 'Macedonian', endonym: 'Македонски', mark: 'МК' },
  ms: { englishName: 'Malay', endonym: 'Bahasa Melayu', mark: 'MS' },
  mr: { englishName: 'Marathi', endonym: 'मराठी', mark: 'म' },
  nb: { englishName: 'Norwegian (Bokmål)', endonym: 'Norsk bokmål', mark: 'NB' },
  nn: { englishName: 'Norwegian (Nynorsk)', endonym: 'Norsk nynorsk', mark: 'NN' },
  pl: { englishName: 'Polish', endonym: 'Polski', mark: 'PL' },
  'pt-BR': { englishName: 'Portuguese (Brazilian)', endonym: 'Português (Brasil)', mark: 'PT' },
  ro: { englishName: 'Romanian', endonym: 'Română', mark: 'RO' },
  rw: { englishName: 'Kinyarwanda', endonym: 'Kinyarwanda', mark: 'RW' },
  sq: { englishName: 'Albanian', endonym: 'Shqip', mark: 'SQ' },
  sr: { englishName: 'Serbian', endonym: 'Srpski', mark: 'SR' },
  es: { englishName: 'Spanish', endonym: 'Español', mark: 'ES' },
  sv: { englishName: 'Swedish', endonym: 'Svenska', mark: 'SV' },
  ta: { englishName: 'Tamil', endonym: 'தமிழ்', mark: 'த' },
  tr: { englishName: 'Turkish', endonym: 'Türkçe', mark: 'TR' },
  uk: { englishName: 'Ukrainian', endonym: 'Українська', mark: 'УК' },
  vi: { englishName: 'Vietnamese', endonym: 'Tiếng Việt', mark: 'VI' },
};
const STORAGE_KEY = 'pb.lang';
const LANG_CODES = Object.keys(LANG_META) as Lang[];

/**
 * Picker order: 'Follow system' pinned first — it is a mode, not a language,
 * and it stays where the user learned it — then the registry sorted by its
 * English key, which is stable across engines, builds and whichever UI
 * language is active (a list that rearranges itself after a language switch
 * cannot be clicked from memory). One consequence is worth stating: Chinese
 * sorts first, so the four CJK rows head the list — the group our main
 * audience reaches for — with the Latin names in their own alphabetical order
 * behind them. Result in all forty-three UI languages.
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
 * decides *which* Traditional row: Hong Kong, Macau and Taiwan tags each read
 * their own dictionary. A bare `zh-Hant` (no region) lands on zh-tw — the
 * generic Traditional row withdrawn 2026-10-11 was a byte-identical snapshot
 * of the Taiwan dictionary, so those readers get identical wording.
 *
 * English ships US and UK dictionaries: only an explicit GB tag gets UK
 * spelling — bare `en`, `en-US`, `en-AU`, `en-CA`, `en-IN`… every other
 * English region reads US English (the stable rule). A script subtag does not
 * change the region: `en-Latn-GB` is still British English.
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
    if (/^zh-(hant-hk|hk)/i.test(l)) return 'zh-hk';
    if (/^zh-(hant-mo|mo)/i.test(l)) return 'zh-mo';
    // Bare zh-Hant lands here too: the withdrawn generic row was the Taiwan snapshot.
    if (/^zh-(hant(-tw)?|tw)/i.test(l)) return 'zh-tw';
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
    // Only an explicit GB tag gets UK spelling (script subtag or not:
    // en-Latn-GB is GB too); all other en-* regions read US English.
    if (/^en-(latn-)?gb/i.test(l)) return 'en-GB';
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
  // The generic Traditional row was withdrawn (2026-10-11); its dictionary
  // was a byte-identical snapshot of zh-tw, so a stored zh-hant choice
  // migrates in place to the Taiwan row: the landing wording is identical to
  // what the user had, and it never falls to 简体, English or 'system' (which
  // would start following the OS language instead of the choice the user
  // actually made).
  if (saved === 'zh-hant') {
    localStorage.setItem(STORAGE_KEY, 'zh-tw');
    return 'zh-tw';
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
