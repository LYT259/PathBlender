import * as THREE from 'three';
import { resolveSequence, type SessionTrajectory } from '@pathblender/core';
import { groundTrailData, TRAIL_HEIGHT_M } from './ground-trail';
import { worldToRenderVec3 } from './field3d-frame';
import { heatmapColor } from './robot-identity';

export function createGroundTrail(robot: SessionTrajectory, cx: number, cy: number, colorOverride?: string) {
  // Composed robots tape every segment on the global clock, each as its own
  // quad run — groundTrailData never bridges two sample lists, so a wait
  // stays an honest gap instead of a fake connecting line.
  const resolved = resolveSequence(robot);
  const segments = resolved
    ? resolved.map((segment) => ({ samples: segment.trajectory.samples, offsetS: segment.startS }))
    : [{ samples: robot.trajectory.samples, offsetS: 0 }];
  const data = segments.reduce<{ positions: number[]; times: number[] }>(
    (merged, segment) => {
      const part = groundTrailData(segment.samples);
      for (let i = 0; i < part.times.length; i++) part.times[i] = part.times[i]! + segment.offsetS;
      merged.positions.push(...part.positions);
      merged.times.push(...part.times);
      return merged;
    },
    { positions: [], times: [] },
  );
  const positions = new Float32Array(data.times.length * 3);
  for (let i = 0; i < data.times.length; i++) {
    const p = worldToRenderVec3(data.positions[i * 2]!, data.positions[i * 2 + 1]!, TRAIL_HEIGHT_M, cx, cy);
    positions.set([p.x, p.y, p.z], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('trailTime', new THREE.Float32BufferAttribute(data.times, 1));
  const material = new THREE.ShaderMaterial({
    // Full route from the start: nothing is ever past the cutoff (user
      // request 2026-10-04 — the tape no longer grows with the clock).
      uniforms: { cutoff: { value: Infinity }, tapeColor: { value: new THREE.Color(colorOverride ?? robot.color) } },
    vertexShader: `attribute float trailTime; varying float vTime;
      void main() { vTime = trailTime; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float cutoff; uniform vec3 tapeColor; varying float vTime;
      void main() { if (vTime > cutoff) discard; gl_FragColor = vec4(tapeColor, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ground-trail';
  return { mesh, robot };
}

/** Sits just under the trail tape (0.006) so both layers can coexist without
 *  z-fighting — the heatmap is the ground stain, the tape runs on top. */
export const HEATMAP_HEIGHT_M = 0.003;

/**
 * 3D occupancy heatmap (2026-10-06): each robot's footprint rectangle at up
 * to 120 samples along the whole timeline — the same rule the 2D canvas
 * uses — merged into one indexed geometry so a robot costs a single draw
 * call. Quads render in sample order with depthWrite off, so overlapping
 * footprints blend darker exactly like the 2D accumulation. Alliance tint
 * comes from heatmapColor; the theme tokens are injected by the caller so
 * the mesh color can be refreshed when the theme flips.
 */
export function createGroundHeatmap(
  robot: SessionTrajectory,
  cx: number,
  cy: number,
  accent: string,
  danger: string,
) {
  const resolved = resolveSequence(robot);
  const segments = resolved
    ? resolved.map((segment) => segment.trajectory.samples)
    : [robot.trajectory.samples];
  const L = robot.trajectory.geometry.lengthM;
  const W = robot.trajectory.geometry.widthM;
  const positions: number[] = [];
  const indices: number[] = [];
  const corners: Array<[number, number]> = [[L / 2, W / 2], [L / 2, -W / 2], [-L / 2, -W / 2], [-L / 2, W / 2]];
  let quad = 0;
  for (const samples of segments) {
    const stride = Math.max(1, Math.ceil(samples.length / 120));
    for (let i = 0; i < samples.length; i += stride) {
      const p = samples[i]!;
      const cos = Math.cos(p.heading);
      const sin = Math.sin(p.heading);
      for (const [fo, so] of corners) {
        const v = worldToRenderVec3(p.x + fo * cos - so * sin, p.y + fo * sin + so * cos, HEATMAP_HEIGHT_M, cx, cy);
        positions.push(v.x, v.y, v.z);
      }
      const base = quad * 4;
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      quad++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color: heatmapColor(robot.trajectory.alliance, accent, danger),
    transparent: true,
    opacity: 0.06,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ground-heatmap';
  return { mesh, robot };
}
