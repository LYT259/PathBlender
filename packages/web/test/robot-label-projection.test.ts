import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { projectLabelAnchor, projectedRadiusPx } from '../src/robot-label-projection';

describe('3D label screen projection', () => {
  const camera = new PerspectiveCamera(90, 2, 1, 100);
  camera.updateMatrixWorld();
  const viewport = { w: 800, h: 400 };

  it('projects the center and a known 90-degree-frustum point into CSS pixels', () => {
    expect(projectLabelAnchor(new Vector3(0, 0, -10), camera, viewport)).toEqual({ x: 400, y: 200, visible: true });
    const right = projectLabelAnchor(new Vector3(10, 5, -10), camera, viewport);
    expect(right.x).toBeCloseTo(600);
    expect(right.y).toBeCloseTo(100);
    expect(right.visible).toBe(true);
  });

  it('hides anchors behind the camera, outside the viewport, and beyond the clip planes', () => {
    for (const world of [new Vector3(0, 0, 10), new Vector3(21, 0, -10), new Vector3(0, 0, -101), new Vector3(0, 0, -0.5)]) {
      expect(projectLabelAnchor(world, camera, viewport).visible).toBe(false);
    }
  });

  it('uses viewport pixels independently of camera distance and preserves the input vector', () => {
    const world = new Vector3(0, 0, -10);
    expect(projectLabelAnchor(world, camera, { w: 1600, h: 800 })).toEqual({ x: 800, y: 400, visible: true });
    expect(projectLabelAnchor(new Vector3(0, 0, -50), camera, viewport)).toEqual({ x: 400, y: 200, visible: true });
    expect(world.toArray()).toEqual([0, 0, -10]);
  });

  it('turns a body radius into an on-screen keep-clear radius that shrinks with distance', () => {
    // 90° fov, 400px tall: the half-viewport spans tan(45°)·distance metres.
    expect(projectedRadiusPx(new Vector3(0, 0, -10), 1, camera, viewport)).toBeCloseTo(20);
    expect(projectedRadiusPx(new Vector3(0, 0, -20), 1, camera, viewport)).toBeCloseTo(10);
    expect(projectedRadiusPx(new Vector3(0, 0, -10), 1, camera, { w: 1600, h: 800 })).toBeCloseTo(40);
    expect(projectedRadiusPx(new Vector3(0, 0, -10), 0, camera, viewport)).toBe(0);
    expect(projectedRadiusPx(new Vector3(0, 0, 0), 1, camera, viewport)).toBe(0);
  });
});
