import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { zh } from '../src/i18n/zh';
import { zhTw } from '../src/i18n/zh-tw';

describe('i18n dictionaries', () => {
  it('all three languages cover the same key set', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(zhTw).sort()).toEqual(Object.keys(en).sort());
  });

  it('placeholders in translations match the English source', () => {
    const ph = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    for (const [k, v] of Object.entries(en)) {
      expect(ph(zh[k as keyof typeof en] as string), `zh:${k}`).toBe(ph(v));
      expect(ph(zhTw[k as keyof typeof en] as string), `zh-tw:${k}`).toBe(ph(v));
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
