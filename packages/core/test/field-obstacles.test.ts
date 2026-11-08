import { describe, expect, it } from 'vitest';
import { FIELDS, makeCustomField, obstaclesForField, FIELD_OBSTACLE_DATA } from '../src';

describe('obstaclesForField', () => {
  it('returns an empty set for custom fields', () => {
    expect(obstaclesForField(makeCustomField({ lengthM: 16, widthM: 8, ppm: 100, marginM: 0, pixelWidth: 1600, pixelHeight: 800 }), 'welded')).toEqual([]);
  });
  it('every key of FIELD_OBSTACLE_DATA is a bundled field id', () => {
    const ids = new Set(FIELDS.map((f) => f.id));
    for (const key of Object.keys(FIELD_OBSTACLE_DATA)) expect(ids.has(key)).toBe(true);
  });
});

describe('generated obstacle data integrity', () => {
  // Runs over whatever data exists — vacuous now, the guard for every later task.
  it('every hull is convex, counterclockwise, >= 3 points, inside its field, and ids are unique per variant set', () => {
    for (const [fieldId, set] of Object.entries(FIELD_OBSTACLE_DATA)) {
      const field = FIELDS.find((f) => f.id === fieldId)!;
      // Plan snippet artifact: it hoisted `seen` across variants, which fails
      // by construction for 2025's two variants (same id sets by design — the
      // variants differ in hulls, not ids). The test's own title says "unique
      // per variant set"; uniqueness is per variant array. (The snippet's
      // `as const` also widens the spread to string[]; pin the tuple type.)
      const variants: ReadonlyArray<'welded' | 'andymark'> = set.andymark
        ? ['welded', 'andymark']
        : ['welded'];
      for (const variant of variants) {
        const seen = new Set<string>();
        for (const o of set[variant] ?? []) {
          expect(seen.has(o.id), `${fieldId}/${variant}/${o.id} duplicate`).toBe(false);
          seen.add(o.id);
          expect(o.hull.length, `${o.id} hull < 3 points`).toBeGreaterThanOrEqual(3);
          // CCW signed area > 0
          let area = 0;
          for (let i = 0; i < o.hull.length; i++) {
            const a = o.hull[i]!, b = o.hull[(i + 1) % o.hull.length]!;
            area += a.x * b.y - b.x * a.y;
          }
          expect(area, `${o.id} not CCW`).toBeGreaterThan(0);
          // Convex: every consecutive cross product >= 0 (CCW)
          for (let i = 0; i < o.hull.length; i++) {
            const a = o.hull[i]!, b = o.hull[(i + 1) % o.hull.length]!, c = o.hull[(i + 2) % o.hull.length]!;
            const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
            expect(cross, `${o.id} hull not convex at ${i}`).toBeGreaterThanOrEqual(-1e-9);
          }
          for (const p of o.hull) {
            expect(p.x, `${o.id} outside field`).toBeGreaterThanOrEqual(-0.05);
            expect(p.x).toBeLessThanOrEqual(field.lengthM + 0.05);
            expect(p.y).toBeGreaterThanOrEqual(-0.05);
            expect(p.y).toBeLessThanOrEqual(field.widthM + 0.05);
          }
        }
      }
    }
  });
});
