#!/usr/bin/env node
/**
 * Regenerates packages/web/src/i18n/language-names.ts — the offline
 * cross-language name matrix behind the language-picker search
 * (language-search.ts).
 *
 * Source of truth for the language list is src/i18n/index.tsx itself: the
 * Lang codes are read out of `LANG_META` there, and the generated file is
 * typed `Record<Lang, …>`, so a registry change that misses a regeneration
 * is a type error, not a silent gap.
 *
 * Names come from Node's full-ICU `Intl.DisplayNames` (CLDR): for every
 * supported UI language, the name it uses for every selectable language —
 * the exact data a user typing in that language expects to match. The
 * matrix is committed, so the shipped search never calls Intl.DisplayNames:
 * browsers and the desktop WKWebView carry different CLDR versions and
 * different per-item fallbacks (fil silently falls back to English for 38
 * of 40 names in some builds), and a search that behaves differently per
 * shell is worse than a frozen table. Regenerate deliberately when the
 * registry changes; `node scripts/gen-language-names.mjs` writes the file.
 *
 * CLDR holes are NOT silently skipped. `of(code)` returning the bare code
 * means even the English name is missing; every such hole must be resolved
 * here, in CURATED, with a source — or the script fails.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Converter } from 'opencc-js';

const ROOT = resolve(import.meta.dirname, '..');
const INDEX_TS = resolve(ROOT, 'packages/web/src/i18n/index.tsx');
const OUT_TS = resolve(ROOT, 'packages/web/src/i18n/language-names.ts');

/**
 * CLDR has no name for these targets in these query languages. Filled from
 * attested sources — a wrong alias here is a wrong search hit, so each entry
 * names where the wording comes from.
 *
 * - rw/zh "Igishinwa": AfDB Survival Kinyarwanda Vocabulary (2014), Glosbe,
 *   the Iriza/Webonary dictionaries, and AllAfrica (2014) —
 *   "Inkoranya y'Ikinyarwanda, Icyongereza n'Igishinwa".
 * - rw/nb "Ikinoruveji": Unicode CLDR by-type chart gives it as the rw name
 *   of Norwegian (macrolanguage); Bokmål is its standard written form, so
 *   the rw name of Norwegian covers the row. Also Lexvo.
 * - rw/zh-hk "Igishinwa (HK)": CLDR rw composes "zh (HK)" when the base name
 *   is missing; recomposed from the attested base with CLDR's own
 *   "name (REGION)" pattern.
 * - rw/zh-hant "Igishinwa (Hant)": same composition, script subtag instead of
 *   a region — CLDR rw composes "zh (Hant)" here, so the fill keeps CLDR's
 *   own parenthetical on the attested base.
 */
const CURATED = {
  rw: { zh: 'Igishinwa', nb: 'Ikinoruveji', 'zh-hk': 'Igishinwa (HK)', 'zh-hant': 'Igishinwa (Hant)' },
};

async function registryCodes() {
  const source = await readFile(INDEX_TS, 'utf8');
  const block = source.match(/export const LANG_META[\s\S]*?\{\n([\s\S]*?)\n\};/);
  if (!block) throw new Error('LANG_META not found in src/i18n/index.tsx');
  const rows = [...block[1].matchAll(/^\s{2}'?([\w-]+)'?:\s*\{ englishName: '([^']+)', endonym: '([^']+)' \},?\s*$/gm)];
  if (rows.length < 40) throw new Error(`suspiciously short registry read: ${rows.length} codes`);
  return rows.map(([, code, englishName, endonym]) => ({ code, englishName, endonym }));
}

const registry = await registryCodes();
const codes = registry.map((r) => r.code);

// Han-variant folding, at generation time (opencc-js is a devDependency and
// never ships in the bundle): CLDR names the simplified row 德语 and the
// traditional row 德文, so a Hong Kong user typing 德語 would match nothing.
// Every name containing Han also indexes its converted counterpart, both
// directions — 简体中文 gains 簡體中文 and vice versa.
const hasHan = (s) => /[\u3400-\u9FFF]/.test(s);
const toTraditional = await Converter({ from: 'cn', to: 'hk' });
const toSimplified = await Converter({ from: 'tw', to: 'cn' });

// Whole-locale fallback check: if the instance resolves away from the
// requested language, every name would come back in some other language.
const resolvers = new Map(codes.map((locale) => {
  const dn = new Intl.DisplayNames([locale], { type: 'language' });
  const resolved = dn.resolvedOptions().locale;
  const want = locale.split('-')[0].toLowerCase();
  if (!resolved.toLowerCase().startsWith(want)) {
    throw new Error(`locale ${locale} fell back to ${resolved} — ICU data missing, cannot generate`);
  }
  return [locale, dn];
}));

/** A CLDR composed fallback: the base name was missing, so the raw code was
 * pasted in front of the region ("zh (HK)"). Not a name — a hole in disguise. */
const isComposedFallback = (name) => /^[a-z]{2,3}(?:-[A-Za-z]{2,4})? \(/.test(name);

/** matrix[target] = names of `target`: one per query language in registry
 * order, plus the registry's English sort name and endonym (so those get the
 * Han folding too), plus the converted Han counterpart of every Han name. */
const matrix = new Map(registry.map(({ code: target, englishName, endonym }) => {
  const names = [];
  const push = (name) => { if (!names.includes(name)) names.push(name); };
  const add = (name) => {
    push(name);
    if (hasHan(name)) { push(toTraditional(name)); push(toSimplified(name)); }
  };
  for (const locale of codes) {
    let name = resolvers.get(locale).of(target);
    if (name === target || isComposedFallback(name)) {
      const curated = CURATED[locale]?.[target];
      if (!curated) {
        throw new Error(`no CLDR name for ${target} in ${locale} (raw: ${name}) and no CURATED entry — resolve it (with a source) or the matrix ships a hole`);
      }
      name = curated;
    }
    add(name);
  }
  add(englishName);
  add(endonym);
  return [target, names];
}));

const rows = codes.map((code) => {
  const names = matrix.get(code).map((n) => JSON.stringify(n)).join(', ');
  return `  ${/^\w+$/.test(code) ? code : `'${code}'`}: [${names}],`;
}).join('\n');

const curatedNote = Object.entries(CURATED).flatMap(([loc, fills]) =>
  Object.entries(fills).map(([target, name]) => `${loc}→${target} “${name}”`)).join(', ');

const file = `/**
 * GENERATED by scripts/gen-language-names.mjs — do not edit by hand.
 *
 * One row per selectable language: every name the world's UI languages call
 * it, from CLDR via Node ${process.version} full ICU (Intl.DisplayNames);
 * names carrying Han also index their OpenCC-converted counterpart in the
 * other script, so a Traditional query matches a Simplified name and back.
 * Curated CLDR-hole fills: ${curatedNote}. Query-language order follows the
 * LANG_META registry; the registry's English sort name and endonym are folded
 * in (with their Han variants); exact duplicates dropped. The picker search
 * (language-search.ts) adds only the language code on top at runtime — this
 * file is only names, so regenerating it never touches hand-owned data.
 */
import type { Lang } from './index';

export const LANGUAGE_NAMES: Record<Lang, readonly string[]> = {
${rows}
};
`;

await writeFile(OUT_TS, file);
console.log(`wrote ${OUT_TS.relativePath ?? OUT_TS} (${codes.length} languages × ≤${codes.length} names)`);
