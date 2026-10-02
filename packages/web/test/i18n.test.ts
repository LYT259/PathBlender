import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en, type MessageKey } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { fr } from '../src/i18n/fr';
import { tr } from '../src/i18n/tr';
import { zh } from '../src/i18n/zh';
import { zhHk, zhHkOverrides } from '../src/i18n/zh-hk';
import { zhTw } from '../src/i18n/zh-tw';
import { LANGUAGES, langLabel, langFromTags, type Lang } from '../src/i18n';

/**
 * Every shipped dictionary. Adding a language means adding one row here (plus
 * `DICTS`, a `LANG_META` row and a `langFromTags` branch in
 * `src/i18n/index.tsx`, and a menu table in `packages/desktop`); these tests
 * then hold it to the same bar as English. Each full dictionary is typed
 * `Record<MessageKey, string>`, so a missing key is a compile error too — the
 * runtime checks below cover the blanks and the placeholders a type cannot.
 */
const DICTS: Record<string, Record<string, string>> = {
  en, es, fr, tr, zh, 'zh-hk': zhHk, 'zh-tw': zhTw,
};
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

  /**
   * Untranslated-residue gate (report §7.2 v1.20, item ③ — adapted to this
   * project's source dictionary, which is `en.ts`): a translated value that is
   * still byte-identical to English is a missed translation unless it is
   * deliberately verbatim. The whitelist is the whole allow-list, so a new key
   * that ships as its own English text fails the run.
   */
  const KEEP_VERBATIM = new Set([
    // Brand and format names, never translated.
    'app.title',
    // Symbols and unit strings the field itself renders.
    'conflicts.pair', 'customField.ppm', 'timeline.speed', 'timeline.clock',
    'timeline.activity', 'timeline.band', 'canvas.clock', 'rail.png',
    // View-cube initials: the Latin abbreviations collide, so every dictionary
    // keeps the English letters (only the CJK ones use single ideographs).
    'vc.top', 'vc.bottom', 'vc.front', 'vc.back', 'vc.left', 'vc.right',
    // Words that genuinely coincide with English in at least one shipped
    // language (fr 'Assistant'/'Pause'/'Vision', tr 'model', es/… 'Robot').
    'workspace.assistant', 'workspace.details', 'robots.identity', 'robots.title',
    'robots.collision', 'robots.alliance', 'timeline.pause', 'timeline.collision',
    'site.version', 'about.version', 'ai.model', 'ai.vision', 'ai.placeholder', 'ai.permission',
    'ai.perm.standard', 'ai.effort', 'ai.stop',
    // Tokens sent to the provider or the OS unchanged.
    'ai.effort.auto', 'ai.testOk', 'prefs.channel.stable', 'prefs.channel.beta',
  ]);

  it('nothing is left sitting on the English text', () => {
    for (const code of CODES) {
      if (code === 'en') continue;
      for (const [key, source] of Object.entries(en)) {
        if (KEEP_VERBATIM.has(key)) continue;
        expect(DICTS[code]![key], `${code}:${key} still holds the English text`).not.toBe(source);
      }
    }
  });

  it('the verbatim whitelist does not carry dead entries', () => {
    // A key that stopped being identical to English should leave the list, or
    // the gate silently allows a future regression on it.
    for (const key of KEEP_VERBATIM) {
      const stillVerbatim = CODES.some((c) => c !== 'en' && DICTS[c]![key] === en[key as keyof typeof en]);
      expect(stillVerbatim, `en:${key} is translated everywhere; drop it from KEEP_VERBATIM`).toBe(true);
    }
  });
});

describe('language picker', () => {
  /**
   * Order comes from the registry's ASCII English sort key, not from a
   * collator — see the comment on LANGUAGES (report §7.2 v1.20). 'system' is a
   * mode and stays pinned first; Chinese sorts first, so the two CJK names
   * head the list and the Latin names keep their own alphabetical order.
   */
  it('offers the languages in a fixed alphabetical order after “system”', () => {
    expect([...LANGUAGES]).toEqual(['system', 'zh', 'zh-hk', 'zh-tw', 'en', 'fr', 'es', 'tr']);
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
      '繁體中文（中國香港）',
      '繁體中文（中國台灣）',
    ]);
    expect(pickerLabels).toEqual([
      '简体中文',
      '繁體中文（中國香港）',
      '繁體中文（中國台灣）',
      'English',
      'Français',
      'Español',
      'Türkçe',
    ]);
  });

  it('is hand-owned order, not a collator’s opinion', () => {
    // No ICU collation reproduces this list: `en`/`tr` keep the Latin names
    // first, `zh` sorts by pinyin and swaps the two Chinese names. That is the
    // point — a collator would let V8 and WebKit disagree between the dev
    // server and the desktop WKWebView, and let the UI language move rows under
    // the user's cursor.
    for (const locale of ['en', 'zh', 'tr', 'es']) {
      const collator = new Intl.Collator(locale, { sensitivity: 'base' });
      expect([...pickerLabels].sort(collator.compare), locale).not.toEqual(pickerLabels);
    }
  });
});

describe('system language detection', () => {
  it('maps the tags the shipped communities send', () => {
    expect(langFromTags(['es-MX', 'es'])).toBe('es');
    expect(langFromTags(['fr-CA', 'en'])).toBe('fr');
    expect(langFromTags(['tr-TR'])).toBe('tr');
    expect(langFromTags(['zh-CN'])).toBe('zh');
    expect(langFromTags(['en-GB'])).toBe('en');
    // Anything unsupported still lands on English rather than undefined.
    expect(langFromTags(['de-DE', 'ja-JP'])).toBe('en');
    expect(langFromTags([])).toBe('en');
  });

  it('splits Traditional Chinese by region, with Macau reading Hong Kong', () => {
    // Report §7.2 v1.23: 澳门不单开 locale，就近并入 zh-hk (same rule as
    // es-AR → es-MX), and a bare `zh-Hant` carries no region so it takes the
    // larger community's dictionary.
    expect(langFromTags(['zh-HK'])).toBe('zh-hk');
    expect(langFromTags(['zh-Hant-HK'])).toBe('zh-hk');
    expect(langFromTags(['zh-MO'])).toBe('zh-hk');
    expect(langFromTags(['zh-Hant-MO'])).toBe('zh-hk');
    expect(langFromTags(['zh-TW'])).toBe('zh-tw');
    expect(langFromTags(['zh-Hant-TW'])).toBe('zh-tw');
    expect(langFromTags(['zh-Hant'])).toBe('zh-tw');
    // Hans always wins over the region: a Simplified-Chrome install in Hong
    // Kong (`zh-Hans-HK`) must not open in Traditional.
    expect(langFromTags(['zh-Hans-HK'])).toBe('zh');
    expect(langFromTags(['zh-Hans-MO'])).toBe('zh');
    expect(langFromTags(['en-GB', 'zh-HK'])).toBe('en');
  });

  it('honours the browser preference order instead of scanning for a favourite', () => {
    // Regression: 'en' had no branch at all, so ['en-US', 'zh-CN'] — a Chrome
    // list that means "English, then Chinese" — opened in Chinese.
    expect(langFromTags(['en-US', 'zh-CN'])).toBe('en');
    expect(langFromTags(['de-DE', 'fr-FR', 'en'])).toBe('fr');
  });
});

describe('Hong Kong dictionary (override table)', () => {
  const overrideKeys = Object.keys(zhHkOverrides);

  it('inherits everything except its own rows', () => {
    // The whole point of shipping an override table instead of a second copy:
    // zh-tw and zh-hk may differ on exactly these keys and nothing else, so a
    // wording change in zh-tw reaches Hong Kong without a second edit.
    const differing = KEYS.filter((k) => zhHk[k as MessageKey] !== zhTw[k as keyof typeof zhTw]);
    expect(differing.sort()).toEqual([...overrideKeys].sort());
  });

  it('is small, and every row actually changes the Taiwan wording', () => {
    // A row that restates zh-tw is dead weight that reads like a difference.
    for (const key of overrideKeys) {
      expect(zhHkOverrides[key as keyof typeof zhHkOverrides]).not.toBe(
        zhTw[key as keyof typeof zhTw],
      );
    }
    // Growing past this needs a real HK-vs-TW term behind it, not a preference.
    expect(overrideKeys.length).toBeLessThan(40);
  });

  /**
   * "The two variants really are different" gate (report §7.2 v1.24 ②, from
   * GHPaths v1.33): a count that merely stays above zero lets someone quietly
   * delete rows and hand Hong Kong the Taiwan spellings back — the test above
   * stays green, because it only compares against the override list. So pin the
   * divergences by name (these three are what a Hong Kong reader notices first)
   * and keep a floor under the total. GHPaths sees 32 of its 412 keys differ
   * because that UI carries media vocabulary (影片/軟體); ours is a field tool,
   * so 7 today with the floor at 5.
   */
  it('pins the named HK/TW divergences', () => {
    expect(zhTw['robots.bumper' as MessageKey]).toContain('公尺');
    expect(zhHk['robots.bumper']).toContain('米');
    expect(zhHk['robots.bumper']).not.toContain('公尺');
    expect(zhTw['updates.failed' as MessageKey]).toContain('網路');
    expect(zhHk['updates.failed']).toContain('網絡');
    expect(zhTw['robots.selectPrompt' as MessageKey]).toContain('詳細資訊');
    expect(zhHk['robots.selectPrompt']).toContain('詳細資料');
    expect(overrideKeys.length).toBeGreaterThanOrEqual(5);
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
