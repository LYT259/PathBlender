import * as THREE from 'three';
import { resolveSequence, type SessionTrajectory } from '@pathblender/core';
import { groundTrailData, TRAIL_HEIGHT_M } from './ground-trail';
import { worldToRenderVec3 } from './field3d-frame';

export function createGroundTrail(robot: SessionTrajectory, cx: number, cy: number) {
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
      uniforms: { cutoff: { value: Infinity }, tapeColor: { value: new THREE.Color(robot.color) } },
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
