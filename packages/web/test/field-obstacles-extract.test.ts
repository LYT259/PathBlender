/**
 * Dependency-free GLB → blue-world obstacle footprint extraction library
 * (scripts/field-obstacles/extract.mjs). The transform contract is the one
 * already registration-verified against these same shipped assets in
 * src/field3d-frame.ts (≤ 11–15 mm authoring noise, see field3d-model.test.ts
 * header) — native Y-up → config-mirror (Rx90 → reflect Z; Rz180·Rx90 →
 * reflect X) → world x = cx − X, y = cy − Z, height = Y.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseGlb,
  localMatrix,
  elementGroups,
  makeNativeToWorld,
  monotoneChainHull,
  hullPointsOfGroup,
} from '../../../scripts/field-obstacles/extract.mjs';

/** Hand-assemble a GLB: header + JSON chunk + BIN chunk (field3d-model.test.ts layout). */
function buildGlb(json, bin) {
  // JSON chunks pad with spaces (0x20) — NUL padding breaks JSON.parse.
  const jsonBuf = Buffer.from(JSON.stringify(json) + ' '.repeat((4 - (JSON.stringify(json).length % 4)) % 4), 'utf8');
  const jsonLen = jsonBuf.length;
  const binLen = bin.length + ((4 - (bin.length % 4)) % 4);
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); // 'glTF'
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLen, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
  jsonBuf.copy(out, 20);
  const binOff = 20 + jsonLen;
  out.writeUInt32LE(binLen, binOff);
  out.writeUInt32LE(0x004e4942, binOff + 4); // 'BIN'
  bin.copy(out, binOff + 8);
  return out;
}

/** Synthetic element: root → one assembly node (TRS) → one mesh with 5 verts. */
function fixtureGlb() {
  // Native-frame local vertices: a 1 m square at height 0.5 plus one apex
  // vertex at height 3 (above any sane bumper band).
  const verts = [
    [0, 0.5, 0], [1, 0.5, 0], [1, 0.5, 1], [0, 0.5, 1], [0.5, 3, 0.5],
  ];
  const bin = Buffer.concat(verts.map((v) => {
    const b = Buffer.alloc(12);
    b.writeFloatLE(v[0], 0);
    b.writeFloatLE(v[1], 4);
    b.writeFloatLE(v[2], 8);
    return b;
  }));
  const min = [0, 0.5, 0];
  const max = [1, 3, 1];
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'FE-TEST: FIXTURE', children: [1] },
      { name: 'GE-90001: TestElement <1>', translation: [0.1, 0, 0.2], mesh: 0 },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{
      bufferView: 0, componentType: 5126, count: 5, type: 'VEC3', min, max,
    }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    buffers: [{ byteLength: bin.length }],
  };
  return { glb: buildGlb(json, bin), bin };
}

describe('parseGlb', () => {
  it('returns the JSON chunk and BIN buffer', () => {
    const { glb, bin } = fixtureGlb();
    const { json } = parseGlb(glb);
    expect(json.nodes).toHaveLength(2);
    expect(json.nodes[1].name).toBe('GE-90001: TestElement <1>');
    expect(json.accessors[0].count).toBe(5);
  });
});

describe('localMatrix', () => {
  it('composes TRS identically to hand-multiplied 4x4 for translation [1,2,3], rotZ 90°, scale [2,2,2]', () => {
    const q = Math.SQRT1_2;
    const m = localMatrix({
      translation: [1, 2, 3],
      rotation: [0, 0, q, q],
      scale: [2, 2, 2],
    });
    // Hand-multiplied T·R·S, row-major: R·S = [[0,-2,0],[2,0,0],[0,0,2]].
    expect(m).toEqual([
      [0, -2, 0, 1],
      [2, 0, 0, 2],
      [0, 0, 2, 3],
      [0, 0, 0, 1],
    ]);
  });

  it('reads a column-major node.matrix transposed into row-major', () => {
    // Translation-only matrix, glTF column-major: [1,0,0,0, 0,1,0,0, 0,0,1,0, 4,5,6,1]
    const m = localMatrix({ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1] });
    expect(m).toEqual([
      [1, 0, 0, 4],
      [0, 1, 0, 5],
      [0, 0, 1, 6],
      [0, 0, 0, 1],
    ]);
  });
});

describe('makeNativeToWorld', () => {
  it('mirror "z" maps the documented example: native (1, 0.5, 2) → world (7.27, 6.035, height 0.5)', () => {
    // mirror 'z': render (X, Y, Z) = (1, 0.5, −2) → world x = 8.27 − 1 = 7.27,
    // world y = 4.035 − (−2) = 6.035, height = Y = 0.5.
    const toWorld = makeNativeToWorld('z', 8.27, 4.035);
    const p = toWorld([1, 0.5, 2]);
    expect(p.x).toBeCloseTo(7.27, 12);
    expect(p.y).toBeCloseTo(6.035, 12);
    expect(p.height).toBeCloseTo(0.5, 12);
  });

  it('mirror "x" maps native (1, 0.5, 2) → world (9.27, 2.035, height 0.5)', () => {
    // mirror 'x': render (−1, 0.5, 2) → x = 8.27 + 1, y = 4.035 − 2.
    const toWorld = makeNativeToWorld('x', 8.27, 4.035);
    const p = toWorld([1, 0.5, 2]);
    expect(p.x).toBeCloseTo(9.27, 12);
    expect(p.y).toBeCloseTo(2.035, 12);
    expect(p.height).toBeCloseTo(0.5, 12);
  });
});

describe('monotoneChainHull', () => {
  it('returns the CCW square hull of 5 points including an interior point, throws on 3 collinear points', () => {
    const hull = monotoneChainHull([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0.5, y: 0.5 },
    ]);
    expect(hull).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
    ]);
    expect(() => monotoneChainHull([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toThrow();
  });
});

describe('hullPointsOfGroup', () => {
  it('filters by z band and reports the in-band z range', () => {
    const { glb } = fixtureGlb();
    const { json, bin } = parseGlb(glb);
    const groups = elementGroups(json);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('GE-90001: TestElement <1>');
    // toWorld identity-centred mirror 'z': world x = −x_n, world y = +z_n.
    const { hull, zMinM, zMaxM, vertexCount } = hullPointsOfGroup(json, bin, groups[0], {
      zMin: 0,
      zMax: 1.5,
      toWorld: makeNativeToWorld('z', 0, 0),
    });
    // Native square corners (0.1..1.1, z 0.2..1.2) → world (−1.1..−0.1, 0.2..1.2);
    // apex at height 3 excluded by the band. CCW in the world frame.
    expect(hull).toEqual([
      { x: -1.1, y: 0.2 }, { x: -0.1, y: 0.2 }, { x: -0.1, y: 1.2 }, { x: -1.1, y: 1.2 },
    ]);
    expect(zMinM).toBeCloseTo(0.5, 9);
    expect(zMaxM).toBeCloseTo(0.5, 9);
    expect(vertexCount).toBe(4);
  });
});

describe('real 2026 GLB', () => {
  it('parses: > 3000 nodes, root element groups are non-empty', () => {
    const glb = readFileSync(resolve(__dirname, '../public/fields3d/2026-rebuilt/model.glb'));
    const { json } = parseGlb(glb);
    expect(json.nodes.length).toBeGreaterThan(3000);
    const groups = elementGroups(json);
    expect(groups.length).toBeGreaterThan(10);
    for (const g of groups) {
      expect(g.name.length).toBeGreaterThan(0);
      expect(g.nodeIndices.length).toBeGreaterThan(0);
    }
    // The documented assembly naming shows up (plan: 'GE-26100: Bump <1>' etc.).
    expect(groups.some((g) => /^GE-/.test(g.name))).toBe(true);
  });
});

// ---- Task 5: season config + committed 2026 data validation ----
// Manual source of record for 2026 classification and dimensions:
// 2026 Game Manual §5 (ARENA), https://www.frcmanual.com/2026/arena
import { readFileSync as rsf } from 'node:fs';
import { FIELD_OBSTACLE_DATA, REBUILT_2026, type AprilTag } from '@pathblender/core';
import { configMirrorAxis as srcConfigMirrorAxis, FIELD3D_MODELS } from '../src/field3d-frame';
import {
  SEASONS,
  extractSeason,
  pointNearHull,
  configMirrorAxis as cfgMirror,
} from '../../../scripts/field-obstacles/seasons.mjs';

const within = (got: number, expectM: number, tol: number) => {
  expect(Math.abs(got - expectM), `got ${got}, want ${expectM} ±${tol}`).toBeLessThanOrEqual(tol);
};
const span = (hull: { x: number; y: number }[], axis: 'x' | 'y') =>
  Math.max(...hull.map((p) => p[axis])) - Math.min(...hull.map((p) => p[axis]));
const center = (hull: { x: number; y: number }[], axis: 'x' | 'y') =>
  (Math.max(...hull.map((p) => p[axis])) + Math.min(...hull.map((p) => p[axis]))) / 2;

describe('season config + 2026 REBUILT data', () => {
  const season = SEASONS.find((s) => s.fieldId === 'rebuilt-2026');
  const set = FIELD_OBSTACLE_DATA['rebuilt-2026'];

  it('2026 data exists and every element id is mapped in the season config', () => {
    expect(season).toBeDefined();
    expect(set?.welded.length).toBeGreaterThan(0);
    const includeIds = new Set(season!.elements.filter((e) => e.action === 'include').map((e) => e.id));
    expect(includeIds.size).toBeGreaterThan(0);
    for (const o of set!.welded) {
      const base = o.id.replace(/-(blue|red)$/, '');
      expect(includeIds.has(base), `${o.id} has no include row`).toBe(true);
    }
  });

  it('blue hub hull matches the official manual: 47 in (1.1938 m) square, near face on the starting line 158.6 in (4.0284 m) from the alliance wall, centered on the midline', () => {
    // 2026 Game Manual §5.4 (47 in square prism, 158.6 in from the ALLIANCE
    // WALL) + §5.3 (ROBOT STARTING LINE at the ALLIANCE ZONE edge), same
    // derivation as field.ts REBUILT_2026.startRegions. Tolerance 2 cm =
    // measured AdvantageScopeAssets authoring noise (field3d-model.test.ts
    // header: ≤ 11–15 mm) + margin.
    const hub = set!.welded.find((o) => o.id === 'hub-blue')!;
    expect(hub).toBeDefined();
    within(span(hub.hull, 'x'), 1.1938, 0.02);
    within(span(hub.hull, 'y'), 1.1938, 0.02);
    within(Math.min(...hub.hull.map((p) => p.x)), 4.0284, 0.02);
    within(center(hub.hull, 'y'), 4.0346, 0.02);
  });

  it('2026 welded AprilTags anchor on their included elements: hub tags (manual §5.10 IDs) and tower-wall tags lie on/inside their hulls', () => {
    // §5.10: HUB tag IDs are 2,3,4,5,8,9,10,11,18,19,20,21,24,25,26,27; the
    // WPILib welded layout splits them x<8.27 → blue hub, x>8.27 → red hub.
    // Tower-wall tags 15/16 (red) and 31/32 (blue) at z=0.5524 (<1.0 m).
    // Tags are read from REBUILT_2026.aprilTags — never re-typed.
    const tags = new Map<number, AprilTag>(REBUILT_2026.aprilTags!.map((t) => [t.id, t]));
    const byId = new Map(set!.welded.map((o) => [o.id, o]));
    for (const anchor of season!.tagAnchors) {
      const hull = byId.get(anchor.obstacleId)!.hull;
      for (const id of anchor.tagIds) {
        const tag = tags.get(id)!;
        expect(tag, `tag ${id} missing from layout`).toBeDefined();
        expect(
          pointNearHull({ x: tag.x, y: tag.y }, hull, 0.05),
          `${anchor.obstacleId} anchor tag ${id} at (${tag.x}, ${tag.y}) not on/inside hull`,
        ).toBe(true);
      }
    }
    // The anchor sets cover exactly the manual's HUB ids on the hubs.
    const anchored = season!.tagAnchors.filter((a) => a.obstacleId.startsWith('hub-')).flatMap((a) => a.tagIds);
    expect([...anchored].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 8, 9, 10, 11, 18, 19, 20, 21, 24, 25, 26, 27]);
  });

  it('excluded 2026 elements (trench, bump, outpost, depot, fuel, markings, perimeter) appear in the config exclusion list with a citation and contribute no hulls', () => {
    const excluded = season!.elements.filter((e) => e.action === 'exclude');
    for (const id of ['trench', 'bump', 'outpost', 'depot', 'fuel', 'perimeter', 'markings']) {
      const row = excluded.find((e) => e.id === id);
      expect(row, `exclusion row ${id}`).toBeDefined();
      expect(row!.citation.length).toBeGreaterThan(0);
    }
    const hullIds = set!.welded.map((o) => o.id.replace(/-(blue|red)$/, ''));
    for (const id of ['trench', 'bump', 'outpost', 'depot', 'fuel', 'perimeter', 'markings']) {
      expect(hullIds, `${id} must contribute no hull`).not.toContain(id);
    }
  });

  it('every hull vertex of every 2026 obstacle lies inside the playfield ± 0.05 m', () => {
    for (const o of set!.welded) {
      for (const p of o.hull) {
        expect(p.x, `${o.id} x`).toBeGreaterThanOrEqual(-0.05);
        expect(p.x, `${o.id} x`).toBeLessThanOrEqual(REBUILT_2026.lengthM + 0.05);
        expect(p.y, `${o.id} y`).toBeGreaterThanOrEqual(-0.05);
        expect(p.y, `${o.id} y`).toBeLessThanOrEqual(REBUILT_2026.widthM + 0.05);
      }
    }
  });

  it('season config mirror values equal configMirrorAxis(fields3d/<dir>/config.json rotations) for every configured season', () => {
    for (const s of SEASONS) {
      const cfg = JSON.parse(rsf(resolve(__dirname, `../public/fields3d/${s.glbDir.welded}/config.json`), 'utf8'));
      expect(cfgMirror(cfg.rotations), s.fieldId).toBe(srcConfigMirrorAxis(cfg.rotations));
      expect(cfgMirror(cfg.rotations), s.fieldId).toBe(FIELD3D_MODELS[s.fieldId]!.mirror);
    }
  });

  it('regenerating from the GLBs reproduces the committed data', async () => {
    const regen = await extractSeason(season!);
    const round = (v: unknown): unknown => {
      if (typeof v === 'number') return Math.round(v * 1e4) / 1e4;
      if (Array.isArray(v)) return v.map(round);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
      return v;
    };
    expect(round(regen)).toEqual(round(set));
  });
});

// ---- Task 6: seasons 2022-2025 (manuals: frcmanual.com/{2022,2023,2024,2025}/arena) ----
import { FIELDS } from '@pathblender/core';

const fieldByIdCore = (id: string) => FIELDS.find((f) => f.id === id)!;
const hullArea = (hull: { x: number; y: number }[]) => {
  let a = 0;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i]!;
    const q = hull[(i + 1) % hull.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

describe('seasons 2022-2025 data', () => {
  it('all five bundled seasons have obstacle sets; 2025 has distinct welded and andymark arrays', () => {
    const ids = ['rapidreact-2022', 'chargedup-2023', 'crescendo-2024', 'reefscape-2025', 'rebuilt-2026'];
    for (const id of ids) {
      expect(FIELD_OBSTACLE_DATA[id], id).toBeDefined();
      expect(FIELD_OBSTACLE_DATA[id]!.welded.length, id).toBeGreaterThan(0);
    }
    const set = FIELD_OBSTACLE_DATA['reefscape-2025']!;
    expect(set.andymark).toBeDefined();
    expect(set.andymark!.map((o) => o.id)).toEqual(set.welded.map((o) => o.id));
    // At least one hull must differ (artwork diff ~7 cm on the coral stations,
    // field.ts 2025 imageRendered comment) — identical sets mean the wrong
    // GLB was loaded for a variant.
    const differs = set.welded.some((o, i) =>
      JSON.stringify(o.hull) !== JSON.stringify(set.andymark![i]!.hull));
    expect(differs, 'welded and andymark 2025 sets are byte-identical').toBe(true);
  });

  it('2023 charge station contributes no hull (excluded, drive-on)', () => {
    const ids = FIELD_OBSTACLE_DATA['chargedup-2023']!.welded.map((o) => o.id);
    expect(ids.some((id) => id.includes('charge'))).toBe(false);
    const row = SEASONS.find((s) => s.fieldId === 'chargedup-2023')!.elements
      .find((e) => e.id === 'charge-station')!;
    expect(row.action).toBe('exclude');
    expect(row.citation).toContain('§5.4');
  });

  it('2024 stage legs produce disjoint per-leg hulls, not one spanning hull', () => {
    const legs = FIELD_OBSTACLE_DATA['crescendo-2024']!.welded.filter((o) => /stage.*leg/.test(o.id));
    // 2 stages × 3 legs = 6 (plan: >= 4 whose union area is far below a
    // spanning hull over one stage's footprint ~2.96 × 3.41 m).
    expect(legs.length).toBeGreaterThanOrEqual(6);
    const union = legs.reduce((s, o) => s + hullArea(o.hull), 0);
    const spanning = 2.9 * 3.4;
    expect(union / spanning, `union ${union} vs spanning ${spanning}`).toBeLessThan(0.35);
  });

  it('2025 barge contributes only its center post (overhead truss/cages excluded, manual §5.4)', () => {
    const barge = FIELD_OBSTACLE_DATA['reefscape-2025']!.welded.filter((o) => o.id.startsWith('barge'));
    expect(barge).toHaveLength(1);
    expect(barge[0]!.id).toBe('barge-post');
    const spansX = Math.max(...barge[0]!.hull.map((p) => p.x)) - Math.min(...barge[0]!.hull.map((p) => p.x));
    expect(spansX).toBeLessThan(1.0);
  });

  it('per-season tag anchors validate (2025 reef faces, 2024 speaker/source walls, 2023 grids/substation)', () => {
    // Anchor admissibility: mounted on an included element, z checked per
    // set (reef face tags 0.3081 m §5.8; speaker wall tags 1.45 m §5.8 — the
    // wall plane is flush above the subwoofer; source wall tags 1.36 m §5.8;
    // grid tags 0.4628 m / substation tags 0.6955 m 2023 §5.9.2). Reef-top
    // barge tags (4/5/14/15, 1.87 m, 30° lean) and 2024 stage-core tags
    // (11–16, suspended core) are excluded by the z<1.0 + mounted-on-element
    // rule; 2022 ships no tags (FIELD3D_MODELS comment).
    const expectations: Array<[string, string, number[]]> = [
      ['reefscape-2025', 'reef-blue', [17, 18, 19, 20, 21, 22]],
      ['reefscape-2025', 'reef-red', [6, 7, 8, 9, 10, 11]],
      ['reefscape-2025', 'coral-station-blue-low', [12]],
      ['reefscape-2025', 'coral-station-blue-high', [13]],
      ['reefscape-2025', 'coral-station-red-low', [1]],
      ['reefscape-2025', 'coral-station-red-high', [2]],
      ['crescendo-2024', 'speaker-blue', [7, 8]],
      ['crescendo-2024', 'speaker-red', [3, 4]],
      ['crescendo-2024', 'source-blue', [9, 10]],
      ['crescendo-2024', 'source-red', [1, 2]],
      ['chargedup-2023', 'grid-blue', [6, 7, 8]],
      ['chargedup-2023', 'grid-red', [1, 2, 3]],
      ['chargedup-2023', 'substation-blue', [5]],
      ['chargedup-2023', 'substation-red', [4]],
    ];
    for (const [fieldId, obstacleId, tagIds] of expectations) {
      const field = fieldByIdCore(fieldId);
      const tags = new Map<number, AprilTag>(field.aprilTags!.map((t) => [t.id, t]));
      for (const variant of ['welded', 'andymark'] as const) {
        const set = FIELD_OBSTACLE_DATA[fieldId]!;
        if (variant === 'andymark' && !set.andymark) continue;
        const obs = (variant === 'welded' ? set.welded : set.andymark)!.find((o) => o.id === obstacleId)!;
        for (const id of tagIds) {
          const tag = tags.get(id)!;
          expect(
            pointNearHull({ x: tag.x, y: tag.y }, obs.hull, 0.05),
            `${fieldId}/${variant}/${obstacleId} anchor tag ${id}`,
          ).toBe(true);
        }
      }
    }
  });

  it('manual dims validate where the config carries them', () => {
    // Spot-check one load-bearing dim per season against its manual value;
    // the CLI validates every row on regeneration.
    const reef = FIELD_OBSTACLE_DATA['reefscape-2025']!.welded.find((o) => o.id === 'reef-blue')!;
    const xs = reef.hull.map((p) => p.x);
    within(Math.max(...xs) - Math.min(...xs), 1.6637, 0.02); // §5.3 5 ft 5½ in hexagon
    within(Math.min(...xs), 3.6576, 0.02); // §5.3 12 ft from the ALLIANCE WALL (near face)
    const grid = FIELD_OBSTACLE_DATA['chargedup-2023']!.welded.find((o) => o.id === 'grid-blue')!;
    within(span(grid.hull, 'y'), 5.4991, 0.02); // §5.5 18 ft ½ in wide
    const speaker = FIELD_OBSTACLE_DATA['crescendo-2024']!.welded.find((o) => o.id === 'speaker-blue')!;
    within(Math.max(...speaker.hull.map((p) => p.x)), 0.9171, 0.02); // §5.6.1 subwoofer 3 ft ⅛ in
    const hub22 = FIELD_OBSTACLE_DATA['rapidreact-2022']!.welded.find((o) => o.id === 'hub')!;
    within(center(hub22.hull, 'x'), 8.2296, 0.02); // §5.3 "centered on the FIELD"
    within(center(hub22.hull, 'y'), 4.1148, 0.02);
  });

  it('regeneration reproduces committed data for all seasons', async () => {
    const round = (v: unknown): unknown => {
      if (typeof v === 'number') return Math.round(v * 1e4) / 1e4;
      if (Array.isArray(v)) return v.map(round);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
      return v;
    };
    expect(SEASONS.length).toBe(5);
    for (const s of SEASONS) {
      const regen = await extractSeason(s);
      expect(round(regen), s.fieldId).toEqual(round(FIELD_OBSTACLE_DATA[s.fieldId]));
    }
  });
});
