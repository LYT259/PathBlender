// Dependency-free GLB → obstacle-footprint extraction library.
// Consumed by extract-footprints.mjs and packages/web/test/field-obstacles-extract.test.ts.
//
// Transform contract (identical to packages/web/src/field3d-frame.ts, which is
// registration-verified to ≤ 11–15 mm against these same shipped assets —
// see packages/web/test/field3d-model.test.ts):
//   1. native GLB frame is Y-up; the config mount for the shipped models is
//      Rx(90°) → reflect Z (mirror 'z': (x, y, −z)) or Rz(180°)·Rx(90°) →
//      reflect X (mirror 'x': (−x, y, z)) — see configMirrorAxis;
//   2. world (WPILib blue frame): x = cx − X, y = cy − Z, height = Y,
//      where (cx, cy) is the playfield centre in world meters.
// Plain ESM JavaScript (no TypeScript transform rules apply).

/** Parse a GLB container into { json, bin } (bin = Buffer, possibly empty). */
export function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: bad magic');
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`unsupported GLB version ${version}`);
  const total = buf.readUInt32LE(8);
  let off = 12;
  let json;
  let bin = Buffer.alloc(0);
  while (off < total) {
    const clen = buf.readUInt32LE(off);
    const ctype = buf.readUInt32LE(off + 4);
    if (ctype === 0x4e4f534a) {
      json = JSON.parse(buf.toString('utf8', off + 8, off + 8 + clen));
    } else if (ctype === 0x004e4942) {
      bin = buf.subarray(off + 8, off + 8 + clen);
    }
    off += 8 + clen;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

// ---- 4x4 row-major matrix helpers (hand-written; zero dependencies) ----

function identity4() {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

function mul4(a, b) {
  const out = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i][k] * b[k][j];
      out[i][j] = s;
    }
  }
  return out;
}

function translation4(t) {
  const m = identity4();
  m[0][3] = t[0];
  m[1][3] = t[1];
  m[2][3] = t[2];
  return m;
}

function scale4(s) {
  const m = identity4();
  m[0][0] = s[0];
  m[1][1] = s[1];
  m[2][2] = s[2];
  return m;
}

/** Quaternion (x, y, z, w) → 3x3 rotation, row-major (right-handed, column vectors). */
function quatToMat3(q) {
  const [x, y, z, w] = q;
  const n = x * x + y * y + z * z + w * w;
  const s = n > 0 ? 2 / n : 0;
  const xx = x * x * s, yy = y * y * s, zz = z * z * s;
  const xy = x * y * s, xz = x * z * s, yz = y * z * s;
  const wx = w * x * s, wy = w * y * s, wz = w * z * s;
  return [
    [1 - (yy + zz), xy - wz, xz + wy],
    [xy + wz, 1 - (xx + zz), yz - wx],
    [xz - wy, yz + wx, 1 - (xx + yy)],
  ];
}

function rotation4(q) {
  const r = quatToMat3(q);
  return [
    [r[0][0], r[0][1], r[0][2], 0],
    [r[1][0], r[1][1], r[1][2], 0],
    [r[2][0], r[2][1], r[2][2], 0],
    [0, 0, 0, 1],
  ];
}

/**
 * Node local matrix as a 4x4 row-major nested array: node.matrix (glTF
 * stores column-major, transposed here) or the TRS compose T·R·S.
 */
export function localMatrix(node) {
  if (node.matrix) {
    const c = node.matrix;
    return [
      [c[0], c[4], c[8], c[12]],
      [c[1], c[5], c[9], c[13]],
      [c[2], c[6], c[10], c[14]],
      [c[3], c[7], c[11], c[15]],
    ];
  }
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  return mul4(mul4(translation4(t), rotation4(r)), scale4(s));
}

/** Apply a 4x4 row-major matrix to a [x, y, z] point. */
function apply4(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
    m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
    m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3],
  ];
}

/** World matrices of every node (product of ancestor locals, three-style). */
export function worldMatrices(json) {
  const world = new Array(json.nodes.length).fill(undefined);
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  const walk = (i, parent) => {
    const m = mul4(parent, localMatrix(json.nodes[i]));
    world[i] = m;
    for (const c of json.nodes[i].children ?? []) walk(c, m);
  };
  for (const r of roots) walk(r, identity4());
  return world;
}

/**
 * Element assemblies: every child of every scene root is one group (the
 * shipped models are scene → 1 root → element assemblies → parts/meshes);
 * a childless root is itself a group. nodeIndices = the full subtree.
 */
export function elementGroups(json) {
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  const groups = [];
  const collect = (i, acc) => {
    acc.push(i);
    for (const c of json.nodes[i].children ?? []) collect(c, acc);
    return acc;
  };
  for (const r of roots) {
    const children = json.nodes[r].children ?? [];
    if (children.length === 0) {
      groups.push({ name: json.nodes[r].name ?? `node-${r}`, nodeIndices: [r] });
      continue;
    }
    for (const c of children) {
      groups.push({ name: json.nodes[c].name ?? `node-${c}`, nodeIndices: collect(c, []) });
    }
  }
  return groups;
}

/**
 * The two-step native → blue-world map (see file header). mirror 'z' is
 * reflect Z then centre; mirror 'x' is reflect X then centre.
 */
export function makeNativeToWorld(mirror, cx, cy) {
  return (p) => {
    if (mirror === 'z') {
      // render (X, Y, Z) = (x, y, −z)
      return { x: cx - p[0], y: cy + p[2], height: p[1] };
    }
    if (mirror === 'x') {
      // render (X, Y, Z) = (−x, y, z)
      return { x: cx + p[0], y: cy - p[2], height: p[1] };
    }
    throw new Error(`unknown mirror ${mirror}`);
  };
}

/** Cross product of OA→OB and OA→OC. */
function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Andrew's monotone chain convex hull, CCW, no closing duplicate.
 * Throws when fewer than 3 unique non-collinear points remain.
 */
export function monotoneChainHull(points) {
  const uniq = [];
  const seen = new Set();
  for (const p of points) {
    const key = `${p.x} ${p.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(p);
    }
  }
  uniq.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const lower = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  };
  const upper = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  if (hull.length < 3) {
    throw new Error(`degenerate hull: ${hull.length} hull vertices from ${points.length} points (need >= 3 non-collinear)`);
  }
  return hull;
}

/** Decode a POSITION accessor's vertices as [x, y, z] arrays. */
export function accessorVertices(json, bin, accessorIndex) {
  const acc = json.accessors[accessorIndex];
  if (!acc) throw new Error(`missing accessor ${accessorIndex}`);
  if (acc.componentType !== 5126) throw new Error(`unsupported componentType ${acc.componentType} (FLOAT only)`);
  if (acc.type !== 'VEC3') throw new Error(`unsupported accessor type ${acc.type}`);
  const view = json.bufferViews[acc.bufferView];
  if (!view) throw new Error(`missing bufferView ${acc.bufferView}`);
  const stride = view.byteStride ?? 0;
  if (stride !== 0 && stride !== 12) throw new Error(`unsupported byteStride ${stride} (0 or 12)`);
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < acc.count; i++) {
    const off = base + i * (stride || 12);
    const x = bin.readFloatLE(off);
    const y = bin.readFloatLE(off + 4);
    const z = bin.readFloatLE(off + 8);
    out.push([x, y, z]);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  // Sanity cross-check against declared min/max when present.
  if (acc.min) {
    for (const [got, want] of [[minX, acc.min[0]], [minY, acc.min[1]], [minZ, acc.min[2]]]) {
      if (Math.abs(got - want) > 1e-3) throw new Error(`accessor ${accessorIndex} min mismatch: computed ${got} vs declared ${want}`);
    }
  }
  if (acc.max) {
    for (const [got, want] of [[maxX, acc.max[0]], [maxY, acc.max[1]], [maxZ, acc.max[2]]]) {
      if (Math.abs(got - want) > 1e-3) throw new Error(`accessor ${accessorIndex} max mismatch: computed ${got} vs declared ${want}`);
    }
  }
  return out;
}

/**
 * Blue-world convex hull of one element group's in-band vertices.
 * Band filter applies to the native height (Y); hull over the mapped world
 * (x, y) — reflection happens BEFORE the hull so the result is CCW in the
 * world frame (a reflection would flip orientation).
 */
export function hullPointsOfGroup(json, bin, group, { zMin, zMax, toWorld }) {
  const world = worldMatrices(json);
  const pts = [];
  let zLo = Infinity;
  let zHi = -Infinity;
  let vertexCount = 0;
  for (const ni of group.nodeIndices) {
    const node = json.nodes[ni];
    if (node.mesh === undefined) continue;
    const m = world[ni];
    if (!m) throw new Error(`node ${ni} (${node.name}) unreachable from the scene`);
    for (const prim of json.meshes[node.mesh].primitives) {
      const verts = accessorVertices(json, bin, prim.attributes.POSITION);
      for (const v of verts) {
        const [nx, ny, nz] = apply4(m, v);
        if (ny < zMin || ny > zMax) continue;
        const w = toWorld([nx, ny, nz]);
        pts.push({ x: w.x, y: w.y });
        if (ny < zLo) zLo = ny;
        if (ny > zHi) zHi = ny;
        vertexCount++;
      }
    }
  }
  if (pts.length === 0) {
    return { hull: [], zMinM: NaN, zMaxM: NaN, vertexCount: 0 };
  }
  const hull = monotoneChainHull(pts);
  return { hull, zMinM: zLo, zMaxM: zHi, vertexCount };
}
