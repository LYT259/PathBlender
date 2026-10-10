/**
 * Offline language search behind the picker (LanguagePicker.tsx).
 *
 * The promise: type a target language's name in ANY of the 41 UI languages —
 * 德语, German, Deutsch, allemand, ドイツ語 — and it matches, whichever
 * language the interface itself happens to speak. The translated names come
 * from the committed CLDR matrix (language-names.ts); the registry's English
 * sort name, the endonym and the code are layered on top; the pinned
 * 'system' mode row matches its own localized labels. No network, no
 * Intl.DisplayNames at runtime — browsers and the desktop WKWebView ship
 * different CLDR builds, and a search that only works in some shells is a
 * bug report waiting to happen.
 */

import { LANG_META, LANGUAGES, SYSTEM_LABELS, type Lang, type LangChoice } from './index';
import { LANGUAGE_NAMES } from './language-names';

/**
 * Canonical folded form for matching. NFKC first (full-width Latin and
 * ligatures collapse), then case, then the Latin/Greek/Cyrillic combining
 * range of NFD so "français" and "francais" meet — and only that range:
 * Arabic harakat, Hebrew niqqud and the Indic signs live elsewhere in
 * Unicode and keep their meaning. German ß folds to ss (standard German
 * case folding). Whitespace runs collapse to one space.
 */
export function foldLanguageName(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Folded aliases per choice, built once at module load (≈1.7k short strings). */
const FOLDED: ReadonlyMap<LangChoice, readonly string[]> = (() => {
  const build = (names: readonly string[]) =>
    [...new Set(names.map(foldLanguageName))].filter((n) => n.length > 0);
  const map = new Map<LangChoice, readonly string[]>();
  map.set('system', build(SYSTEM_LABELS));
  for (const code of LANGUAGES) {
    if (code === 'system') continue;
    map.set(code, build([...LANGUAGE_NAMES[code as Lang], code]));
  }
  return map;
})();

/**
 * Choices matching `query`, in the picker's own stable order — 'system'
 * first, then the registry sort — so results never rearrange as the UI
 * language changes. Empty or blank queries return the full list: an empty
 * search box is not a search.
 */
export function searchLanguages(query: string): readonly LangChoice[] {
  const folded = foldLanguageName(query);
  if (!folded) return LANGUAGES;
  return LANGUAGES.filter((choice) => FOLDED.get(choice)!.some((name) => name.includes(folded)));
}
