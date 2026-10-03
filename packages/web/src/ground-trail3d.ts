import * as THREE from 'three';
import type { SessionTrajectory } from '@pathblender/core';
import { groundTrailData, TRAIL_HEIGHT_M } from './ground-trail';
import { worldToRenderVec3 } from './field3d-frame';

export function createGroundTrail(robot: SessionTrajectory, cx: number, cy: number) {
  const data = groundTrailData(robot.trajectory.samples);
  const positions = new Float32Array(data.times.length * 3);
  for (let i = 0; i < data.times.length; i++) {
    const p = worldToRenderVec3(data.positions[i * 2]!, data.positions[i * 2 + 1]!, TRAIL_HEIGHT_M, cx, cy);
    positions.set([p.x, p.y, p.z], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('trailTime', new THREE.Float32BufferAttribute(data.times, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { cutoff: { value: -1 }, tapeColor: { value: new THREE.Color(robot.color) } },
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
