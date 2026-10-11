import { describe, expect, it } from 'vitest';
import { formatDecimal } from '../src/number-format';
import { formatLength, formatLengthNumber } from '../src/length-units';
import { LANG_META, type Lang } from '../src/i18n';

/**
 * The number-format display layer (2026-10-07): every user-visible decimal
 * renders through formatDecimal, so the separator must agree with the one
 * the dictionaries' hard-coded decimals use — i18n-quality's COMMA/POINT
 * tables are the same convention viewed from the dictionary side. A drift
 * between these two lists means one screen shows "0,5" next to "0.5".
 */

const COMMA: Lang[] = ['az', 'bg', 'bs', 'cs', 'da', 'de', 'el', 'es', 'fr', 'hr', 'hu', 'id', 'it', 'mk',
  'nb', 'nl', 'nn', 'pl', 'pt-BR', 'ro', 'rw', 'sq', 'sr', 'sv', 'tr', 'uk', 'vi', 'hy'];
// zh-tw, zh-mo and en-GB are point languages (mirrors LANG_META after the
// 2026-10-11 registry change: three region-named Traditional rows, a second
// English row, the generic Traditional row withdrawn).
const POINT: Lang[] = ['en', 'en-GB', 'ar', 'mr', 'fil', 'he', 'hi', 'ja', 'ko', 'ms', 'ta', 'zh', 'zh-hk', 'zh-mo', 'zh-tw'];

describe('formatDecimal separators match the dictionary-side convention', () => {
  it('comma languages render 0.5 as "0,50"', () => {
    for (const lang of COMMA) {
      expect(formatDecimal(0.5, lang, 2), lang).toBe('0,50');
    }
  });

  it('point languages render 0.5 as "0.50" (ar/mr are pinned: CLDR defaults to non-Latin digits)', () => {
    for (const lang of POINT) {
      expect(formatDecimal(0.5, lang, 2), lang).toBe('0.50');
    }
  });

  it('the separator tables cover every shipped language exactly once', () => {
    const all = [...COMMA, ...POINT];
    expect(all.sort()).toEqual(Object.keys(LANG_META).sort());
    expect(new Set(all).size, 'no language in both tables').toBe(all.length);
  });
});

describe('formatDecimal precision behaviour', () => {
  it('fractionDigits fixes precision like toFixed', () => {
    expect(formatDecimal(2.5, 'en', 0)).toBe('3');
    expect(formatDecimal(2.345, 'en', 1)).toBe('2.3');
    expect(formatDecimal(-0.05, 'de', 2)).toBe('-0,05');
  });

  it('omitting fractionDigits keeps speed-step values as short as they are', () => {
    expect(formatDecimal(0.25, 'en')).toBe('0.25');
    expect(formatDecimal(0.5, 'en')).toBe('0.5');
    expect(formatDecimal(1, 'en')).toBe('1');
    expect(formatDecimal(0.25, 'fr')).toBe('0,25');
    expect(formatDecimal(0.5, 'fr')).toBe('0,5');
    expect(formatDecimal(1, 'fr')).toBe('1');
  });

  it('never inserts grouping separators (field numbers stay plain)', () => {
    expect(formatDecimal(1234.5, 'de', 2)).toBe('1234,50');
    expect(formatLength(1234.5, 'm', 'de')).toBe('1234,50 m');
  });
});

describe('formatLength carries the language through', () => {
  it('metres, centimetres and feet+inches localise', () => {
    expect(formatLength(0.927, 'm', 'fr')).toBe('0,93 m');
    expect(formatLength(0.927, 'm', 'en')).toBe('0.93 m');
    expect(formatLength(0.927, 'cm', 'de')).toBe('92,7 cm');
    // 0.927 m ≈ 3'0.5" — inch fraction localises, feet stay integer.
    expect(formatLength(0.927, 'ftin', 'fr')).toBe('3′0,5″');
    expect(formatLength(0.927, 'ftin', 'en')).toBe('3′0.5″');
    expect(formatLengthNumber(-0.12, 'in', 'es')).toBe('4,7');
  });

  it('defaults to the legacy dot form so non-UI callers keep compiling behaviour', () => {
    expect(formatLength(0.927, 'm')).toBe('0.93 m');
  });
});
