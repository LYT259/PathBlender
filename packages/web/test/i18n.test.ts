import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { fr } from '../src/i18n/fr';
import { tr } from '../src/i18n/tr';
import { zh } from '../src/i18n/zh';
import { zhTw } from '../src/i18n/zh-tw';
import { LANGUAGES, langLabel, langFromTags, type Lang } from '../src/i18n';

/**
 * Every shipped dictionary. Adding a language means adding one row here (plus
 * `DICTS`/`LANG_LABEL` and a `langFromTags` branch in `src/i18n/index.tsx`);
 * these tests then hold it to the same bar as English. Each file is typed
 * `Record<MessageKey, string>`, so a missing key is a compile error too — the
 * runtime checks below cover the blanks and the placeholders a type cannot.
 */
const DICTS: Record<string, Record<string, string>> = { en, es, fr, tr, zh, 'zh-tw': zhTw };
const CODES = Object.keys(DICTS) as Lang[];
const KEYS = Object.keys(en);
/** What the picker shows, in the order it shows it ('system' is a mode). */
const pickerLabels = LANGUAGES.flatMap((l) => (l === 'system' ? [] : [langLabel(l)]));
const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');

describe('i18n dictionaries', () => {
  it('every language covers the English key set and nothing more', () => {
    for (const code of CODES) {
      expect(Object.keys(DICTS[code]!).sort(), code).toEqual([...KEYS].sort());
    }
  });

  it('no value is missing or blank', () => {
    for (const code of CODES) {
      for (const key of KEYS) {
        const value = DICTS[code]![key];
        expect(typeof value, `${code}:${key}`).toBe('string');
        expect(value?.trim(), `${code}:${key}`).not.toBe('');
      }
    }
  });

  it('placeholders in translations match the English source', () => {
    for (const code of CODES) {
      for (const [key, source] of Object.entries(en)) {
        expect(placeholders(DICTS[code]![key]!), `${code}:${key}`).toBe(placeholders(source));
      }
    }
  });
});

describe('language picker', () => {
  /**
   * The list is sorted by the endonym the user actually sees, with the collator
   * pinned to English so switching language never reshuffles it — see the
   * comment on LANGUAGES. Latin names come first, then the two CJK names in
   * code-point order (简体 before 繁體).
   */
  it('offers the languages in a fixed alphabetical order after “system”', () => {
    expect([...LANGUAGES]).toEqual(['system', 'en', 'es', 'fr', 'tr', 'zh', 'zh-tw']);
  });

  it('lists exactly the shipped dictionaries', () => {
    for (const code of CODES) expect(LANGUAGES).toContain(code);
    expect(LANGUAGES).toHaveLength(CODES.length + 1); // +1: the 'system' mode
  });

  it('labels each language in its own language', () => {
    expect(CODES.map((c) => langLabel(c))).toEqual([
      'English',
      'Español',
      'Français',
      'Türkçe',
      '简体中文',
      '繁體中文',
    ]);
  });

  it('the visible labels really are in collation order', () => {
    const collator = new Intl.Collator('en', { sensitivity: 'base' });
    expect([...pickerLabels].sort(collator.compare)).toEqual(pickerLabels);
  });

  it('the order does not follow the UI language', () => {
    // Why the collator is pinned: sorted by pinyin — what a `zh` collator does
    // — the two Chinese names jump to the top and swap places, so a Chinese
    // user who switches to Français would watch the list rearrange under their
    // cursor. LANGUAGES must not depend on the locale it is rendered in.
    const byPinyin = new Intl.Collator('zh', { sensitivity: 'base' });
    expect([...pickerLabels].sort(byPinyin.compare)).not.toEqual(pickerLabels);
  });
});

describe('system language detection', () => {
  it('maps the tags the P1 communities send', () => {
    expect(langFromTags(['es-MX', 'es'])).toBe('es');
    expect(langFromTags(['fr-CA', 'en'])).toBe('fr');
    expect(langFromTags(['tr-TR'])).toBe('tr');
    expect(langFromTags(['zh-TW'])).toBe('zh-tw');
    expect(langFromTags(['zh-Hant-HK'])).toBe('zh-tw');
    expect(langFromTags(['zh-CN'])).toBe('zh');
    expect(langFromTags(['en-GB'])).toBe('en');
    // Anything unsupported still lands on English rather than undefined.
    expect(langFromTags(['de-DE', 'ja-JP'])).toBe('en');
    expect(langFromTags([])).toBe('en');
  });

  it('honours the browser preference order instead of scanning for a favourite', () => {
    // Regression: 'en' had no branch at all, so ['en-US', 'zh-CN'] — a Chrome
    // list that means "English, then Chinese" — opened in Chinese.
    expect(langFromTags(['en-US', 'zh-CN'])).toBe('en');
    expect(langFromTags(['de-DE', 'fr-FR', 'en'])).toBe('fr');
  });
});

describe('desktop native menu', () => {
  it('has a menu table for every web language', () => {
    // set_menu_language used to fall through to English for anything but
    // zh/zh-tw, so es/fr/tr users got an English native menu beside a
    // translated window. The match arms in lib.rs are the guard below.
    const rust = readFileSync(
      resolve(__dirname, '../../../packages/desktop/src-tauri/src/lib.rs'),
      'utf8',
    );
    for (const code of CODES) {
      expect(rust, `desktop menu arm for ${code}`).toContain(`"${code}" =>`);
    }
  });
});

describe('custom fields (core)', () => {
  it('round-trips through a session file', async () => {
    const { makeCustomField, serializeSession, deserializeSession } = await import('@pathblender/core');
    const field = makeCustomField({
      lengthM: 10, widthM: 5, ppm: 100, marginM: 0.25,
      pixelWidth: 1050, pixelHeight: 550,
    });
    const text = serializeSession([], 'custom', field);
    const restored = deserializeSession(text);
    expect(restored.fieldId).toBe('custom');
    expect(restored.field?.lengthM).toBeCloseTo(10, 9);
    expect(restored.field?.image?.ppm).toBe(100);
    expect(restored.field?.image?.marginM).toBeCloseTo(0.25, 9);
  });
});
