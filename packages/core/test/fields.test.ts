/**
 * Season field registry: 2019–2026 packages, corner-point calibration math,
 * and the artwork-style (schematic/rendered) resolution. 2019–2020 carry the
 * AdvantageScope render as their only art; 2022–2026 ship the PathPlanner
 * schematic as the primary artwork plus an AS render (see field.ts comments).
 */
import { describe, expect, it } from 'vitest';
import type { Trajectory } from '../src';
import { FIELDS, REBUILT_2026, fieldById, fieldImageWorldRect, makeCustomField, routeStartRegion, startsInAllianceZone, withFieldVariant } from '../src';

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

describe('legal starting regions per season (first-leg gate, user 2026-10-08)', () => {
  const traj = (x: number, y = 4) =>
    ({ samples: [{ t: 0, x, y, heading: 0, vx: 0, vy: 0, omega: 0 }] }) as unknown as Trajectory;
  const zoneOf = (id: string) => fieldById(id)!.startZone!;

  it('carries zones for every season 2022–2026', () => {
    const byYear = new Map(FIELDS.map((f) => [f.year, f.startZone !== undefined]));
    expect(byYear.get(2022)).toBe(true);
    expect(byYear.get(2023)).toBe(true);
    expect(byYear.get(2024)).toBe(true);
    expect(byYear.get(2025)).toBe(true);
    expect(byYear.get(2026)).toBe(true);
  });

  it('2022: the hub-flanking TARMAC band — mid-field, NOT the wall strip', () => {
    const z = zoneOf('rapidreact-2022');
    // Real sampled starts land inside (Team3128 (7.64,1.48), 1757 (6.12,5.15),
    // gwhs Tarmac-A (8.20,1.85)).
    for (const [x, y] of [[7.64, 1.48], [6.12, 5.15], [8.20, 1.85], [4.94, 1.96], [6.80, 6.27]] as [number, number][]) {
      expect(startsInAllianceZone(traj(x, y), z)).toBe(true);
    }
    // Against the alliance wall, deep past the hub, or high on the walls: out.
    expect(startsInAllianceZone(traj(1.0, 4.0), z)).toBe(false);
    expect(startsInAllianceZone(traj(10.0, 4.0), z)).toBe(false);
    expect(startsInAllianceZone(traj(6.0, 0.5), z)).toBe(false);
    expect(startsInAllianceZone(traj(6.0, 7.8), z)).toBe(false);
  });

  it('2026: wall to 4.0284 m, full width — the manual zone, line included', () => {
    const z = zoneOf('rebuilt-2026');
    expect(startsInAllianceZone(traj(0), z)).toBe(true);
    expect(startsInAllianceZone(traj(1, 0.1), z)).toBe(true);
    expect(startsInAllianceZone(traj(4.0284, 8.069), z)).toBe(true); // the line itself
    expect(startsInAllianceZone(traj(4.0285), z)).toBe(false);
    expect(startsInAllianceZone(traj(-0.01), z)).toBe(false);
  });

  it('2025: the ROBOT STARTING LINE band at x≈6.72 — not the wall strip', () => {
    const z = zoneOf('reefscape-2025');
    expect(startsInAllianceZone(traj(1.0), z)).toBe(false); // against the wall: illegal
    expect(startsInAllianceZone(traj(6.5), z)).toBe(true);  // on the line
    expect(startsInAllianceZone(traj(7.1), z)).toBe(true);
    expect(startsInAllianceZone(traj(8.3), z)).toBe(false); // inside the barge zone
    // The band is full width; a hair beyond either edge is out.
    expect(startsInAllianceZone(traj(6.7, 0), z)).toBe(true);
    expect(startsInAllianceZone(traj(6.7, 8.052), z)).toBe(true);
    expect(startsInAllianceZone(traj(6.7, 8.2), z)).toBe(false);
  });

  it('2024: the ROBOT STARTING ZONE — shallow strip between the corner zones', () => {
    const z = zoneOf('crescendo-2024');
    expect(startsInAllianceZone(traj(1.0, 4.0), z)).toBe(true);
    expect(startsInAllianceZone(traj(1.9336, 4.0), z)).toBe(true);  // tape edge in
    expect(startsInAllianceZone(traj(2.0, 4.0), z)).toBe(false);    // past the zone line
    expect(startsInAllianceZone(traj(1.0, 0.542), z)).toBe(true);   // just inside the source-side tape
    expect(startsInAllianceZone(traj(1.0, 0.5), z)).toBe(false);    // source corner
    expect(startsInAllianceZone(traj(1.0, 7.7584), z)).toBe(true);  // amp-side tape edge
    expect(startsInAllianceZone(traj(1.0, 7.9), z)).toBe(false);    // amp corner
  });

  it('2023: the COMMUNITY — centered, deeper in front of the charge station', () => {
    const z = zoneOf('chargedup-2023');
    expect(startsInAllianceZone(traj(3.0, 4.0), z)).toBe(true);   // side depth 3.36 m
    expect(startsInAllianceZone(traj(4.0, 4.0), z)).toBe(true);   // center deep strip
    expect(startsInAllianceZone(traj(5.0, 4.0), z)).toBe(false);  // past even the deep boundary
    expect(startsInAllianceZone(traj(3.0, 1.2649), z)).toBe(true);   // community y-edge, shallow depth
    expect(startsInAllianceZone(traj(3.0, 1.2), z)).toBe(false);     // loading zone corner
    expect(startsInAllianceZone(traj(3.0, 6.7513), z)).toBe(true);
    expect(startsInAllianceZone(traj(3.0, 6.9), z)).toBe(false);
    expect(startsInAllianceZone(traj(3.5, 2.0), z)).toBe(false);  // deep only in the CS strip
    expect(startsInAllianceZone(traj(4.5, 2.79), z)).toBe(true);  // CS strip lower edge
    expect(startsInAllianceZone(traj(4.5, 2.7), z)).toBe(false);
  });

  it('never gates a trajectory without samples', () => {
    for (const id of ['rebuilt-2026', 'reefscape-2025']) {
      expect(startsInAllianceZone({ samples: [] } as unknown as Trajectory, zoneOf(id))).toBe(true);
    }
  });
});

describe('routeStartRegion (2026 grouping)', () => {
  const regions = REBUILT_2026.startRegions;
  const traj = (x: number, y = 4) =>
    ({ samples: [{ t: 0, x, y, heading: 0, vx: 0, vy: 0, omega: 0 }] }) as unknown as Trajectory;
  const at = (x: number, y: number) => routeStartRegion(traj(x, y), regions);

  it('classes real under-arm TRENCH starts (11019 L1 spot and the 8814 staging 0.26 m short)', () => {
    expect(at(4.42, 7.62)).toBe('trench');   // 11019 L1/L4/L6/L8, 8814 LC*
    expect(at(3.97, 7.42)).toBe('trench');   // 11019 L11
    expect(at(3.53, 7.66)).toBe('trench');   // 8814 FCeSt — bumper at the opening
    expect(at(3.52, 7.61)).toBe('trench');   // 11019 L12 — inside the 0.40 m approach grace
    expect(at(4.62, 0.64)).toBe('trench');   // lower arm opening center (trench tags 17/28)
  });

  it('classes pushed-against-HUB starts and nothing near them', () => {
    expect(at(3.55, 4.02)).toBe('hub');      // 11019 M1/M3
    expect(at(3.63, 4.01)).toBe('hub');      // 8814 MSm
    expect(at(3.08, 5.57)).toBeUndefined();  // 11019 L5 cluster — mid-area, 1.33 m from the hub
    expect(at(2.43, 4.04)).toBeUndefined();  // M2 — centerline, 1.6 m back
  });

  it('keeps the approach grace honest — 1.18 m short of the arm is NOT trench', () => {
    expect(at(2.61, 6.89)).toBeUndefined();  // 8814 SCsS stages well before the trench
    expect(at(1.20, 5.56)).toBeUndefined();  // 8814 StR — open alliance area
  });

  it('returns undefined for seasons without classes and for empty routes', () => {
    expect(routeStartRegion(traj(4.42, 7.62), undefined)).toBeUndefined();
    expect(routeStartRegion(traj(4.42, 7.62), [])).toBeUndefined();
    expect(routeStartRegion({ samples: [] } as unknown as Trajectory, regions)).toBeUndefined();
  });

  it('only 2026 defines grouping classes today; every id has the shape web i18n keys use', () => {
    for (const f of FIELDS) {
      if (f.id !== REBUILT_2026.id) expect(f.startRegions).toBeUndefined();
    }
    for (const region of REBUILT_2026.startRegions ?? []) {
      expect(region.id).toMatch(/^[a-z][a-zA-Z]*$/);
    }
  });
});
