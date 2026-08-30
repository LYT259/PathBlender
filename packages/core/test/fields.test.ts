/**
 * Season field registry: 2018–2026 packages, corner-point calibration math.
 * Older-season calibrations come from AdvantageScope assets (BSD-3) —
 * topLeft/bottomRight pixel corners + inch sizes (see field.ts comments).
 */
import { describe, expect, it } from 'vitest';
import { FIELDS, fieldById, fieldImageWorldRect } from '../src';

describe('FIELDS registry', () => {
  it('covers 2018 through 2026 (2021 has no public orthographic asset)', () => {
    const years = FIELDS.map((f) => f.year);
    expect(years).toEqual([2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]);
  });

  it('older seasons carry corner calibrations that bracket the playfield', () => {
    for (const id of ['powerup-2018', 'deepspace-2019', 'infinitercharge-2020']) {
      const f = fieldById(id);
      expect(f.image?.originPx).toBeDefined();
      const rect = fieldImageWorldRect(f.image!, f.lengthM, f.widthM);
      // The playfield (0..L, 0..W) must sit inside the image rect with the
      // corner at the origin and room to the right/top.
      expect(rect.left).toBeLessThanOrEqual(0.001);
      expect(rect.bottom).toBeLessThanOrEqual(0.001);
      expect(rect.right).toBeGreaterThanOrEqual(f.lengthM - 0.001);
      expect(rect.top).toBeGreaterThanOrEqual(f.widthM - 0.001);
      // And the image is not wildly larger than the playfield (< 3.5 m
      // slack — the AdvantageScope renders carry generous outer margins).
      expect(rect.right - f.lengthM).toBeLessThan(3.5);
      expect(rect.top - f.widthM).toBeLessThan(3.5);
    }
  });

  it('uniform-margin fields keep their classic world rect', () => {
    const f = fieldById('rebuilt-2026');
    const rect = fieldImageWorldRect(f.image!, f.lengthM, f.widthM);
    expect(rect).toEqual({ left: -0.5, right: f.lengthM + 0.5, bottom: -0.5, top: f.widthM + 0.5 });
  });

  it('2018 POWER UP matches the AdvantageScope config math', () => {
    const f = fieldById('powerup-2018');
    expect(f.lengthM).toBeCloseTo(16.4592, 4);
    expect(f.widthM).toBeCloseTo(8.2296, 4);
    const img = f.image!;
    // Field corner at (519, 78) px; 2801 px of field length.
    expect(img.ppm * f.lengthM).toBeCloseTo(3320 - 519, 1);
    expect((img.ppmY ?? img.ppm) * f.widthM).toBeCloseTo(1480 - 78, 1);
  });
});
