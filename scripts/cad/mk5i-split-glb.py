#!/usr/bin/env python3
"""Split the shipped MK5i module GLB into box + turret nodes (stdlib only).

Run:
  python3 scripts/cad/mk5i-split-glb.py <input.glb> <output.glb>

Why (2026-10-03): mk5i-convert.py joins by active material, welding
wheel + turret fork + top plate + L plate into one rigid mk5i-b mesh,
so the app could only yaw the WHOLE module. On the real robot the box
(top plate, both Kraken motors, L plate) is bolted to the rail and only
the turret fork + wheel steer. The DesignApp source STEP is gone and
the chassis STEP's module internals are mis-mated (its Top Assembly +
Krakens hang below the wheel floor — measured 2026-10-03), so the split
runs on the shipped GLB itself, per TRIANGLE:

  turret: every vertex inside the fork/wheel column around the steering
          axis (|x| <= 51.8 mm, |z| <= 51.8 mm — fork bbox measured on
          the chassis STEP's named Turret Assembly) AND either touching
          the floor (the wheel, y <= 1 mm) or no taller than the fork
          (y <= 77.5 mm);
  box:    everything else. Boundary-spanning triangles fall to the box
          (conservative), and the only box parts fully inside the column
          are the rotation-symmetric center gear/shaft, whose yaw is
          visually indistinguishable.

Geometry is already decimated/color-muted and satisfies the runtime
contract (origin = steering axis on the wheel floor, +X = rolling
direction) — this is a pure re-grouping: no decimate, no calibration.
Output: flat scene with two identity nodes, `mk5i-turret` (steers) and
`mk5i-box` (frozen at the installed yaw), materials preserved.
"""

import json
import math
import struct
import sys

PLAN_LIMIT = 0.0518
FLOOR_Y = 0.001
FORK_TOP_Y = 0.0775


def load_glb(path):
    data = open(path, 'rb').read()
    assert data[:4] == b'glTF', 'not a GLB'
    off, js, bin_ = 12, None, None
    while off < len(data):
        ln, ty = struct.unpack_from('<I4s', data, off)
        off += 8
        if ty == b'JSON':
            js = json.loads(data[off:off + ln])
        elif ty == b'BIN\x00':
            bin_ = data[off:off + ln]
        off += ln
    assert 'textures' not in js and 'images' not in js, 'textured GLB not supported'
    return js, bin_


def read_accessor(js, bin_, ai, char, comps):
    """Read an accessor as a list of tuples (comps > 1) or scalars (comps == 1)."""
    acc = js['accessors'][ai]
    bv = js['bufferViews'][acc['bufferView']]
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    rec = '<' + char * comps
    size = struct.calcsize(rec)
    stride = bv.get('byteStride', size)
    out = []
    for i in range(acc['count']):
        v = struct.unpack_from(rec, bin_, base + i * stride)
        out.append(v[0] if comps == 1 else v)
    return out


INDEX_CHAR = {5121: 'B', 5123: 'H', 5125: 'I'}


def trs_matrix(node):
    if 'matrix' in node:
        return list(node['matrix'])
    t = node.get('translation', [0, 0, 0])
    q = node.get('rotation', [0, 0, 0, 1])
    s = node.get('scale', [1, 1, 1])
    x, y, z, w = q
    m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
         0, 0, 0, 1]
    for c in range(3):
        for r in range(3):
            m[c * 4 + r] *= s[c]
    m[12], m[13], m[14] = t
    return m


def mat_mul(a, b):
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def xform(m, v):
    x, y, z = v
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


def xform_dir(m, v):
    x, y, z = v
    return (m[0] * x + m[4] * y + m[8] * z,
            m[1] * x + m[5] * y + m[9] * z,
            m[2] * x + m[6] * y + m[10] * z)


def is_turret(tri):
    for x, y, z in tri:
        if abs(x) > PLAN_LIMIT or abs(z) > PLAN_LIMIT:
            return False
    ymin = min(v[1] for v in tri)
    ymax = max(v[1] for v in tri)
    return ymin <= FLOOR_Y or ymax <= FORK_TOP_Y


def main():
    src, dst = sys.argv[1], sys.argv[2]
    js, bin_ = load_glb(src)

    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    # (partition) -> list of (material, positions, normals, indices)
    out = {'mk5i-box': [], 'mk5i-turret': []}
    totals = {'mk5i-box': 0, 'mk5i-turret': 0}

    def walk(ni, parent):
        node = js['nodes'][ni]
        world = mat_mul(parent, trs_matrix(node))
        if 'mesh' in node:
            for prim in js['meshes'][node['mesh']]['primitives']:
                pos = read_accessor(js, bin_, prim['attributes']['POSITION'], 'f', 3)
                nrm = (read_accessor(js, bin_, prim['attributes']['NORMAL'], 'f', 3)
                       if 'NORMAL' in prim['attributes'] else None)
                idx = read_accessor(js, bin_, prim['indices'],
                                    INDEX_CHAR[js['accessors'][prim['indices']]['componentType']], 1)
                mat = prim.get('material')
                wpos = [xform(world, v) for v in pos]
                wnrm = [xform_dir(world, v) for v in nrm] if nrm else None
                bags = {'mk5i-box': ([], [], []), 'mk5i-turret': ([], [], [])}
                vmap = {'mk5i-box': {}, 'mk5i-turret': {}}
                for t in range(0, len(idx), 3):
                    tri = [wpos[idx[t]], wpos[idx[t + 1]], wpos[idx[t + 2]]]
                    part = 'mk5i-turret' if is_turret(tri) else 'mk5i-box'
                    vp, np_, ip = bags[part]
                    vm = vmap[part]
                    for k in range(3):
                        vi = idx[t + k]
                        if vi not in vm:
                            vm[vi] = len(vp)
                            vp.append(wpos[vi])
                            if wnrm:
                                np_.append(wnrm[vi])
                        ip.append(vm[vi])
                for part, (vp, np_, ip) in bags.items():
                    if ip:
                        out[part].append((mat, vp, np_ if wnrm else None, ip))
                        totals[part] += len(ip) // 3
        for c in node.get('children', []):
            walk(c, world)

    for ni in js['scenes'][js.get('scene', 0)]['nodes']:
        walk(ni, ident)

    print('[split] box %d tris, turret %d tris' % (totals['mk5i-box'], totals['mk5i-turret']))
    if totals['mk5i-turret'] == 0:
        raise SystemExit('no turret triangles — classification rule broken')

    # --- write the new GLB ---
    blob = bytearray()
    accessors, buffer_views, meshes, nodes = [], [], [], []

    def add_view(data, target):
        pad = (-len(blob)) % 4
        blob.extend(b'\x00' * pad)
        buffer_views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
        blob.extend(data)
        return len(buffer_views) - 1

    def add_accessor(view, ctype, count, minmax=None):
        acc = {'bufferView': view, 'componentType': 5126 if ctype == 'VEC3' else 5125,
               'count': count, 'type': ctype}
        if minmax:
            acc['min'], acc['max'] = minmax
        accessors.append(acc)
        return len(accessors) - 1

    for part in ('mk5i-turret', 'mk5i-box'):
        prims = []
        for mat, vp, np_, ip in out[part]:
            pv = struct.pack('<%df' % (len(vp) * 3), *[c for v in vp for c in v])
            pa = add_accessor(add_view(pv, 34962), 'VEC3', len(vp),
                              ([min(v[k] for v in vp) for k in range(3)],
                               [max(v[k] for v in vp) for k in range(3)]))
            attrs = {'POSITION': pa}
            if np_:
                nv = struct.pack('<%df' % (len(np_) * 3), *[c for v in np_ for c in v])
                attrs['NORMAL'] = add_accessor(add_view(nv, 34962), 'VEC3', len(np_))
            iv = struct.pack('<%dI' % len(ip), *ip)
            ia = add_accessor(add_view(iv, 34963), 'SCALAR', len(ip))
            p = {'attributes': attrs, 'indices': ia, 'mode': 4}
            if mat is not None:
                p['material'] = mat
            prims.append(p)
        meshes.append({'name': part, 'primitives': prims})
        nodes.append({'name': part, 'mesh': len(meshes) - 1})

    out_js = {
        'asset': {'version': '2.0', 'generator': 'mk5i-split-glb.py'},
        'scene': 0,
        'scenes': [{'nodes': list(range(len(nodes)))}],
        'nodes': nodes,
        'meshes': meshes,
        'materials': js.get('materials', []),
        'accessors': accessors,
        'bufferViews': buffer_views,
        'buffers': [{'byteLength': len(blob)}],
    }
    jb = json.dumps(out_js, separators=(',', ':')).encode()
    jb += b' ' * ((-len(jb)) % 4)
    bb = bytes(blob) + b'\x00' * ((-len(blob)) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bb)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(jb), b'JSON'))
        f.write(jb)
        f.write(struct.pack('<I4s', len(bb), b'BIN\x00'))
        f.write(bb)
    print('[done] wrote %s (%d bytes)' % (dst, total))


if __name__ == '__main__':
    main()
