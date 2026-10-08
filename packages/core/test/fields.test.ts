/**
 * Season field registry: 2019–2026 packages, corner-point calibration math,
 * and the artwork-style (schematic/rendered) resolution. 2019–2020 carry the
 * AdvantageScope render as their only art; 2022–2026 ship the PathPlanner
 * schematic as the primary artwork plus an AS render (see field.ts comments).
 */
import { describe, expect, it } from 'vitest';
import type { Trajectory } from '../src';
import { FIELDS, REBUILT_2026, fieldById, fieldImageWorldRect, makeCustomField, startsInAllianceZone, withFieldVariant } from '../src';

describe('FIELDS registry', () => {
  it('covers 2022 through 2026', () => {
    const years = FIELDS.map((f) => f.year);
    expect(years).toEqual([2022, 2023, 2024, 2025, 2026]);
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

  it('the 2022 rendered artwork carries a corner calibration that brackets the playfield', () => {
    {
      const f = fieldById('rapidreact-2022');
      const img = f.imageRendered!;
      expect(img.originPx).toBeDefined();
      const rect = fieldImageWorldRect(img, f.lengthM, f.widthM);
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
      // budget as the 2019–2020 AdvantageScope renders.
      expect(rect.right - f.lengthM).toBeLessThan(3.5);
      expect(rect.top - f.widthM).toBeLessThan(3.5);
      // Carpet edges land where the calibration was measured: blue corner
      // 420 px from the left, 74 px from the bottom.
      expect(img!.originPx).toEqual({ x: 420, y: 74 });
    }
  });
});

describe('alliance start zone (2026 ALLIANCE ZONE, first-leg gate)', () => {
  const traj = (x: number) => ({ samples: [{ t: 0, x, y: 4, heading: 0, vx: 0, vy: 0, omega: 0 }] }) as unknown as Trajectory;
  it('2026 carries the manual zone depth; no earlier season defines one', () => {
    for (const f of FIELDS) {
      expect(f.allianceStartZoneM).toBe(f.year === 2026 ? 4.0284 : undefined);
    }
  });
  it('tests the blue-frame source: both alliances mirror to the same predicate', () => {
    const z = REBUILT_2026.allianceStartZoneM!;
    expect(startsInAllianceZone(traj(0), z)).toBe(true);
    expect(startsInAllianceZone(traj(1.0), z)).toBe(true);
    expect(startsInAllianceZone(traj(z), z)).toBe(true); // the line itself
    expect(startsInAllianceZone(traj(z + 0.001), z)).toBe(false);
    expect(startsInAllianceZone(traj(5.0), z)).toBe(false);
    // Slightly behind the wall is not a start either.
    expect(startsInAllianceZone(traj(-0.01), z)).toBe(false);
  });
  it('never gates a trajectory without samples', () => {
    expect(startsInAllianceZone({ samples: [] } as unknown as Trajectory, 4.0284)).toBe(true);
  });
});
