import { describe, expect, it } from 'vitest';
import { LANGUAGES, SYSTEM_LABELS, type Lang } from '../src/i18n';
import { LANGUAGE_NAMES } from '../src/i18n/language-names';
import { foldLanguageName, searchLanguages } from '../src/i18n/language-search';
import { zh } from '../src/i18n/zh';
import { zhHk } from '../src/i18n/zh-hk';
import { zhMo } from '../src/i18n/zh-mo';
import { zhTw } from '../src/i18n/zh-tw';
import { enGb } from '../src/i18n/en-gb';

/**
 * The language-search contract (LanguagePicker + language-search.ts): a query
 * written in ANY of the 43 UI languages finds the language it names —
 * 德语, German, Deutsch, allemand all reach German — independent of which
 * language the UI itself is showing, with folded case/accents/width and
 * partial matches, and never resurrecting the withdrawn zh-hant row.
 */

describe('language search', () => {
  it('finds German under every name from the user requirement', () => {
    for (const q of ['德语', 'German', 'Deutsch', 'allemand']) {
      expect(searchLanguages(q), q).toContain('de');
    }
  });

  it('every name in the generated matrix finds its own language', () => {
    // The whole promise in one loop: each of the ~1.5k committed names
    // (CLDR names + registry English name + endonym, Han variants included)
    // must surface the language it belongs to.
    for (const code of Object.keys(LANGUAGE_NAMES) as Lang[]) {
      for (const name of LANGUAGE_NAMES[code]) {
        expect(searchLanguages(name), `${name} → ${code}`).toContain(code);
      }
    }
  });

  it('the language code itself finds its language', () => {
    for (const choice of LANGUAGES) {
      if (choice === 'system') continue;
      expect(searchLanguages(choice), choice).toContain(choice);
    }
  });

  it('the system row matches its own labels in every UI language', () => {
    for (const label of SYSTEM_LABELS) {
      expect(searchLanguages(label), label).toContain('system');
    }
    expect(searchLanguages('system')).toContain('system');
    expect(searchLanguages('跟随系统')).toContain('system');
    expect(searchLanguages('跟隨系統')).toContain('system');
  });

  it('the system row matches the label each override-table dictionary inherits', () => {
    // SYSTEM_LABELS is built from DICTS at module load (i18n/index.tsx), and
    // the override tables inherit their carrier's label verbatim — zh-hk and
    // zh-mo read zh-tw's 跟隨系統 (the Macau table is empty on purpose),
    // en-GB reads en's "Follow system". Set-deduped or not, each dictionary's
    // own label must still reach the pinned mode row. Looping the
    // dictionaries rather than SYSTEM_LABELS pins the DICTS → aliases wiring
    // itself.
    for (const dict of [zh, zhTw, zhHk, zhMo, enGb]) {
      expect(searchLanguages(dict['prefs.langSystem' as keyof typeof dict])).toContain('system');
    }
  });

  it('blank queries are not searches: the full picker list comes back', () => {
    expect(searchLanguages('')).toEqual(LANGUAGES);
    expect(searchLanguages('   ')).toEqual(LANGUAGES);
  });

  it('unmatched queries return an empty list', () => {
    expect(searchLanguages('zzzznotalanguage')).toEqual([]);
  });

  it('results keep the picker order — never re-sorted per query', () => {
    expect(searchLanguages('chinese')).toEqual(['zh', 'zh-hk', 'zh-mo', 'zh-tw']);
  });

  it('folding: case, accents, width, whitespace and partials all match', () => {
    expect(searchLanguages('ALLEMAND')).toContain('de');
    expect(searchLanguages('  français ')).toContain('fr');
    expect(searchLanguages('francais')).toContain('fr');
    expect(searchLanguages('Ｇｅｒｍａｎ')).toContain('de');
    expect(searchLanguages('türkçe')).toContain('tr');
    expect(searchLanguages('turkce')).toContain('tr');
    expect(searchLanguages('português')).toContain('pt-BR');
    expect(searchLanguages('portugues')).toContain('pt-BR');
    expect(searchLanguages('Germ')).toContain('de');
    expect(searchLanguages('德')).toContain('de');
  });

  it('Chinese queries match across the simplified/traditional script split', () => {
    // CLDR names the rows 德语 (Hans) and 德文 (Hant); a Hong Kong user typing
    // 德語 must still find German — the matrix ships both Han variants.
    expect(searchLanguages('德語')).toContain('de');
    expect(searchLanguages('简体中文')).toContain('zh');
    expect(searchLanguages('簡體中文')).toContain('zh');
    expect(searchLanguages('繁體中文')).toContain('zh-hk');
    expect(searchLanguages('繁体中文')).toContain('zh-hk');
    expect(searchLanguages('中文')).toContain('zh');
    expect(searchLanguages('中文')).toContain('zh-hk');
  });

  it('queries in scripts far from English still find their language', () => {
    expect(searchLanguages('ドイツ語')).toContain('de');
    expect(searchLanguages('독일어')).toContain('de');
    expect(searchLanguages('Γερμανικά')).toContain('de');
    expect(searchLanguages('الألمانية')).toContain('de');
    expect(searchLanguages('אנגלית')).toContain('en');
    expect(searchLanguages('हिन्दी')).toContain('hi');
  });

  it('a language the app does not ship (Russian) finds nothing', () => {
    // 43 languages ship; Russian is not one of them. Its names in every
    // script must surface no row — the list only offers real choices.
    expect(searchLanguages('Russian')).toEqual([]);
    expect(searchLanguages('русский')).toEqual([]);
    expect(searchLanguages('רוסית')).toEqual([]);
    // The regional rows keep the same promise: Russian names for Hong Kong /
    // Macau / Taiwan / UK English surface nothing, even though the shipped
    // Cyrillic-script languages (bg/mk/sr/uk) name the same targets.
    expect(searchLanguages('китайский (Гонконг [САР])')).toEqual([]);
    expect(searchLanguages('китайский (Макао [САР])')).toEqual([]);
    expect(searchLanguages('китайский (Тайвань)')).toEqual([]);
    expect(searchLanguages('британский английский')).toEqual([]);
  });

  it('the withdrawn region-neutral Traditional row stays unreachable', () => {
    // The generic 繁體中文（通用） row was withdrawn 2026-10-11 (it shipped for
    // one day as a byte-identical snapshot of the Taiwan dictionary) — no
    // alias, code or endonym may resurface it through the search.
    for (const q of ['zh-hant', '通用', '繁體中文（通用）', '繁体中文（通用）']) {
      expect(searchLanguages(q), q).toEqual([]);
    }
  });

  it('the Traditional region rows are findable by their region names', () => {
    // The reversal of the old withdrawal test: Taiwan is a selectable row
    // again, and Macau ships alongside Hong Kong.
    for (const q of ['zh-tw', 'Taiwan', '台灣', '台湾', '臺灣', '繁體中文（台灣）']) {
      expect(searchLanguages(q), q).toContain('zh-tw');
    }
    for (const q of ['zh-mo', 'Macau', 'Macao', '澳門', '澳门', '繁體中文（澳門）']) {
      expect(searchLanguages(q), q).toContain('zh-mo');
    }
    for (const q of ['zh-hk', 'Hong Kong', '香港', '繁體中文（香港）']) {
      expect(searchLanguages(q), q).toContain('zh-hk');
    }
    // A bare Traditional-Chinese query finds all three region rows.
    for (const q of ['繁體中文', '繁体中文']) {
      expect(searchLanguages(q), q).toEqual(expect.arrayContaining(['zh-hk', 'zh-mo', 'zh-tw']));
    }
  });

  it('the UK English row is findable by its region names', () => {
    for (const q of ['en-GB', 'British', 'United Kingdom', '英國英語', '英国英语']) {
      expect(searchLanguages(q), q).toContain('en-GB');
    }
    // The bare country code is also the Ukrainian language code — both rows
    // may surface; the UK row must be among them.
    expect(searchLanguages('UK')).toContain('en-GB');
  });

  it('folding strips Latin/Greek/Cyrillic accents but leaves other scripts intact', () => {
    expect(foldLanguageName('français')).toBe('francais');
    expect(foldLanguageName('ＦＵＬＬ-width')).toBe('full-width');
    expect(foldLanguageName('Weißrussisch')).toBe('weissrussisch');
    expect(foldLanguageName('Жељко')).toBe('жељко'); // Cyrillic case folds; љ is a letter, not an accent
    expect(foldLanguageName('हिन्दी')).toBe('हिन्दी'); // Devanagari matras keep meaning
    expect(foldLanguageName('العَرَبية')).toBe('العَرَبية'); // harakat stay — outside the fold range
  });
});
