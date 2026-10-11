/**
 * Locale-aware decimal rendering for user-visible numbers (the 2026-10-07
 * number-format display layer): everything the UI prints next to words —
 * clock readouts, durations, gaps, tolerances, lengths — goes through
 * `formatDecimal`, so the decimal separator the user sees is the one their
 * dictionary already uses (i18n-quality's COMMA/POINT tables pin the same
 * convention for the hard-coded dictionary decimals; the two lists must
 * not drift apart).
 *
 * Digits stay Latin and grouping stays off: coordinates, seconds and
 * bumper sizes never reach a thousand, and canvas overlays mix these
 * numbers with Latin-digit literals, so a numbering-system flip would put
 * two digit scripts on one screen. Two languages pin 'en' explicitly,
 * because their CLDR default numbering system is not Latin and the ICU
 * build (Node vs WebKit) decides the result otherwise:
 *  - ar: CLDR defaults to Arabic-Indic digits; this project's convention
 *    (2026-10-06 audit, i18n-quality decimal gate) is a tech-UI point,
 *    accepted for Arabic.
 *  - mr: CLDR defaults to Devanagari digits; the dictionary's own
 *    convention is Latin digits with a point.
 *
 * Beyond the tag, hy and rw are separator-pinned: their CLDR decimal symbol
 * drifted between engine builds (Node's ICU answered comma, this machine's
 * Chrome answered point during the 2026-10-07 acceptance sweep), and both
 * dictionaries hard-code commas, so the '.'-to-',' normalize below keeps
 * runtime, dictionaries and both gate tables in agreement everywhere.
 * With useGrouping:false a '.' can only ever be the decimal separator.
 *
 * Not routed through here on purpose: values that feed `type="number"`
 * inputs (`Number()` must parse them back) and the English-only solution
 * package artifacts (README, replay video overlay) — those are data, not
 * localized prose.
 */
import type { Lang } from './i18n';

const TAGS: Record<Lang, string> = {
  ar: 'en',
  mr: 'en',
  en: 'en',
  'en-GB': 'en-GB',
  az: 'az',
  bg: 'bg',
  bs: 'bs',
  cs: 'cs',
  da: 'da',
  de: 'de',
  el: 'el',
  es: 'es',
  fil: 'fil',
  fr: 'fr',
  he: 'he',
  hi: 'hi',
  hr: 'hr',
  hu: 'hu',
  hy: 'hy',
  id: 'id',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  mk: 'mk',
  ms: 'ms',
  nb: 'nb',
  nl: 'nl',
  nn: 'nn',
  pl: 'pl',
  'pt-BR': 'pt-BR',
  ro: 'ro',
  rw: 'rw',
  sq: 'sq',
  sr: 'sr',
  sv: 'sv',
  ta: 'ta',
  tr: 'tr',
  uk: 'uk',
  vi: 'vi',
  zh: 'zh',
  'zh-hk': 'zh-HK',
  'zh-mo': 'zh-MO',
  'zh-tw': 'zh-TW',
};

const cache = new Map<string, Intl.NumberFormat>();

function formatter(lang: Lang, min: number, max: number): Intl.NumberFormat {
  const key = `${lang}:${min}:${max}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(TAGS[lang], {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      useGrouping: false,
    });
    cache.set(key, f);
  }
  return f;
}

/**
 * Format a decimal with the language's separator. `fractionDigits` fixes
 * the precision like `toFixed()` does; omit it for the loose form the
 * speed steps use ("0.25", "0.5", "1" stay exactly as short as they are).
 */
export function formatDecimal(value: number, lang: Lang, fractionDigits?: number): string {
  const min = fractionDigits ?? 0;
  const max = fractionDigits ?? 2;
  const out = formatter(lang, min, max).format(value);
  return lang === 'hy' || lang === 'rw' ? out.replace('.', ',') : out;
}
