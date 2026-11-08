// Per-season obstacle extraction config + pipeline.
// Manual source of record for classifications/dimensions: each season's
// official Game Manual §5 (ARENA) — 2026: https://www.frcmanual.com/2026/arena
// (checked 2026-11-08). Field constants + AprilTag layouts come from
// @pathblender/core (run `npm run build -w @pathblender/core` first — plain
// Node resolves the workspace package to its dist).
//
// Geometry discipline (red book §6.7): every hull below is extracted from the
// bundled official-CAD GLB by code; config rows carry citations, never
// hand-typed coordinates. UNVERIFIED gaps are marked inline.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@pathblender/core';
import {
  parseGlb,
  elementGroups,
  worldMatrices,
  makeNativeToWorld,
  hullPointsOfGroup,
  clipConvexHullToRect,
  pointNearHull,
  accessorVertices,
} from './extract.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FIELDS3D_DIR = resolve(SCRIPT_DIR, '../../packages/web/public/fields3d');
const DATA_OUT = resolve(SCRIPT_DIR, '../../packages/core/src/field-obstacles-data.ts');

export const glbPath = (dir) => resolve(FIELDS3D_DIR, dir, 'model.glb');
export const configPath = (dir) => resolve(FIELDS3D_DIR, dir, 'config.json');

/** Same rule as packages/web/src/field3d-frame.ts:118 (configMirrorAxis):
 *  a `z:180°` rotations entry ⇒ 'x', else 'z'. The generator always derives
 *  the mirror from the shipped config.json — never a hand-set axis. */
export function configMirrorAxis(rotations) {
  const turn = (deg) => ((deg % 360) + 360) % 360;
  return rotations.some((r) => r.axis === 'z' && Math.abs(turn(r.degrees) - 180) < 1e-6)
    ? 'x'
    : 'z';
}

export { pointNearHull };

export const SEASONS = [
  {
    fieldId: 'rebuilt-2026',
    // Single welded GLB ships for 2026 (FIELD3D_MODELS has no andymark entry);
    // obstaclesForField falls back to welded for the andymark variant. The
    // AndyMark structure offsets measured in field3d-frame.ts (~14 mm) are far
    // below the 3 in collision tolerance.
    glbDir: { welded: '2026-rebuilt' },
    // Band rationale (deviation from plan's 1.5 m, recorded in the plan file's
    // spirit of honesty over literalism): the bumper model is flat 2D, so any
    // in-band vertex extends the hull horizontally. The 2026 hub's net poles
    // lean outward only above ~0.9 m — a 1.5 m band would mark legally
    // drivable space behind them as blocked. [0, 0.5] m is a superset of the
    // FRC bumper zone that excludes high-only overhangs while keeping every
    // structure a bumper can actually touch (hubs, towers, stage legs,
    // coral stations — all present from the floor).
    bandTopM: 0.5,
    elements: [
      {
        match: /^GE-26300: Hub /, id: 'hub', name: 'Hub', action: 'include', alliancePaired: true,
        reason: '47 in square prism from the floor (§5.4) — blocks ground robots',
        citation: '2026 Game Manual §5.4 (HUB)',
      },
      {
        match: /^GE-26500: Tower /, id: 'tower', name: 'Tower', action: 'include', alliancePaired: true,
        reason: 'uprights rise from the floor inside the ALLIANCE ZONE (§5.8)',
        citation: '2026 Game Manual §5.8 (TOWER)',
      },
      {
        match: /^GE-26200: Trench /, id: 'trench', name: 'Trench', action: 'exclude',
        reason: 'structure ROBOTS drive underneath (§5.6)',
        citation: '2026 Game Manual §5.6 (TRENCH)',
      },
      {
        match: /^GE-26100: Bump /, id: 'bump', name: 'Bump', action: 'exclude',
        reason: '6.513 in tall structures ROBOTS drive over (§5.5) — in the bumper band but explicitly traversable',
        citation: '2026 Game Manual §5.5 (BUMP)',
      },
      {
        match: /^GE-26000: Outpost /, id: 'outpost', name: 'Outpost', action: 'exclude',
        reason: 'part of the field boundary (§5.2: the FIELD is bounded by ALLIANCE WALLS, OUTPOSTS, TOWER WALLS, guardrails); boundary crossings are detectFieldBounds\' domain. Its GLB assembly sits at/outside the playfield corner — the in-field sliver is 1.9 cm, below the 3 in tolerance either way',
        citation: '2026 Game Manual §5.2, §5.9.2',
      },
      {
        match: /^GE-26600: Depot /, id: 'depot', name: 'Depot', action: 'exclude',
        reason: '1.125 in (2.86 cm) floor barrier (§5.7) — max possible bumper overlap 0.029 m < 0.0762 m tolerance, can never report; the DEPOT sits inside the ALLIANCE ZONE robots legally occupy (§5.3). GLB cross-check: extracted footprint 0.6858 × 1.0668 m = 27 in × 42 in exactly',
        citation: '2026 Game Manual §5.7 (DEPOT), §5.3',
      },
      {
        match: /^GE-26900: Fuel$/, id: 'fuel', name: 'Fuel', action: 'exclude',
        reason: 'SCORING ELEMENTS (5.91 in foam balls), not field structure',
        citation: '2026 Game Manual §5.10 (FUEL)',
      },
      {
        match: /^FE-2026-02: /, id: 'perimeter', name: 'Perimeter', action: 'exclude',
        reason: 'welded perimeter assembly (walls + guardrails) — owned by detectFieldBounds',
        citation: '2026 Game Manual §5.2',
      },
      {
        match: /^FE-2026-01: |^(Gaffer|Carpet) /, id: 'markings', name: 'Markings', action: 'exclude',
        reason: 'carpet + gaffer-tape field markings',
        citation: '2026 Game Manual §5.2, §5.3',
      },
    ],
    // Tag→element assignment per §5.10 (HUB tag IDs; TOWER WALL tags) with the
    // x-split pinned by the WPILib welded layout. Hub tags are face-mounted at
    // z=1.124 m (44.25 in, §5.10) — admissible anchors because the §5.4 prism
    // cross-section at that height is still the full 47 in square (they do not
    // hover past the base the way reef-top tags do). Trench tags 1/6/7/12/17/
    // 22/23/28 and outpost tags 13/14/29/30 belong to excluded elements.
    tagAnchors: [
      { obstacleId: 'hub-blue', tagIds: [18, 19, 20, 21, 24, 25, 26, 27], citation: '§5.10 HUB IDs, WPILib welded layout' },
      { obstacleId: 'hub-red', tagIds: [2, 3, 4, 5, 8, 9, 10, 11], citation: '§5.10 HUB IDs, WPILib welded layout' },
      { obstacleId: 'tower-blue', tagIds: [31, 32], citation: '§5.10 TOWER WALL IDs (z=0.5524 m)' },
      { obstacleId: 'tower-red', tagIds: [15, 16], citation: '§5.10 TOWER WALL IDs (z=0.5524 m)' },
    ],
    // Values re-derived from the manual + field.ts REBUILT_2026 comments
    // (§5.4 + §5.3 starting line). 47 in = 1.1938 m exactly.
    manualDims: [
      { obstacleId: 'hub-blue', kind: 'span', axis: 'x', expectM: 1.1938, tolM: 0.02, citation: '§5.4 47 in' },
      { obstacleId: 'hub-blue', kind: 'span', axis: 'y', expectM: 1.1938, tolM: 0.02, citation: '§5.4 47 in' },
      { obstacleId: 'hub-blue', kind: 'min', axis: 'x', expectM: 4.0284, tolM: 0.02, citation: '§5.4 + §5.3: 158.6 in starting line' },
      { obstacleId: 'hub-blue', kind: 'center', axis: 'y', expectM: 4.0346, tolM: 0.02, citation: '§5.4 centered on midline' },
      { obstacleId: 'hub-red', kind: 'span', axis: 'x', expectM: 1.1938, tolM: 0.02, citation: '§5.4 47 in' },
      { obstacleId: 'hub-red', kind: 'span', axis: 'y', expectM: 1.1938, tolM: 0.02, citation: '§5.4 47 in' },
      { obstacleId: 'hub-red', kind: 'max', axis: 'x', expectM: 16.54 - 4.0284, tolM: 0.02, citation: '§5.4 mirrored: 158.6 in from red wall' },
      { obstacleId: 'hub-red', kind: 'center', axis: 'y', expectM: 4.0346, tolM: 0.02, citation: '§5.4 centered on midline' },
      { obstacleId: 'tower-blue', kind: 'span', axis: 'y', expectM: 1.25095, tolM: 0.02, citation: '§5.8 49.25 in wide' },
      { obstacleId: 'tower-blue', kind: 'max', axis: 'x', expectM: 1.143, tolM: 0.02, citation: '§5.8 45.0 in deep (base plate 45.18 in)' },
      { obstacleId: 'tower-red', kind: 'span', axis: 'y', expectM: 1.25095, tolM: 0.02, citation: '§5.8 49.25 in wide' },
      { obstacleId: 'tower-red', kind: 'min', axis: 'x', expectM: 16.54 - 1.143, tolM: 0.02, citation: '§5.8 45.0 in deep, mirrored' },
    ],
  },
];

/** Group classification: first matching row wins. */
function classify(season, groups) {
  const errors = [];
  const classified = groups.map((g) => {
    const row = season.elements.find((r) => r.match.test(g.name));
    if (!row) errors.push(`no config row matches group ${JSON.stringify(g.name)}`);
    return { group: g, row };
  });
  for (const r of season.elements) {
    if (r.action === 'include' && !classified.some((c) => c.row === r)) {
      errors.push(`include row ${r.id} matches no group`);
    }
  }
  return { classified, errors };
}

const round4 = (v) => Math.round(v * 1e4) / 1e4;

/** Extract + validate one season → variant-set object for FIELD_OBSTACLE_DATA.
 *  Throws on any validation failure (never a best-effort write). */
export async function extractSeason(season) {
  const field = core.FIELDS.find((f) => f.id === season.fieldId);
  if (!field) throw new Error(`unknown field ${season.fieldId} (is @pathblender/core dist built?)`);
  const out = {};
  for (const variant of Object.keys(season.glbDir)) {
    const dir = season.glbDir[variant];
    const cfg = JSON.parse(readFileSync(configPath(dir), 'utf8'));
    const mirror = configMirrorAxis(cfg.rotations);
    const cx = field.lengthM / 2;
    const cy = field.widthM / 2;
    const toWorld = makeNativeToWorld(mirror, cx, cy);
    const { json, bin } = parseGlb(readFileSync(glbPath(dir)));
    const groups = elementGroups(json);
    const { classified, errors } = classify(season, groups);
    const obstacles = [];
    const seenIds = new Set();
    for (const { group, row } of classified) {
      if (row?.action !== 'include') continue;
      const { hull, zMinM, zMaxM } = hullPointsOfGroup(json, bin, group, {
        zMin: 0,
        zMax: season.bandTopM,
        toWorld,
      });
      if (hull.length < 3) {
        errors.push(`${group.name}: in-band hull has < 3 points`);
        continue;
      }
      const clipped = clipConvexHullToRect(hull, 0, 0, field.lengthM, field.widthM);
      if (!clipped || clipped.length < 3) {
        errors.push(`${group.name}: hull empty after playfield clip`);
        continue;
      }
      // Alliance suffix from centroid x (never assigned by hand).
      const centroidX = clipped.reduce((s, p) => s + p.x, 0) / clipped.length;
      const suffix = row.alliancePaired ? (centroidX < field.lengthM / 2 ? 'blue' : 'red') : '';
      const id = `${row.id}${suffix ? `-${suffix}` : ''}`;
      if (seenIds.has(id)) errors.push(`duplicate obstacle id ${id}`);
      seenIds.add(id);
      obstacles.push({
        id,
        name: row.name,
        hull: clipped.map((p) => ({ x: round4(p.x), y: round4(p.y) })),
        zMinM: round4(zMinM),
        zMaxM: round4(zMaxM),
      });
    }
    obstacles.sort((a, b) => a.id.localeCompare(b.id));

    // Per-variant tag anchors + manual dims + containment.
    const layout = variant === 'andymark' && field.aprilTagsAndyMark ? field.aprilTagsAndyMark : field.aprilTags;
    const tags = new Map((layout ?? []).map((t) => [t.id, t]));
    const byId = new Map(obstacles.map((o) => [o.id, o]));
    for (const anchor of season.tagAnchors) {
      const o = byId.get(anchor.obstacleId);
      if (!o) {
        errors.push(`tagAnchor ${anchor.obstacleId}: no such obstacle`);
        continue;
      }
      for (const id of anchor.tagIds) {
        const tag = tags.get(id);
        if (!tag) {
          errors.push(`tagAnchor ${anchor.obstacleId}: tag ${id} missing from layout`);
          continue;
        }
        if (!pointNearHull({ x: tag.x, y: tag.y }, o.hull, 0.05)) {
          errors.push(`tagAnchor ${anchor.obstacleId} tag ${id} at (${tag.x},${tag.y}) not on/inside hull`);
        }
      }
    }
    for (const dim of season.manualDims) {
      const o = byId.get(dim.obstacleId);
      if (!o) {
        errors.push(`manualDim ${dim.obstacleId}: no such obstacle`);
        continue;
      }
      const vals = o.hull.map((p) => p[dim.axis]);
      const got =
        dim.kind === 'span' ? Math.max(...vals) - Math.min(...vals)
        : dim.kind === 'center' ? (Math.max(...vals) + Math.min(...vals)) / 2
        : dim.kind === 'min' ? Math.min(...vals)
        : Math.max(...vals);
      if (Math.abs(got - dim.expectM) > dim.tolM) {
        errors.push(`manualDim ${dim.obstacleId} ${dim.kind}/${dim.axis}: got ${got.toFixed(4)}, want ${dim.expectM} ±${dim.tolM} (${dim.citation})`);
      }
    }
    for (const o of obstacles) {
      for (const p of o.hull) {
        if (p.x < -0.05 || p.x > field.lengthM + 0.05 || p.y < -0.05 || p.y > field.widthM + 0.05) {
          errors.push(`${o.id}: hull vertex (${p.x},${p.y}) outside playfield ± 0.05`);
        }
      }
    }
    if (errors.length > 0) {
      throw new Error(`${season.fieldId}/${variant} validation failed:\n  ${errors.join('\n  ')}`);
    }
    out[variant] = obstacles;
  }
  return out;
}

/** Render FIELD_OBSTACLE_DATA file content for the given extraction results. */
export function renderDataFile(results) {
  const header = `// GENERATED FILE — do not edit by hand. Regenerate: node scripts/field-obstacles/extract-footprints.mjs
// Source geometry: AdvantageScopeAssets Field3d GLBs (BSD-3-Clause), derived from official FIRST CAD.
// Validated per season against WPILib AprilTag layouts and official game-manual dimensions
// (see scripts/field-obstacles/seasons.mjs for citations). No coordinate in this file is hand-typed.
import type { FieldObstacleVariantSet } from './field-obstacles';

export const FIELD_OBSTACLE_DATA: Record<string, FieldObstacleVariantSet> = {
`;
  const body = Object.keys(results)
    .sort()
    .map((fieldId) => {
      const set = results[fieldId];
      const variants = Object.keys(set)
        .sort()
        .map((variant) => {
          const arr = set[variant].map((o) => {
            const hull = o.hull.map((p) => `          { x: ${p.x}, y: ${p.y} },`).join('\n');
            return `      {
        id: '${o.id}',
        name: '${o.name}',
        hull: [
${hull}
        ],
        zMinM: ${o.zMinM},
        zMaxM: ${o.zMaxM},
      },`;
          }).join('\n');
          return `    ${variant}: [
${arr}
    ],`;
        })
        .join('\n');
      return `  '${fieldId}': {
${variants}
  },`;
    })
    .join('\n');
  return `${header}${body}\n};\n`;
}

/** --list support: name, mesh-node count, world AABB of every group. */
export function listGroups(dir, mirror, cx, cy) {
  const { json, bin } = parseGlb(readFileSync(glbPath(dir)));
  const toWorld = makeNativeToWorld(mirror, cx, cy);
  const world = worldMatrices(json);
  const rows = [];
  for (const g of elementGroups(json)) {
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    let meshNodes = 0;
    for (const ni of g.nodeIndices) {
      const node = json.nodes[ni];
      if (node.mesh === undefined) continue;
      meshNodes++;
      const m = world[ni];
      for (const prim of json.meshes[node.mesh].primitives) {
        for (const v of accessorVertices(json, bin, prim.attributes.POSITION)) {
          const p = [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2] + m[i][3]);
          const w = toWorld(p);
          lo = [Math.min(lo[0], w.x), Math.min(lo[1], w.y), Math.min(lo[2], w.height)];
          hi = [Math.max(hi[0], w.x), Math.max(hi[1], w.y), Math.max(hi[2], w.height)];
        }
      }
    }
    rows.push({ name: g.name, meshNodes, aabb: { lo: lo.map((v) => round4(v)), hi: hi.map((v) => round4(v)) } });
  }
  return rows;
}

export { DATA_OUT };
