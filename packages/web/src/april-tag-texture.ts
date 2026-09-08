/**
 * Real 36h11 AprilTag faces (the FRC standard family) rendered to canvas
 * textures for the 3D field view.
 *
 * Code words and bit layout follow the reference tables shipped in wpilib's
 * apriltag thirdparty (tag36h11.c, BSD-2-Clause, © The Regents of The
 * University of Michigan / Edwin Olson) — reproduced as data:
 *   - CODES: id → 36-bit code word (bit i = MSB-first over i = 0..35)
 *   - BIT_X / BIT_Y: module coordinates of data bit i (1-based, inside a
 *     10×10 module grid: 1-module white quiet ring + 8×8 black field with
 *     a 6×6 data area, per the reference `apriltag_to_image` renderer)
 */

import * as THREE from 'three';

const CODES: bigint[] = [
  0x0000000d7e00984bn, 0x0000000dda664ca7n, 0x0000000dc4a1c821n, 0x0000000e17b470e9n,
  0x0000000ef91d01b1n, 0x0000000f429cdd73n, 0x000000005da29225n, 0x00000001106cba43n,
  0x0000000223bed79dn, 0x000000021f51213cn, 0x000000033eb19ca6n, 0x00000003f76eb0f8n,
  0x0000000469a97414n, 0x000000045dcfe0b0n, 0x00000004a6465f72n, 0x000000051801db96n,
  0x00000005eb946b4en, 0x000000068a7cc2ecn, 0x00000006f0ba2652n, 0x000000078765559dn,
  0x000000087b83d129n, 0x000000086cc4a5c5n, 0x00000008b64df90fn, 0x00000009c577b611n,
  0x0000000a3810f2f5n, 0x0000000af4d75b83n, 0x0000000b59a03fefn, 0x0000000bb1096f85n,
  0x0000000d1b92fc76n, 0x0000000d0dd509d2n, 0x0000000e2cfda160n, 0x00000002ff497c63n,
  0x000000047240671bn, 0x00000005047a2e55n, 0x0000000635ca87c7n, 0x0000000691254166n,
  0x000000068f43d94an, 0x00000006ef24bdb6n, 0x00000008cdd8f886n, 0x00000009de96b718n,
  0x0000000aff6e5a8an, 0x0000000bae46f029n, 0x0000000d225b6d59n, 0x0000000df8ba8c01n,
  0x0000000e3744a22fn, 0x0000000fbb59375dn, 0x000000018a916828n, 0x000000022f29c1ban,
  0x0000000286887d58n, 0x000000041392322en, 0x000000075d18ecd1n, 0x000000087c302743n,
  0x00000008c6317ba9n, 0x00000009e40f36d7n, 0x0000000c0e5a806an, 0x0000000cc78cb87cn,
  0x000000012d2f2d01n, 0x0000000379f36a21n, 0x00000006973f59acn, 0x00000007789ea9f4n,
];

/** Data-bit module coordinates (1-based) inside the 10×10 module grid. */
const BIT_X = [
  1, 2, 3, 4, 5, 2,
  3, 4, 3, 6, 6, 6,
  6, 6, 5, 5, 5, 4,
  6, 5, 4, 3, 2, 5,
  4, 3, 4, 1, 1, 1,
  1, 1, 2, 2, 2, 3,
];
const BIT_Y = [
  1, 1, 1, 1, 1, 2,
  2, 2, 3, 1, 2, 3,
  4, 5, 2, 3, 4, 3,
  6, 6, 6, 6, 6, 5,
  5, 5, 4, 6, 5, 4,
  3, 2, 5, 4, 3, 4,
];

const cache = new Map<number, THREE.CanvasTexture>();

/** 36h11 tag face for `id` (FRC layouts use ids 0..59). */
export function aprilTagTexture(id: number): THREE.CanvasTexture {
  const hit = cache.get(id);
  if (hit) return hit;
  const M = 24; // px per module — 240px tag, crisp at field scale
  const c = document.createElement('canvas');
  c.width = 10 * M;
  c.height = 10 * M;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; // quiet ring (outer 1 module)
  g.fillRect(0, 0, 10 * M, 10 * M);
  g.fillStyle = '#000000'; // 8×8 black field
  g.fillRect(M, M, 8 * M, 8 * M);
  const code = CODES[((id % CODES.length) + CODES.length) % CODES.length]!;
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 36; i++) {
    if ((code >> BigInt(35 - i)) & 1n) {
      g.fillRect((BIT_X[i]! + 1) * M, (BIT_Y[i]! + 1) * M, M, M);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(id, tex);
  return tex;
}
