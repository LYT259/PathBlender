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
