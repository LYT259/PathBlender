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
