import * as THREE from 'three';

// One small, deterministic weave tile shared by every bumper. No animation,
// extra meshes or per-frame canvas work; mipmaps soften the thread at distance.
let weave: THREE.DataTexture | undefined;
export function bumperWeave(): THREE.DataTexture {
  if (weave) return weave;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const warp = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      const across = (warp ? x : y) % 8;
      const along = (warp ? y : x) % 8;
      const ridge = Math.sin(Math.PI * (across + 0.5) / 8);
      const fiber = along % 2 === 0 ? 7 : -7;
      const value = Math.round(200 + 45 * ridge + fiber);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  weave = new THREE.DataTexture(data, size, size);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.magFilter = THREE.LinearFilter;
  weave.minFilter = THREE.LinearMipmapLinearFilter;
  weave.generateMipmaps = true;
  weave.needsUpdate = true;
  return weave;
}

export function bumperMaterial(color: THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.96, metalness: 0,
    map: bumperWeave(), bumpMap: bumperWeave(), bumpScale: 0.0006,
  });
}

/** Keep thread density consistent on each face, without changing geometry. */
export function applyBumperWeaveUV(geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let index = 0; index < uv.count; index++) {
    const nx = Math.abs(normal.getX(index));
    const ny = Math.abs(normal.getY(index));
    const nz = Math.abs(normal.getZ(index));
    const u = nx > ny && nx > nz ? position.getZ(index) : position.getX(index);
    const v = ny > nx && ny > nz ? position.getZ(index) : position.getY(index);
    uv.setXY(index, u / 0.012, v / 0.012);
  }
}
