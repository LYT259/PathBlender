# Field Obstacles Collision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Detect robots driving into field interior obstacles (hub, reef, stage legs, …) — red-book §6.2's long-term item "机器人 OBB vs 场地元素（墙、障碍物）" — for the five bundled seasons 2022–2026, with footprints programmatically extracted from the bundled official-CAD GLBs and surfaced in the checks panel.

**Architecture:** A one-shot Node generator walks each season's bundled GLB node tree (TRS/matrix compose), transforms vertices into the WPILib blue world frame using the already-tested 3D mount contract, filters by a blocking height band, and writes a read-only convex-hull data module inside `@pathblender/core`. Core gains an OBB-vs-convex-polygon SAT test plus a sampled interval detector that reuses the field-bounds semantics (3 in forgiveness, 0.05 s step, interval merging). The web app consumes the detector exactly like `detectFieldBounds`: a third section in the checks panel, red-bumper-now on the 2D canvas, i18n in all dictionaries. Custom fields carry no obstacles.

**Tech Stack:** TypeScript (core: pure functions, zero DOM; web: React + canvas 2D), vitest, plain-Node GLB parsing (JSON + BIN chunk reader, no three.js in the generator — precedent `packages/web/test/field3d-model.test.ts`). **Zero new dependencies.**

**Spec:** Red book (private file, main tree only — not in worktrees): `PathBlender_红皮书.md` §6.2 (碰撞检测设计, 远期 bullet: "机器人 OBB vs 场地元素（墙、障碍物）——场地元素几何随赛季场地包走"), §6.7 (AprilTag/geometry precision discipline — 禁止目测), §16.26 (orientation audit: rotationally symmetric layouts cannot catch 180° flips — validation must use direction-sensitive anchors). Project rules: `AGENTS.md` in the main tree (blue-frame invariant, pure-frontend red line, license rules, test discipline).

## Global Constraints

Every task implicitly includes this section.

- **Blue world frame, meters/radians** (WPILib blue-origin convention; red-alliance files are flipped at import — everything downstream is blue-frame only). All hulls are blue world frame.
- **No eyeballed coordinates** (red book §6.7, AGENTS.md 架构不变量): every coordinate in the generated data comes from GLB geometry via code; every expected value in configs/tests comes from an official source (game manual §5/§6/§7, WPILib tag layouts in `packages/core/src/field.ts`, or `field.ts`'s already-cited derivations) with a citation comment. No number is typed because it "looks right".
- **Reuse `BOUNDS_TOLERANCE_M = 0.0762`** (3 in) from `packages/core/src/collision/field-bounds.ts` — same forgiveness rationale (model rounding + real-field assembly + oversized default robot envelope). Do not define a second tolerance constant.
- **Sampling step `0.05 s`** default, matching `detectFieldBounds`, and the same interval-merge rule (`t - open.endT > 1.5 * step` closes the interval).
- **Core stays pure / zero-DOM**; the generator lives in `scripts/field-obstacles/` and imports nothing from `packages/web`.
- **Zero new npm dependencies.** The generator's mat4/quaternion math is hand-written and unit-tested (strip-only TS rules do not apply to `.mjs` scripts; plain JS, ESM).
- **Season coverage:** 2022–2026 (bundled GLBs in `packages/web/public/fields3d/`). 2025 extracts **both** construction variants (`2025-reefscape-welded` and `2025-reefscape-andymark`) as separate sets. 2026 has only a welded GLB (verified: `FIELD3D_MODELS` has no `andymark` for `rebuilt-2026`) — one set serves both variants; the AndyMark structure offsets measured in `field3d-frame.ts` (~14 mm) are far below the 3 in tolerance. **Custom fields: no obstacles** (`obstaclesForField` returns `[]`).
- **Excluded structures** (drivable / traversable — robots legally occupy their footprint): 2023 Charge Station (drive-on platform), 2026 Trench arms (drive-under) and 2026 BUMPs (drive-over), and any other element the season's manual shows as traversable — each exclusion is a config row with a one-line rationale + manual citation. Perimeter walls are NOT obstacles (`detectFieldBounds` already owns them).
- **Generated file discipline** (AGENTS.md sw.js precedent): `packages/core/src/field-obstacles-data.ts` is machine-written with a `GENERATED FILE` header; hand edits are forbidden; regeneration is `node scripts/field-obstacles/extract-footprints.mjs`.
- **License note:** hulls are numeric facts derived from AdvantageScopeAssets GLBs (BSD-3-Clause, from official FIRST CAD). The generated file header carries the source + license note (same pattern as `field.ts` tag comments).
- **Behavior changes carry tests; tests test behavior not implementation.** Commit messages in English; one commit per task; never commit on beta/stable directly (branch `feat/field-obstacles-collision` already checked out).
- **i18n:** new UI keys land in `en.ts` (source of truth) **and all 40 complete dictionaries** in the same commit (TypeScript enforces completeness; `en-gb`/`zh-hk`/`zh-mo` are override tables and inherit automatically). `{depth}` values are pre-formatted by `formatLength` — the new key joins `PREFORMATTED` in `i18n-quality.test.ts`.

## Review Focus

The five input/failure classes most likely to bite a real user, each pinned to the task whose tests own it:

1. **Frame/orientation flip in the generator** — a wrong mirror axis or center places every hull 180°/16 m away; rotationally symmetric seasons (2022, 2025) cannot catch a 180° flip from tag positions alone (§16.26 lesson). Guarded by: synthetic-fixture transform tests (Task 4), per-season tag-anchor + containment validation (Task 5/6), and manual-dimension *absolute position* checks (e.g. 2026 hub xMin = 4.0284 — direction-sensitive). Residual: for 2022 (fully symmetric field) absolute-direction truth rests on the shared `configMirrorAxis` contract from the shipped `config.json`, which the existing `field3d-model.test.ts` already pins — the generator MUST derive mirror from `config.json`, never hard-code it.
2. **Tolerance boundary** — a bumper grazing an obstacle by less than 3 in must stay silent; at/above 3 in it must report (same class as the historical wall-hug false positives). Pinned in Task 3 (boundary cases at 0.0761 / 0.0762 / 0.2 m penetration).
3. **Degenerate or non-convex element geometry** — a group whose in-band hull has < 3 points, collinear-only vertices, or disjoint legs (2024 stage legs) would produce a garbage or over-broad hull. Pinned in Task 4 (synthetic GLB with collinear triangle), Task 6 (2024 stage legs produce ≥ 4 disjoint small hulls, not one spanning hull), Task 2 data-integrity test (convex + CCW + ≥ 3 points, every season).
4. **Construction-variant mismatch** — 2025 AndyMark coral stations move ~7 cm vs welded; loading the wrong set for the selected variant over/under-reports. Pinned in Task 6 (welded vs andymark sets differ, same id sets, lookup returns the selected variant) and Task 7 (App memo keys on `fieldVariant`).
5. **i18n placeholder/unit regressions across 43 languages** — `{depth}` double-unit ("0.93 m m") or a placeholder typo in any one dictionary. Pinned by adding `obstacles.item` to `PREFORMATTED` (Task 7) and the existing `i18n.test.ts` completeness/placeholder gates that run in every suite.

---

### Task 1: Obstacle data types, lookup, and generated-data scaffold (core)

**Files:**
- Create: `packages/core/src/field-obstacles.ts`
- Create: `packages/core/src/field-obstacles-data.ts` (generated scaffold, empty for now)
- Modify: `packages/core/src/index.ts` (export block near the field-bounds exports, ~line 124)
- Test: `packages/core/test/field-obstacles.test.ts`

**Interfaces:**
- Produces (later tasks rely on these exact names):

```ts
export interface HullPoint { x: number; y: number }
export interface FieldObstacle {
  /** Stable id, e.g. 'hub-blue'. Alliance-paired elements get a -blue/-red suffix. */
  id: string;
  /** English source name from the official CAD part tree (proper noun, shown as-is — same precedent as FieldPackage.name in the field picker). */
  name: string;
  /** Convex hull, counterclockwise, no repeated closing point, blue world frame meters. */
  hull: readonly HullPoint[];
  /** Height band of the in-band source vertices, meters. */
  zMinM: number;
  zMaxM: number;
}
export interface FieldObstacleVariantSet {
  welded: readonly FieldObstacle[];
  andymark?: readonly FieldObstacle[];
}
export function obstaclesForField(
  field: Pick<FieldPackage, 'id'>,
  variant: 'welded' | 'andymark',
): readonly FieldObstacle[];
```

- [x] **Step 1: Write the failing tests** in `packages/core/test/field-obstacles.test.ts`:

```ts
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
      const seen = new Set<string>();
      for (const variant of ['welded', ...(set.andymark ? ['andymark'] : [])] as const) {
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
```

- [x] **Step 2: Run to verify failure**

Run: `npm test -w @pathblender/core -- field-obstacles`
Expected: FAIL — `obstaclesForField` / `FIELD_OBSTACLE_DATA` not exported.

- [x] **Step 3: Implement** `packages/core/src/field-obstacles.ts` (types above + `obstaclesForField`: index into `FIELD_OBSTACLE_DATA[field.id]`; return `[]` when absent; when present and `variant === 'andymark'`, return `set.andymark ?? set.welded`) and `packages/core/src/field-obstacles-data.ts`:

```ts
// GENERATED FILE — do not edit by hand. Regenerate: node scripts/field-obstacles/extract-footprints.mjs
// Source geometry: AdvantageScopeAssets Field3d GLBs (BSD-3-Clause), derived from official FIRST CAD.
// Validated per season against WPILib AprilTag layouts and official game-manual dimensions
// (see scripts/field-obstacles/seasons.mjs for citations). No coordinate in this file is hand-typed.
import type { FieldObstacleVariantSet } from './field-obstacles';

export const FIELD_OBSTACLE_DATA: Record<string, FieldObstacleVariantSet> = {};
```

Export `obstaclesForField`, `FieldObstacle`, `FieldObstacleVariantSet`, `HullPoint`, and `FIELD_OBSTACLE_DATA` from `packages/core/src/index.ts` next to the field-bounds exports. Import `FieldPackage` type in `field-obstacles.ts` only as a `Pick<FieldPackage, 'id'>` parameter (no cycle with `field.ts`).

- [x] **Step 4: Run to verify pass**

Run: `npm test -w @pathblender/core -- field-obstacles`
Expected: PASS (2 describes, data test vacuously green).
Also run: `npm run typecheck -w @pathblender/core` — Expected: 0 errors.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/field-obstacles.ts packages/core/src/field-obstacles-data.ts packages/core/src/index.ts packages/core/test/field-obstacles.test.ts
git commit -m "feat(core): field obstacle data types and per-season lookup"
```

---

### Task 2: OBB vs convex polygon SAT depth (core)

**Files:**
- Create: `packages/core/src/collision/obstacles.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/obstacle-sat.test.ts`

**Interfaces:**
- Consumes: `Obb`, `poseToObb` from `../collision/obb` (existing), `HullPoint` from Task 1.
- Produces:

```ts
/** SAT overlap depth between an OBB and a CCW convex hull, meters.
 *  0 when separated; otherwise the minimum overlap over all candidate axes
 *  (the OBB's two edge normals + every hull edge normal) — the depth along
 *  the minimum translation vector. */
export function obbVsConvexPolygonDepth(obb: Obb, hull: readonly HullPoint[]): number;
```

- [x] **Step 1: Write failing tests** in `packages/core/test/obstacle-sat.test.ts`. Axis-aligned unit square obstacle `{(2,0),(3,0),(3,1),(2,1)}`; OBB via `poseToObb({ x, y, heading }, { lengthM, widthM, offsetX: 0, offsetY: 0 })`:

```ts
it('reports exact overlap for a face-to-face square-on-square hit', () => {
  // 0.5-square robot centered at (2.5, 0.5) inside the 1-square obstacle.
  const obb = poseToObb({ x: 2.5, y: 0.5, heading: 0 }, { lengthM: 0.5, widthM: 0.5, offsetX: 0, offsetY: 0 });
  expect(obbVsConvexPolygonDepth(obb, SQ)).toBeCloseTo(0.5, 9); // fully inside: depth = robot width
});
it('separated boxes give 0', () => {
  const obb = poseToObb({ x: 5, y: 5, heading: 0 }, G);
  expect(obbVsConvexPolygonDepth(obb, SQ)).toBe(0);
});
it('45°-rotated robot detects a corner clip with depth in (0, half-diagonal]', () => {
  const obb = poseToObb({ x: 3.2, y: 0.5, heading: Math.PI / 4 }, G);
  const d = obbVsConvexPolygonDepth(obb, SQ);
  expect(d).toBeGreaterThan(0);
  expect(d).toBeLessThanOrEqual(Math.hypot(0.45, 0.45));
});
it('depth equals the face overlap for a partial edge crossing', () => {
  // Robot half-overlapping the obstacle's right edge x=3.
  const obb = poseToObb({ x: 3.2, y: 0.5, heading: 0 }, G); // half-extent 0.45 → spans x[2.75, 3.65], y[0.05, 0.95]
  // Projections on +x: obstacle [2,3], robot [2.75, 3.65] → overlap 3 − 2.75 = 0.25.
  // On +y: obstacle [0,1], robot [0.05, 0.95] → overlap 0.90. Hull edges here are
  // axis-aligned, so the axis set is {+x, +y} and the depth (min overlap) is 0.25.
  expect(obbVsConvexPolygonDepth(obb, SQ)).toBeCloseTo(0.25, 9);
});
```

- [x] **Step 2: Run to verify failure**

Run: `npm test -w @pathblender/core -- obstacle-sat`
Expected: FAIL — module/function not found.

- [x] **Step 3: Implement** `obbVsConvexPolygonDepth` in `packages/core/src/collision/obstacles.ts`. Approach: project both shapes on each candidate axis (reuse the projection arithmetic pattern from `obb.ts:project`; hull projection is min/max of dot products over hull points). If any axis separates (`pa.max < pb.min || pb.max < pa.min`) return 0; else return the minimum `min(pa.max, pb.max) − max(pa.min, pb.min)` over all axes. Export from `index.ts`.

- [x] **Step 4: Run to verify pass**

Run: `npm test -w @pathblender/core -- obstacle-sat && npm run typecheck -w @pathblender/core`
Expected: PASS / 0 errors.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/collision/obstacles.ts packages/core/src/index.ts packages/core/test/obstacle-sat.test.ts
git commit -m "feat(core): OBB vs convex polygon SAT overlap depth"
```

---

### Task 3: Obstacle interval detector (core)

**Files:**
- Modify: `packages/core/src/collision/obstacles.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/obstacle-detect.test.ts`

**Interfaces:**
- Consumes: `obbVsConvexPolygonDepth` (Task 2), `BOUNDS_TOLERANCE_M` from `./field-bounds`, `FieldObstacle` (Task 1), `activeStartT`/`activeEndT`/`samplePoseAt`/`SessionTrajectory` from `../session`.
- Produces:

```ts
export interface ObstacleCollisionInterval {
  robotId: string;
  obstacleId: string;
  startT: number;
  endT: number;
  /** Deepest in-tolerance penetration (SAT depth minus nothing — raw depth at the worst sample), meters. */
  maxPenetrationM: number;
  /** Pose at the deepest penetration. */
  worstPose: Pose2d;
}
export interface ObstacleDetectOptions { stepS?: number }
export function detectObstacleCollisions(
  robots: readonly SessionTrajectory[],
  obstacles: readonly FieldObstacle[],
  opts?: ObstacleDetectOptions,
): ObstacleCollisionInterval[];
```

- [x] **Step 1: Write failing tests** in `packages/core/test/obstacle-detect.test.ts`. Build synthetic robots with `makeSession({ id, name, teamName: '', samples: [...], ... })` exactly like `field-bounds.test.ts`'s `parked()` helper (read that helper first and copy its shape; 0.9 m default geometry). One square obstacle `HUB = { id: 'test-hub', name: 'Test Hub', hull: [{x:2,y:2},{x:3,y:2},{x:3,y:3},{x:2,y:3}], zMinM: 0, zMaxM: 1 }`:

```ts
it('flags a path driven through the obstacle with interval, depth and worst pose', ...);          // robot crossing (2.5, 2.5) between t=1..3 → 1 interval, startT/endT bracket the crossing, maxPenetrationM > 0, worstPose inside hull
it('forgives a graze below BOUNDS_TOLERANCE_M but reports at the threshold', ...);                // path whose bumper edge overlaps the hull's left edge x=2 by 0.0761 m → []; by 0.0762 m → 1 interval. Robot center for overlap o: x = 2 + 0.45 − o (mirror field-bounds.test.ts regression style)
it('merges samples separated by < 1.5 steps into one interval', ...);                             // constant-inside dwell → exactly 1 interval
it('empty obstacle list returns empty', ...);                                                      // []
it('default step is 0.05 s', ...);                                                                 // path dwelling inside the hull from t=1.02 to 2.97 → samples land on the 0.05 grid: startT = 1.05, endT = 2.95
it('honors a custom stepS option', ...);                                                           // same dwell at stepS 0.5 → coarser first/last sample times
```

- [x] **Step 2: Run to verify failure**

Run: `npm test -w @pathblender/core -- obstacle-detect`
Expected: FAIL — `detectObstacleCollisions` not exported.

- [x] **Step 3: Implement** `detectObstacleCollisions` mirroring `detectFieldBounds` (field-bounds.ts:93-139) line for line in structure: per robot, `from = activeStartT(robot)`, `to = activeEndT(robot)`, sample `poseToObb(samplePoseAt(robot, t), robot.trajectory.geometry)`, per obstacle `depth = obbVsConvexPolygonDepth(obb, o.hull)`; a sample counts as a hit when `depth >= BOUNDS_TOLERANCE_M` (the ≥ rule is the user's "equal already counts" precedent); merge with the `1.5 * step` gap rule; track `maxPenetrationM` (raw depth) and `worstPose`. Sort by `startT`. Step default `0.05`.

- [x] **Step 4: Run to verify pass**

Run: `npm test -w @pathblender/core && npm run typecheck -w @pathblender/core`
Expected: all core tests PASS (new + existing).

- [x] **Step 5: Commit**

```bash
git add packages/core/src/collision/obstacles.ts packages/core/src/index.ts packages/core/test/obstacle-detect.test.ts
git commit -m "feat(core): sampled robot-vs-obstacle collision intervals reusing bounds tolerance"
```

---

### Task 4: Generator library — GLB parse, TRS walk, world transform, convex hull

**Files:**
- Create: `scripts/field-obstacles/extract.mjs` (importable pure library)
- Test: `packages/web/test/field-obstacles-extract.test.ts`

**Interfaces:**
- Produces (Task 5/6 consume; the CLI and the season tests import these):

```ts
// scripts/field-obstacles/extract.mjs
export function parseGlb(buf)                // → { json, bin } (JSON chunk parsed, BIN chunk as Buffer)
export function localMatrix(node)            // → 4x4 row-major nested array; node.matrix or compose(translation, rotation quat, scale)
export function elementGroups(json)          // → [{ name, nodeIndices[] }] — groups = meshes under each child-of-root-element assembly (see Step 3)
export function makeNativeToWorld(mirror, cx, cy)  // → (p: [x,y,z]) => { x, y, height }  — native GLB → blue world (documented two-step map)
export function monotoneChainHull(points)    // → CCW hull, no closing duplicate; throws on < 3 unique non-collinear points
export function hullPointsOfGroup(json, bin, group, { zMin, zMax })  // → { hull: HullPoint[], zMinM, zMaxM, vertexCount }
```

- The transform contract (from `packages/web/src/field3d-frame.ts`, already registration-verified to 1.3 mm/11 mm against the shipped assets — cite that file in comments): native point `p` → (mirror `'z'`: `(p.x, p.y, −p.z)`; mirror `'x'`: `(−p.x, p.y, p.z)`) → world `x = cx − X`, `y = cy − Z`, height `= Y`, where `cx, cy` come from core's `fieldImageWorldRect(field.image, …)` center. **The generator must compute `mirror` from the field's shipped `packages/web/public/fields3d/<dir>/config.json` `rotations` using the same rule as `configMirrorAxis` (field3d-frame.ts:118 — a `z:180°` entry ⇒ `'x'`, else `'z'`), and the season config may only record the derived value with a test asserting it matches the config.json — never an independently hand-set axis.**

- [x] **Step 1: Write failing tests** in `packages/web/test/field-obstacles-extract.test.ts`:

```ts
// Synthetic GLB fixture built in-test: hand-assemble the 12-byte GLB header,
// one JSON chunk (scene → 1 root → 1 child node with translation/rotation/scale
// + one mesh primitive POSITION accessor) and one BIN chunk with a unit square's
// triangle vertices at a known native position. Follow the chunk layout in
// field3d-model.test.ts gltfJson() (readUInt32LE magic 0x46546c67, lengths, 0x4e4f534a).
it('parseGlb returns the JSON chunk and BIN buffer', ...);
it('localMatrix composes TRS identically to three-free reference math (compare against hand-multiplied 4x4 for translation [1,2,3], rotZ 90°, scale [2,2,2])', ...);
it('makeNativeToWorld("z", 8.27, 4.035) maps the documented example: native (1, 0.5, 2) → world (7.27, 6.035, height 0.5)', () => {
  // mirror 'z': render (X, Y, Z) = (1, 0.5, −2) → world x = 8.27 − 1 = 7.27,
  // world y = 4.035 − (−2) = 6.035, height = Y = 0.5 (derivation in comment).
});
it('makeNativeToWorld("x", 8.27, 4.035) maps native (1, 0.5, 2) → world (9.27, 2.035, height 0.5)', () => {
  // mirror 'x': render (−1, 0.5, 2) → x = 8.27 + 1, y = 4.035 − 2.
});
it('monotoneChainHull returns the CCW square hull of 5 points including an interior point, throws on 3 collinear points', ...);
it('hullPointsOfGroup filters by z band and reports the in-band z range', ...);  // fixture with one vertex above zMax
it('parses the real 2026 GLB: > 3000 nodes, root element groups are non-empty', ...);  // read packages/web/public/fields3d/2026-rebuilt/model.glb
```

- [x] **Step 2: Run to verify failure**

Run: `npm test -w @pathblender/web -- field-obstacles-extract`
Expected: FAIL — module not found.

- [x] **Step 3: Implement** `scripts/field-obstacles/extract.mjs` as pure ESM JS:
  - `parseGlb`: walk chunks (JSON type `0x4e4f534a`, BIN `0x004e4942`); decode POSITION accessors honoring `componentType` 5126 (FLOAT), `bufferView.byteOffset/byteStride` (the shipped GLBs use stride 0/12 — assert and throw on anything else rather than guessing), and accessor `count`. Use accessor `min/max` only as a sanity cross-check (|computed − declared| < 1e-3).
  - `localMatrix`: column-major glTF matrix layout → compose TRS when absent (hand-written 4x4 multiply; no dependencies).
  - Node world transform: post-multiply child by parent along the node tree (`scene.nodes → root → assemblies → meshes`; the world matrix of a mesh is the product of ancestor local matrices — same as three's `updateMatrixWorld`, documented in field3d-model.test.ts).
  - `elementGroups`: the shipped models are `scene → 1 root node ('FE-2026: REBUILT…') → children = element assemblies ('GE-26100: Bump <1>', 'GE-26600: Depot <1>', …) → parts/meshes`. Group = every mesh reachable from one root-child. `--list` (Task 5 CLI) prints each group's name, mesh count, and world AABB.
  - `makeNativeToWorld(mirror, cx, cy)`: the two-step contract above, returning world `{ x, y, height }`.
  - `monotoneChainHull`: Andrew's monotone chain on `HullPoint[]`; unique points; error (not a degenerate return) when the hull has < 3 vertices.

- [x] **Step 4: Run to verify pass**

Run: `npm test -w @pathblender/web -- field-obstacles-extract && npm run typecheck -w @pathblender/web`
Expected: PASS / 0 errors.

- [x] **Step 5: Commit**

```bash
git add scripts/field-obstacles/extract.mjs packages/web/test/field-obstacles-extract.test.ts
git commit -m "feat(scripts): dependency-free GLB parse, world transform and convex hull for obstacle extraction"
```

---

### Task 5: Season config + 2026 REBUILT extraction, validation, generation CLI

**Files:**
- Create: `scripts/field-obstacles/seasons.mjs`
- Create: `scripts/field-obstacles/extract-footprints.mjs` (CLI: default = extract → validate → write; `--check` = extract → validate only; `--list <fieldId>|all`)
- Modify: `packages/core/src/field-obstacles-data.ts` (regenerated — now carries `rebuilt-2026`)
- Test: `packages/web/test/field-obstacles-extract.test.ts` (extend; season validation cases)

**Interfaces:**
- Consumes: everything from Task 4; `FIELDS`/`REBUILT_2026` shape from `packages/core/src/field.ts` (read the constants with the same regex-parsing approach as `scripts/cad/render-field-topdown.mjs:readWeldedTags2026` — the script must not import TS; alternatively `npm run build -w @pathblender/core` and import `@pathblender/core` dist — pick ONE, document it in the script header; the dist-import option is preferred because regex parsing breaks on refactors).
- Produces: `FIELD_OBSTACLE_DATA['rebuilt-2026'] = { welded: FieldObstacle[] }` consumed by Task 1's `obstaclesForField`.

- [x] **Step 1: Write failing tests** (append to `field-obstacles-extract.test.ts`) — these validate the **committed data** and the **config**, not the generator run:

```ts
it('2026 data exists and every element id is mapped in the season config', ...);
it('blue hub hull matches the official manual: 47 in (1.1937 m) square, near face on the starting line 158.6 in (4.0284 m) from the alliance wall, centered on the midline', () => {
  // field.ts REBUILT_2026.startRegions comment cites manual §5.4 + TU22:
  // footprint x[4.0284, 5.2221], y[3.4376, 4.6316] (midline 4.0346 ± 0.597).
  // Assert hull x-span and y-span ∈ 1.1937 ± 0.02, xMin ∈ 4.0284 ± 0.02,
  // y-center ∈ 4.0346 ± 0.02. Tolerance 2 cm = measured AdvantageScopeAssets
  // authoring noise (field3d-model.test.ts header: ≤ 11–15 mm) + margin.
});
it('2026 welded AprilTags 18–21 (blue hub) and 7–12 (red hub) anchor on their hub hulls: each tag (x,y) lies inside the hull or within 0.05 m of its boundary', () => {
  // Tag→element assignment citation: 2026 manual §5.4 tag assignment as pinned by
  // the WPILib welded layout (field.ts REBUILT_2026 comment); read tags from
  // @pathblender/core REBUILT_2026.aprilTags in the test — never re-typed.
});
it('excluded 2026 elements (trench arms, bumps) appear in the config exclusion list with a citation and contribute no hulls', ...);
it('every hull vertex of every 2026 obstacle lies inside the playfield ± 0.05 m', ...);
it('season config mirror values equal configMirrorAxis(fields3d/<dir>/config.json rotations) for all five seasons', ...);
it('regenerating from the GLBs reproduces the committed data (run the lib functions in-test and deep-compare against FIELD_OBSTACLE_DATA)', ...);
```

- [x] **Step 2: Run to verify failure**

Run: `npm test -w @pathblender/web -- field-obstacles-extract`
Expected: FAIL — no 2026 data / no config.

- [x] **Step 3: Implement.**
  - `seasons.mjs`: one entry per season `{ fieldId, glbDir, mirror: '<derived, asserted against config.json>', variants: ['welded'] | ['welded','andymark'], bandTopM: 1.5, elements: [...], tagAnchors: [...], manualDims: [...] }`.
    - `bandTopM = 1.5` with rationale comment: above every season's max robot envelope, so overhead-only structure (e.g. 2025 barge) cannot collide with the flat bumper model; `zMin = 0`.
    - `elements`: for 2026 run `node scripts/field-obstacles/extract-footprints.mjs --list rebuilt-2026` and map each element group by name: `{ match: <RegExp on the exact group name from --list output, e.g. /^GE-26100: Bump/i>, id: 'bump', name: 'Bump', action: 'exclude', reason: '…', citation: '2026 Game Manual §5.5 (drive-over)' }` — copy patterns from the real `--list` names, never invent part numbers; the exact include/exclude split comes from the `--list` output + the manual's §5 element table; **every row cites its source**. Alliance-paired elements get id suffix `-blue`/`-red` assigned by the generator from centroid x vs `lengthM/2` (never by hand). Depot and wall-mounted perimeter furniture: include or exclude per the manual (if a robot can legally contact it at bumper height, include).
    - `tagAnchors`: `{ obstacleId: 'hub-blue', tagIds: [18,19,20,21], citation }` (blue) and the red-hub set `[7,8,9,10,11,12]` (tags 17/22/23/28 sit on the excluded trench; wall tags 13–16/29–32 belong to excluded perimeter groups). **Only tags physically mounted on the included element at z < 1.0 m** may anchor (2025-style overhead tags can hover past a base footprint and would false-fail).
    - `manualDims` for 2026 (values already cited in-repo, `field.ts` REBUILT_2026 comments): hub span 1.1937 ± 0.02 both axes; hub xMin 4.0284 ± 0.02; hub y-center 4.0346 ± 0.02 (§5.4 + start-line derivation).
  - `extract-footprints.mjs`: loads config + GLBs, extracts per element group (band filter → world vertices → hull), runs validations (all `tagAnchors`, `manualDims`, containment, convexity — reuse the core-side invariants), writes `packages/core/src/field-obstacles-data.ts` with sorted keys/ids and 4-decimal coordinates; `--check` runs everything and writes nothing (exit 1 on any failure); `--list` prints the group table. Validation failure = non-zero exit, never a "best effort" write.
  - Run `node scripts/field-obstacles/extract-footprints.mjs` and confirm the data file diff shows only the new generated content.

- [x] **Step 4: Run to verify pass**

Run: `npm test -w @pathblender/web -- field-obstacles-extract && npm test -w @pathblender/core && node scripts/field-obstacles/extract-footprints.mjs --check`
Expected: all PASS, `--check` exits 0.

- [x] **Step 5: Commit**

```bash
git add scripts/field-obstacles/seasons.mjs scripts/field-obstacles/extract-footprints.mjs packages/core/src/field-obstacles-data.ts packages/web/test/field-obstacles-extract.test.ts
git commit -m "feat(field-obstacles): 2026 REBUILT footprint extraction with tag and manual-dimension validation"
```

---

### Task 6: Seasons 2022–2025 extraction (2025 dual variants; drivable exclusions)

**Files:**
- Modify: `scripts/field-obstacles/seasons.mjs`
- Modify: `packages/core/src/field-obstacles-data.ts` (regenerated)
- Test: `packages/web/test/field-obstacles-extract.test.ts` (extend)

**Interfaces:**
- Consumes: Task 4/5 machinery unchanged.
- Produces: `FIELD_OBSTACLE_DATA` entries for `rapidreact-2022`, `chargedup-2023`, `crescendo-2024`, `reefscape-2025` (2025 with both `welded` and `andymark` arrays).

- [x] **Step 1: Write failing tests** (append):

```ts
it('all five bundled seasons have obstacle sets; 2025 has distinct welded and andymark arrays', () => {
  // Same obstacle id sets across variants; at least one hull differs between
  // the two sets (artwork diff measured ~7 cm toward centre on AndyMark —
  // field.ts 2025 imageRendered comment). If extraction finds them identical,
  // investigate rather than weaken the test.
});
it('2023 charge station contributes no hull (excluded, drive-on)', ...);
it('2024 stage legs produce disjoint per-leg hulls, not one spanning hull', () => {
  // >= 4 hulls whose union area is far below the area of one spanning hull.
});
it('per-season tag anchors validate: tags mounted on included elements lie on/inside their hulls (2025 reef face tags 17–22 blue / 6–11 red per WPILib layouts; 2024 structure tags per manual §5 assignment; only tags at z < 1.0 m)', ...);
it('manual dims validate where the config carries them', ...);   // rows added in Step 3
it('regeneration reproduces committed data for all seasons', ...);
```

- [x] **Step 2: Run to verify failure**

Run: `npm test -w @pathblender/web -- field-obstacles-extract`
Expected: FAIL — seasons missing.

- [x] **Step 3: Implement** per season (the manual lookup is implementation work — every number gets a citation or is explicitly not used):
  - Run `--list <fieldId>`; read that season's official Game Manual §5 (ARENA) element table; classify every element group: include (blocks ground robots at bumper height) / exclude (drivable, drive-under, overhead-only above `bandTopM`, or floor marking) — each with citation. Known-from-directive exclusions: **2023 Charge Station** (drive-on platform), **2026 Trench + BUMPs** (already Task 5). Watch for: 2024 STAGE legs — include **per-leg hulls** via subgroup node names from `--list` (a single hull over all legs would wrongly block under-stage driving — split `elements` rows by part node when a group's blocking geometry is disjoint); 2025 barge (overhead — band filter excludes it; still list it as an excluded row with reason).
  - `tagAnchors` per season from the WPILib layouts in `field.ts` + manual tag assignment (2025: reef face tags; 2024: structure-mounted tags per manual §5 assignment; 2022/2023 ship no tag decals — see caveat below).
  - `manualDims`: fill each season's span/position rows from its manual (e.g. 2025 reef, 2024 stage leg spacing, 2023 grid substation, 2022 hub diameter) with §/page citations. **Where a dimension cannot be verified from an official source, do NOT invent one** — omit the row and record the gap in a `// UNVERIFIED:` comment in `seasons.mjs`; that season then relies on tag anchors + containment only (2022/2023 partially — see Review Focus line 1).
  - Regenerate; confirm core data-integrity test now exercises all seasons.

- [x] **Step 4: Run to verify pass**

Run: `npm test -w @pathblender/web -- field-obstacles-extract && npm test -w @pathblender/core && node scripts/field-obstacles/extract-footprints.mjs --check`
Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add scripts/field-obstacles/seasons.mjs packages/core/src/field-obstacles-data.ts packages/web/test/field-obstacles-extract.test.ts
git commit -m "feat(field-obstacles): 2022-2025 footprints incl. dual 2025 construction variants"
```

---

### Task 7: Web wiring — checks panel section, canvas red-bumper, App detection, i18n

**Files:**
- Modify: `packages/web/src/App.tsx` (detection memo next to `bounds` at App.tsx:456; pass-through props)
- Modify: `packages/web/src/components/ConflictPanel.tsx` (third section after the bounds section, ConflictPanel.tsx:65)
- Modify: `packages/web/src/canvas2d-render.ts` (FieldFrameParams ~line 175; `outOfBoundsNow` set ~line 348; `drawRobot` call ~line 429)
- Modify: `packages/web/src/i18n/en.ts` + the 40 complete dictionaries (`ar az bg bs cs da de el es fil fr he hi hr hu hy id it ja ko mk mr ms nb nl nn pl pt-br ro rw sq sr sv ta tr uk vi zh zh-tw`)
- Modify: `packages/web/test/i18n-quality.test.ts` (`PREFORMATTED` map, ~line 82)
- Test: `packages/web/test/conflict-panel-obstacles.test.tsx`

**Interfaces:**
- Consumes: `detectObstacleCollisions`, `ObstacleCollisionInterval`, `obstaclesForField`, `FieldObstacle` from `@pathblender/core` (Tasks 1–3, exported).
- Produces: `ConflictPanel` props gain `obstacleHits: ObstacleCollisionInterval[]` and `obstacleDefs: readonly FieldObstacle[]`; `FieldFrameParams` gains `obstacleHits: ObstacleCollisionInterval[]`; i18n keys (English source of truth, copied verbatim):

```ts
'obstacles.title': 'Field obstacles',
'obstacles.item': '{start}–{end} s · {depth} into {name}',
```

*i18n keys land in the same task and commit as the wiring — the dictionaries are `Record<MessageKey, string>`-complete, so a keys-only or wiring-only commit cannot typecheck.*

- [x] **Step 1: Write failing tests** in `packages/web/test/conflict-panel-obstacles.test.tsx` (follow `checks-summary.test.tsx`: full `<App />` render + dropped `File` objects; the default field is `rebuilt-2026` welded):

```ts
it('shows the obstacle section with a hit when a path drives through the 2026 blue hub', async () => {
  // Author an inline .ghostauto (string → File, copying the samples/ghostauto
  // format read from samples/ghostauto/straight_run.ghostauto) whose waypoints
  // cross the blue hub — derive the crossing coordinates in the test from
  // obstaclesForField(REBUILT_2026, 'welded') hub-blue hull centroid (import
  // from @pathblender/core; no hard-coded coordinates).
  // Assert: section heading text appears, one item row, summary count includes it.
});
it('hides the section entirely on a custom field (no obstacles)', ...);   // import a custom field image or set prefs — follow CustomFieldPanel test patterns if one exists; otherwise drive via localStorage prefs
it('jump button calls back with the interval midpoint', ...);             // panel-level render with synthetic props (render ConflictPanel directly)
it('hidden robots contribute no obstacle hits', ...);                     // App-level: hide the robot (RobotList toggle), item disappears
```

- [x] **Step 2: Run to verify failure**

Run: `npm test -w @pathblender/web -- conflict-panel-obstacles`
Expected: FAIL — props/section missing (`t()` falls back to the raw key, so heading-text assertions fail too).

- [x] **Step 3: Implement**:
  - App.tsx: `const obstacleDefs = useMemo(() => obstaclesForField(field, fieldVariant), [field, fieldVariant]);` and `const obstacleHits = useMemo(() => detectObstacleCollisions(visible, obstacleDefs), [visible, obstacleDefs]);` (the `visible` set — hidden robots are absent from checks, user request 2026-10-04); thread both into `<ConflictPanel>` and `<FieldCanvas>` (whatever prop name the canvas component takes for `renderFieldFrame` params).
  - ConflictPanel: `issues = conflicts.length + bounds.length + obstacleHits.length`; render the section only when `obstacleDefs.length > 0`; item text uses key `obstacles.item` with `{start} {end} {depth} {name}` where `name` resolves from `obstacleDefs.find(o => o.id === hit.obstacleId)?.name ?? hit.obstacleId`; jump = `onJump((startT+endT)/2, [robotId])` — mirror the bounds row markup (`conflict-jump bounds` classes) for consistent styling.
  - canvas2d-render.ts: extend the `outOfBoundsNow` loop (line ~348) to also add robots inside an `obstacleHits` interval at `currentT` — keep passing one boolean into `drawRobot` (line ~429), i.e. `outOfBoundsNow.has(id) || obstacleNow.has(id)`; no new visual vocabulary (red bumper is the established "in violation now" indicator).
  - i18n: add both keys to `en.ts` (verbatim above), then to every complete dictionary — translate the section title and item template per language, anchoring terminology on that dictionary's existing `bounds.title` / `bounds.item` translations (e.g. zh: `'obstacles.title': '场地障碍物'`, `'obstacles.item': '{start}–{end} s · 深入{name} {depth}'` — follow each language's established word order and unit conventions; keep placeholders `{start} {end} {depth} {name}` exactly). `en-gb`/`zh-hk`/`zh-mo` are override tables and inherit automatically. Add `'obstacles.item': '{depth}'` to `PREFORMATTED` in `i18n-quality.test.ts` (`formatLength` already appends the unit — prevents the "0.93 m m" double-unit bug class documented in that test's header).

- [x] **Step 4: Run to verify pass**

Run: `npm test -w @pathblender/web && npm run typecheck -w @pathblender/web`
Expected: ALL web tests PASS (including `i18n.test.ts` completeness/placeholder parity and `i18n-quality.test.ts`), typecheck 0 errors.

- [x] **Step 5: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/ConflictPanel.tsx packages/web/src/canvas2d-render.ts packages/web/src/i18n packages/web/test/i18n-quality.test.ts packages/web/test/conflict-panel-obstacles.test.tsx
git commit -m "feat(web): obstacle collisions in checks panel and canvas, i18n in all dictionaries"
```

---

### Task 8: Performance guard and user guide

**Files:**
- Create: `packages/core/test/obstacle-perf.test.ts`
- Modify: `docs/user-guide.en.md`, `docs/user-guide.zh.md` (checks section)

**Interfaces:**
- Consumes: `detectObstacleCollisions`, `obstaclesForField`, `REBUILT_2026` from `@pathblender/core` (Tasks 1, 3, 5–6).

- [x] **Step 1: Write the failing test** `packages/core/test/obstacle-perf.test.ts`:

```ts
it('full-scan budget: 6 robots × 20 s × the 2026 obstacle set stays well under 0.5 s', () => {
  const obstacles = obstaclesForField(REBUILT_2026, 'welded');
  // Build 6 makeSession robots with 20 s of samples spanning the full field
  // length (helper shape from obstacle-detect.test.ts, so every hull is
  // exercised). Warm up once (JIT), then time detectObstacleCollisions with
  // Date.now(); expect < 500 ms. 500 ms is a ~10× margin over the expected
  // tens of ms; if it ever flakes on CI, re-measure and document the new
  // baseline in this comment before raising the bound — no silent self-green.
});
```

- [x] **Step 2: Run to verify failure**

Run: `npm test -w @pathblender/core -- obstacle-perf`
Expected: FAIL — module/test file not found (run before implementing the workload helper). This task's test is a regression pin rather than a design driver: once the helper exists the assertion itself should pass comfortably; record the measured time in the PR description.

- [x] **Step 3: Implement** the workload helper (6 robots, full-length crossing paths) and, in the user guides, one short paragraph each (en/zh) in the checks section: what obstacle checks report, the 3 in forgiveness, seasons covered (2022–2026, 2025 dual builds), custom fields have none.

- [x] **Step 4: Run to verify pass**

Run: `npm test -w @pathblender/web && npm test -w @pathblender/core && npm run typecheck`
Expected: ALL tests PASS, typecheck 0 errors (full suites — this is the whole-repo gate for the feature).

- [x] **Step 5: Commit**

```bash
git add packages/core/test/obstacle-perf.test.ts docs/user-guide.en.md docs/user-guide.zh.md
git commit -m "test(core): obstacle scan performance guard; document obstacle checks"
```

---

## External acceptance not possible (do not fake)

Items outside this plan's reach that no implementer may claim as done without real evidence:

- **Real-field / real-robot verification** — hulls are model-derived (community-published derivatives of official CAD, BSD-3). The ≤ 2 cm validation tolerances reflect measured asset authoring noise (11–15 mm, per `field3d-model.test.ts`), not physical-field assembly. No claim of "matches the real field" may be made.
- **Real user / community feedback** — no usability claims, adoption numbers, or "users confirmed" statements. Acceptance = the test suites above.
- **2022/2023 tag-anchor validation** — those GLBs ship no tag decals (see `FIELD3D_MODELS` comment); their orientation safety rests on the shared config-derived mirror contract + containment + any manual-dim rows the implementer can source. State this residual honestly in `seasons.mjs` comments; do not fabricate anchor checks.
- **Manual dimensions not found** — any season whose §5 dimensions cannot be verified from an official source is validated by tag anchors + containment only, with the gap recorded (`// UNVERIFIED:`). Never invent a number to fill a `manualDims` row.
- **Manual-row citations must be real** — if a manual section number cannot actually be checked during implementation, the row carries no citation and is flagged in the PR description.

## Delivery (execution-agent responsibilities, per AGENTS.md — not tasks in this plan)

After Task 8: full-repo `npm run typecheck` + `npm test` green; regenerate-and-`--check` reproducibility confirmed; then the standing repo flow — `node scripts/bump-version.mjs beta "<one-line user-facing note>"` (+ 40-language note completion per `version-notes.test.ts`), PR into `beta`, pre-merge tri-platform verification per the 2026-11-04 Beta delivery rules. The 3 in tolerance and any new visual treatment are existing precedent (bounds) — no new user-confirmation gates are introduced by this plan; if implementation adds any *new* persistent visual element beyond the established red-bumper/panel language, stop and surface it for user decision instead of deciding silently (AGENTS.md 正确性与审美).
