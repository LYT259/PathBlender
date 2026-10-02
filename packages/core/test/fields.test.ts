/**
 * Season field registry: 2018–2026 packages, corner-point calibration math,
 * and the artwork-style (schematic/rendered) resolution. 2018–2020 carry the
 * AdvantageScope render as their only art; 2022–2026 ship the PathPlanner
 * schematic as the primary artwork plus an AS render (see field.ts comments).
 */
import { describe, expect, it } from 'vitest';
import { FIELDS, REBUILT_2026, fieldById, fieldImageWorldRect, makeCustomField, withFieldVariant } from '../src';

describe('FIELDS registry', () => {
  it('covers 2018 through 2026 (2021 has no public orthographic asset)', () => {
    const years = FIELDS.map((f) => f.year);
    expect(years).toEqual([2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]);
  });

  it('Autonomous Period follows the season — 15 s through 2025, 20 s in 2026', () => {
    for (const f of FIELDS) {
      expect(f.autoPeriodS).toBe(f.year === 2026 ? 20 : 15);
    }
    expect(REBUILT_2026.autoPeriodS).toBe(20);
    // Custom fields default to the long-standing 15 s unless overridden.
    const base = { lengthM: 16, widthM: 8, ppm: 100, marginM: 0, pixelWidth: 1600, pixelHeight: 800 };
    expect(makeCustomField(base).autoPeriodS).toBe(15);
    expect(makeCustomField({ ...base, autoPeriodS: 20 }).autoPeriodS).toBe(20);
  });

  it('2018–2020 carry corner calibrations that bracket the playfield', () => {
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

  it('the rendered artwork exists exactly for 2022–2026 and brackets the playfield', () => {
    for (const f of FIELDS) {
      if (f.year >= 2022) {
        expect(f.imageRendered, `${f.id} imageRendered`).toBeDefined();
        const rect = fieldImageWorldRect(f.imageRendered!, f.lengthM, f.widthM);
        expect(rect.left).toBeLessThanOrEqual(0.001);
        expect(rect.bottom).toBeLessThanOrEqual(0.001);
        expect(rect.right).toBeGreaterThanOrEqual(f.lengthM - 0.001);
        expect(rect.top).toBeGreaterThanOrEqual(f.widthM - 0.001);
        // The renders carry generous outer margins — the 2022 sheet draws
        // the full arena floor (≈ 4.4 m of slack past the playfield).
        expect(rect.right - f.lengthM).toBeLessThan(6);
        expect(rect.top - f.widthM).toBeLessThan(6);
      } else {
        expect(f.imageRendered, `${f.id} should have no render`).toBeUndefined();
      }
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

  it('the 2025 schematic uses the artist calibration: uniform 200 px/m, walls at the canvas edges', () => {
    const f = fieldById('reefscape-2025');
    const img = f.image!;
    expect(img.ppm).toBe(200);
    expect(img.originPx).toBeUndefined(); // uniform margin-0, not corner-point
    // Margin-0 maps the canvas onto the enclosure frame exactly (the
    // canvas's 2–7 mm rounding is absorbed by the uniform mapping).
    const rect = fieldImageWorldRect(img, f.lengthM, f.widthM);
    expect(rect.left).toBeCloseTo(0, 6);
    expect(rect.bottom).toBeCloseTo(0, 6);
    expect(rect.right).toBeCloseTo(f.lengthM, 9);
    expect(rect.top).toBeCloseTo(f.widthM, 9);
  });
});

describe('withFieldVariant', () => {
  it('welded + schematic (or a variant-less field) returns the package itself', () => {
    const f = fieldById('reefscape-2025');
    expect(withFieldVariant(f, 'welded')).toBe(f);
    const older = fieldById('crescendo-2024');
    expect(withFieldVariant(older, 'andymark')).toBe(older); // no AM data → identity
  });

  it('2025 AndyMark swaps tags for every style; the artwork follows the style', () => {
    const base = fieldById('reefscape-2025');
    // Schematic (default): single artwork, tags-only switching — like 2026.
    const amSchematic = withFieldVariant(base, 'andymark');
    expect(amSchematic.aprilTags).toBe(base.aprilTagsAndyMark);
    expect(amSchematic.image).toBe(base.image);
    // Rendered: the official construction pair swaps with the variant.
    const amRendered = withFieldVariant(base, 'andymark', 'rendered');
    expect(amRendered.aprilTags).toBe(base.aprilTagsAndyMark);
    expect(amRendered.image).toBe(base.imageRenderedAndyMark);
    const weldedRendered = withFieldVariant(base, 'welded', 'rendered');
    expect(weldedRendered.image).toBe(base.imageRendered);
    expect(weldedRendered.aprilTags).toBe(base.aprilTags);
    // The variant layouts really differ where the constructions do (the
    // coral-station tags move ~7 cm along x; the reef tags are identical).
    const w3 = base.aprilTags!.find((t) => t.id === 3)!;
    const a3 = amSchematic.aprilTags!.find((t) => t.id === 3)!;
    expect(Math.abs(w3.x - a3.x)).toBeGreaterThan(0.05);
    const w7 = base.aprilTags!.find((t) => t.id === 7)!;
    const a7 = amSchematic.aprilTags!.find((t) => t.id === 7)!;
    expect(w7.x).toBeCloseTo(a7.x, 6);
  });

  it('2026 AndyMark swaps tags only per style — upstream ships one artwork per style', () => {
    const base = fieldById('rebuilt-2026');
    const am = withFieldVariant(base, 'andymark');
    expect(am.aprilTags).toBe(base.aprilTagsAndyMark);
    expect(am.image).toBe(base.image); // same reference, no AM calibration
    const amRendered = withFieldVariant(base, 'andymark', 'rendered');
    expect(amRendered.aprilTags).toBe(base.aprilTagsAndyMark);
    expect(amRendered.image).toBe(base.imageRendered); // one render, both variants
  });

  it('requesting a style a season lacks falls back to its only artwork', () => {
    const f = fieldById('powerup-2018');
    expect(withFieldVariant(f, 'welded', 'rendered')).toBe(f); // no render field → identity
  });

  it('the 2025 rendered calibrations bracket the enclosure frame', () => {
    const f = fieldById('reefscape-2025');
    for (const img of [f.imageRendered, f.imageRenderedAndyMark]) {
      expect(img).toBeDefined();
      const rect = fieldImageWorldRect(img!, f.lengthM, f.widthM);
      expect(rect.left).toBeLessThanOrEqual(0.001);
      expect(rect.bottom).toBeLessThanOrEqual(0.001);
      expect(rect.right).toBeGreaterThanOrEqual(f.lengthM - 0.001);
      expect(rect.top).toBeGreaterThanOrEqual(f.widthM - 0.001);
      // Generous outer margins (the artwork carries run-off floor), same
      // budget as the 2018–2020 AdvantageScope renders.
      expect(rect.right - f.lengthM).toBeLessThan(3.5);
      expect(rect.top - f.widthM).toBeLessThan(3.5);
      // Carpet edges land where the calibration was measured: blue corner
      // 420 px from the left, 74 px from the bottom.
      expect(img!.originPx).toEqual({ x: 420, y: 74 });
    }
  });
});
