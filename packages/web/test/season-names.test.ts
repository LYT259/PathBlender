import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_ID, FIELDS, makeCustomField } from '@pathblender/core';
import { en } from '../src/i18n/en';
import { SEASON_NAME_KEYS, seasonLabel } from '../src/i18n/season-names';

const keyEcho = (key: string) => `«${key}»`; // stub proves the label routes through t()

describe('season name keys', () => {
  it('maps exactly the bundled season ids, every key present in en', () => {
    expect(Object.keys(SEASON_NAME_KEYS).sort()).toEqual(FIELDS.map((f) => f.id).sort());
    for (const key of Object.values(SEASON_NAME_KEYS)) expect(en[key]).toBeDefined();
  });

  it('the English value of every season key is the official core name, byte-for-byte', () => {
    for (const f of FIELDS) expect(en[SEASON_NAME_KEYS[f.id]!], f.id).toBe(f.name);
  });

  it('renders a bundled season through t() with the year appended', () => {
    const f = FIELDS.find((x) => x.id === 'rebuilt-2026')!;
    expect(seasonLabel(keyEcho, f)).toBe(`«season.rebuilt2026» ${f.year}`);
  });

  it('never translates custom or unknown fields — the name is user data', () => {
    const custom = makeCustomField({
      name: '黑框測試場地', lengthM: 16, widthM: 8, ppm: 100,
      marginM: 0, pixelWidth: 1600, pixelHeight: 800,
    });
    expect(seasonLabel(keyEcho, custom)).toBe('黑框測試場地');
    expect(SEASON_NAME_KEYS[CUSTOM_FIELD_ID]).toBeUndefined();
    expect(seasonLabel(keyEcho, { id: 'future-2099', name: 'New Game', year: 2099 })).toBe('New Game');
  });
});
