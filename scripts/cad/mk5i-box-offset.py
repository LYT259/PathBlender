#!/usr/bin/env python3
"""Shift the mk5i-box vertices in the shipped MK5i module GLB (stdlib only).

Run:
  python3 scripts/cad/mk5i-box-offset.py <input.glb> <output.glb> [dz]

Why (2026-10-04): the replica GLB (DesignApp STEP, source lost) centers
the wheel column in the module footprint, but on the real MK5i the
wheel is biased to the corner of the drivebase — the steering axis sits
2.58-2.62 in / 2.55 in from two edges of the 7.45 in square module
envelope (measured on the official SDS MK5i layout drawing,
140.3 px/in calibration), so the box body center is offset from the
steering axis by ~41 mm along the wheel-bias diagonal. Rendered as
shipped, the box hangs ~4 cm too far past the frame rails (over the
bumper zone) instead of tucking into the frame corner. The turret
(wheel fork) stays put — moduleLocations in trajectory files are the
steering axis, which is the wheel floor origin of this GLB.

Template local frame: +X = rolling direction, +Y = up, so +/-Z is the
radial direction in the parked windmill pose. dz = -0.041 moves the
box radially inward (wheel ends up biased toward the chassis corner).
Pure vertex translation in place: same primitives, materials, indices;
only POSITION floats and their accessor min/max change.
"""

import json
import struct
import sys


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


def main():
    src, dst = sys.argv[1], sys.argv[2]
    dz = float(sys.argv[3]) if len(sys.argv) > 3 else -0.041
    js, bin_ = load_glb(src)
    bin_ = bytearray(bin_)

    patched = 0
    for mesh in js['meshes']:
        if not mesh.get('name', '').startswith('mk5i-box'):
            continue
        for prim in mesh['primitives']:
            ai = prim['attributes']['POSITION']
            acc = js['accessors'][ai]
            assert acc['componentType'] == 5126 and acc['type'] == 'VEC3'
            bv = js['bufferViews'][acc['bufferView']]
            base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
            stride = bv.get('byteStride', 12)
            for i in range(acc['count']):
                off = base + i * stride + 8  # z float
                z, = struct.unpack_from('<f', bin_, off)
                struct.pack_into('<f', bin_, off, z + dz)
            acc['min'][2] += dz
            acc['max'][2] += dz
            patched += acc['count']

    if patched == 0:
        raise SystemExit('no mk5i-box vertices found — mesh naming changed?')
    print('[offset] shifted %d box vertices by dz=%.4f' % (patched, dz))

    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((-len(jb)) % 4)
    bb = bytes(bin_) + b'\x00' * ((-len(bin_)) % 4)
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
