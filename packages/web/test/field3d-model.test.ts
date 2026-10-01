/**
 * Official-model ↔ AprilTag-layout registration, checked per season and
 * construction variant with real numbers (report §6.7: no eyeballing).
 *
 * What is under test is the MODEL mount (the reflection in
 * `fieldModelScale`); the expected tag positions are computed here from the
 * WPILib layout constants in `@pathblender/core` plus two lines of centre
 * arithmetic — never by the production transform. The model-side positions
 * come from the shipped GLBs themselves: every tag decal mesh
 * (`FE-00083_*`) centre, read from the glTF accessors' min/max in the JSON
 * chunk (a square decal is centrally symmetric, so its AABB centre is its
 * geometric centre — vertex means are biased by triangulation density and
 * are NOT used).
 *
 * Sources of record:
 * - Layouts + 2025 enclosure dimensions: allwpilib
 *   fields/src/main/native/resources/org/wpilib/fields/frc/
 *   {2024-crescendo, 2025-reefscape-welded, 2025-reefscape-andymark,
 *   2026-rebuilt-welded}.json ("field-dimensions" 16.541 × 8.211,
 *   17.548 × 8.052, 17.548 × 8.042, 16.541 × 8.069; BSD-3).
 * - Mount semantics: AdvantageScope @ main,
 *   src/shared/renderers/field3d/workers/loadField.ts (config rotations
 *   premultiply in order) — codified here as `configMirrorAxis`.
 * - Residual tolerances below are the measured model-authoring noise of the
 *   AdvantageScopeAssets GLBs themselves: ≤ 11 mm horizontal, −12/+15 mm
 *   vertical across all 92 decals of the four 2024–2026 models.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FIELDS, fieldById, type AprilTag } from '@pathblender/core';
import {
  FIELD3D_MODELS,
  configMirrorAxis,
  fieldModelScale,
} from '../src/field3d-frame';
import cfg2022 from '../public/fields3d/2022-rapidreact/config.json';
import cfg2023 from '../public/fields3d/2023-chargedup/config.json';
import cfg2024 from '../public/fields3d/2024-crescendo/config.json';
import cfg2025w from '../public/fields3d/2025-reefscape-welded/config.json';
import cfg2025a from '../public/fields3d/2025-reefscape-andymark/config.json';
import cfg2026 from '../public/fields3d/2026-rebuilt/config.json';

const rotationsOf = (cfg: unknown) =>
  (cfg as { rotations: { axis: string; degrees: number }[] }).rotations;

interface Gltf {
  nodes: {
    name?: string;
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
  }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
}

/** Parse only the JSON chunk of a GLB — enough for node names + AABBs. */
function gltfJson(dir: string): Gltf {
  const path = resolve(__dirname, `../public/fields3d/${dir}/model.glb`);
  const buf = readFileSync(path);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const len = buf.readUInt32LE(8);
  let off = 12;
  while (off < len) {
    const clen = buf.readUInt32LE(off);
    const ctype = buf.readUInt32LE(off + 4);
    if (ctype === 0x4e4f534a) return JSON.parse(buf.toString('utf8', off + 8, off + 8 + clen));
    off += 8 + clen;
  }
  throw new Error(`no JSON chunk in ${path}`);
}

function localMatrix(n: Gltf['nodes'][number]): THREE.Matrix4 {
  if (n.matrix) return new THREE.Matrix4().fromArray(n.matrix);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
    new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
  );
}

/** id → native-frame decal centre (accessor-AABB centres, world-composed). */
function decalCenters(dir: string, pattern: RegExp): Map<number, THREE.Vector3> {
  const js = gltfJson(dir);
  const world = new Map<number, THREE.Matrix4>();
  const isChild = new Set<number>();
  for (const n of js.nodes) for (const c of n.children ?? []) isChild.add(c);
  const walk = (i: number, parent: THREE.Matrix4) => {
    const m = parent.clone().multiply(localMatrix(js.nodes[i]!));
    world.set(i, m);
    for (const c of js.nodes[i]!.children ?? []) walk(c, m);
  };
  js.nodes.forEach((n, i) => {
    if (!isChild.has(i)) walk(i, new THREE.Matrix4());
  });
  const sums = new Map<number, { sum: THREE.Vector3; n: number }>();
  js.nodes.forEach((n, i) => {
    const m = pattern.exec(n.name ?? '');
    if (!m || n.mesh === undefined) return;
    const id = Number(m[1]);
    const acc = sums.get(id) ?? { sum: new THREE.Vector3(), n: 0 };
    for (const prim of js.meshes[n.mesh]!.primitives) {
      const a = js.accessors[prim.attributes.POSITION]!;
      expect(a.min, `${dir} ${n.name}: POSITION accessor min/max`).toBeDefined();
      acc.sum.add(
        new THREE.Vector3(
          (a.min![0]! + a.max![0]!) / 2,
          (a.min![1]! + a.max![1]!) / 2,
          (a.min![2]! + a.max![2]!) / 2,
        ).applyMatrix4(world.get(i)!),
      );
      acc.n++;
    }
    sums.set(id, acc);
  });
  return new Map([...sums].map(([id, { sum, n }]) => [id, sum.divideScalar(n)]));
}

/** Where the app should show a tag: layout constants + centre arithmetic. */
function expectedRender(tag: AprilTag, cx: number, cy: number): THREE.Vector3 {
  return new THREE.Vector3(-(tag.x - cx), tag.z ?? 0.55, -(tag.y - cy));
}

const cases = [
  { field: 'crescendo-2024', dir: '2024-crescendo', cfg: cfg2024, tags: 'aprilTags' },
  { field: 'reefscape-2025', dir: '2025-reefscape-welded', cfg: cfg2025w, tags: 'aprilTags' },
  {
    field: 'reefscape-2025',
    dir: '2025-reefscape-andymark',
    cfg: cfg2025a,
    tags: 'aprilTagsAndyMark',
  },
  { field: 'rebuilt-2026', dir: '2026-rebuilt', cfg: cfg2026, tags: 'aprilTags' },
] as const;

describe('field-model mount derives from the shipped AdvantageScope configs', () => {
  it('the configs split exactly into the two documented families', () => {
    // [x 90°] → reflect Z (2023/2024/2026); [x 90°, z 180°] → reflect X
    // (2022/2025). Spelled out so a config edit that changes a season's
    // family fails loudly here rather than silently mis-mounting.
    expect(configMirrorAxis(rotationsOf(cfg2023))).toBe('z');
    expect(configMirrorAxis(rotationsOf(cfg2024))).toBe('z');
    expect(configMirrorAxis(rotationsOf(cfg2026))).toBe('z');
    expect(configMirrorAxis(rotationsOf(cfg2022))).toBe('x');
    expect(configMirrorAxis(rotationsOf(cfg2025w))).toBe('x');
    expect(configMirrorAxis(rotationsOf(cfg2025a))).toBe('x');
  });

  it('the FIELD3D_MODELS flags match the asset dirs one-to-one', () => {
    expect(FIELD3D_MODELS['crescendo-2024']!.mirror).toBe(configMirrorAxis(rotationsOf(cfg2024)));
    expect(FIELD3D_MODELS['reefscape-2025']!.mirror).toBe(configMirrorAxis(rotationsOf(cfg2025w)));
    expect(FIELD3D_MODELS['rebuilt-2026']!.mirror).toBe(configMirrorAxis(rotationsOf(cfg2026)));
    expect(FIELD3D_MODELS['rapidreact-2022']!.mirror).toBe(configMirrorAxis(rotationsOf(cfg2022)));
    expect(FIELD3D_MODELS['chargedup-2023']!.mirror).toBe(configMirrorAxis(rotationsOf(cfg2023)));
  });
});

describe('official models register tag-for-tag against the WPILib layouts', () => {
  const byId = new Map(FIELDS.map((f) => [f.id, f]));

  it.each(cases)('$dir: every decal lands on its layout tag', (c) => {
    const field = byId.get(c.field)!;
    const layout = field[c.tags] as AprilTag[] | undefined;
    expect(layout).toBeDefined();
    const entry = FIELD3D_MODELS[c.field]!;
    const centers = decalCenters(c.dir, entry.tagDecal!);
    expect([...centers.keys()].sort((a, b) => a - b)).toEqual(
      layout!.map((t) => t.id).sort((a, b) => a - b),
    );
    const cx = field.lengthM / 2;
    const cy = field.widthM / 2;
    const scale = fieldModelScale(entry.mirror);
    for (const tag of layout!) {
      const got = centers.get(tag.id)!.clone().multiply(scale);
      const want = expectedRender(tag, cx, cy);
      const horiz = Math.hypot(got.x - want.x, got.z - want.z);
      expect(horiz, `${c.dir} tag ${tag.id}: horizontal ${horiz * 1000}mm`).toBeLessThan(0.015);
      expect(got.y - want.y, `${c.dir} tag ${tag.id}: vertical ${(got.y - want.y) * 1000}mm`)
        .toBeGreaterThan(-0.015);
      expect(got.y - want.y, `${c.dir} tag ${tag.id}: vertical`).toBeLessThan(0.02);
    }
  });

  it('the retired Ry(180°)+offset mount is rejected by metres, not millimetres', () => {
    // The pre-fix hard-coded transform (fitted to the retired Onshape model,
    // engineering-log 2026.9.13) must fail loudly — this is the guard
    // against re-introducing an eyeballed constant.
    const field = byId.get('crescendo-2024')!;
    const centers = decalCenters('2024-crescendo', /FE-00083_ID(\d+)/);
    const cx = field.lengthM / 2;
    const cy = field.widthM / 2;
    let worst = 0;
    for (const tag of field.aprilTags!) {
      const p = centers.get(tag.id)!;
      const old = new THREE.Vector3(-p.x, p.y, -p.z).add(new THREE.Vector3(0, 0.13, 1.16));
      worst = Math.max(worst, old.distanceTo(expectedRender(tag, cx, cy)));
    }
    expect(worst).toBeGreaterThan(1);
  });
});

describe('2025 uses the official enclosure frame', () => {
  it('reefscape constants are the WPILib 17.548 × 8.052 field', () => {
    const f = fieldById('reefscape-2025');
    expect(f.lengthM).toBeCloseTo(17.548, 4);
    expect(f.widthM).toBeCloseTo(8.052, 4);
  });

  it('every 2025 tag sits inside the enclosure the constants describe', () => {
    const f = fieldById('reefscape-2025');
    for (const t of [...f.aprilTags!, ...f.aprilTagsAndyMark!]) {
      // ±1 cm slack: wall-mounted tags may poke a few mm past the nominal
      // frame (tag 3's official y = 8.0556 vs width 8.052 — it sits ON the
      // wall plane).
      expect(t.x).toBeGreaterThan(-0.01);
      expect(t.x).toBeLessThan(f.lengthM + 0.01);
      expect(t.y).toBeGreaterThan(-0.01);
      expect(t.y).toBeLessThan(f.widthM + 0.01);
    }
  });
});
