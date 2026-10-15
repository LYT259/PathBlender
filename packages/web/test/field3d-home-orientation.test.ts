/**
 * Reset-view alliance sides (2026-10-16 user report): after the toolbar
 * recenter (or a fresh app open) the 3D home view must show the BLUE
 * alliance end on the left half of the screen and the RED end on the right
 * — the same blue-left standard the 2D artwork has enforced since the
 * 2026-10-14 orientation audit. Before the fix, CAM_HOME sat at +Z, from
 * which the render frame's blue end (+X, see field3d-frame.ts) projected
 * onto the RIGHT for every season; headless screenshots of all six views
 * (five seasons + 2025 AndyMark) confirmed it against the models' own
 * alliance-colour materials.
 *
 * The test re-projects each season's alliance-end midpoints through the
 * real placement pipeline (fieldRenderBounds + worldToRenderVec3) and a
 * camera posed exactly like the scaffold's (CAM_HOME, lookAt origin) — no
 * GPU needed, and any future change to the camera constant, the frame
 * mapping, or a season's calibration breaks it on the season it breaks.
 */
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { FIELDS } from '@pathblender/core';
import { CAM_HOME } from '../src/field3d-models';
import { fieldRenderBounds, worldToRenderVec3 } from '../src/field3d-frame';

function homeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 1, 0.1, 300);
  camera.position.set(...CAM_HOME);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

describe('3D reset view keeps blue on the left for every season', () => {
  it('every shipped season is covered', () => {
    expect(FIELDS.map((f) => f.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  for (const field of FIELDS) {
    it(`${field.year} ${field.name}: blue end left, red end right`, () => {
      const camera = homeCamera();
      const { cx, cy } = fieldRenderBounds(field);
      // Alliance-wall midpoints: WPILib blue sits at x = 0, red at the far
      // wall; y = width/2 keeps both on the screen midline so only the
      // horizontal (left/right) projection is asserted.
      const blue = worldToRenderVec3(0, field.widthM / 2, 0, cx, cy).project(camera) as Vector3;
      const red = worldToRenderVec3(field.lengthM, field.widthM / 2, 0, cx, cy).project(camera) as Vector3;
      expect(blue.x).toBeLessThan(0);
      expect(red.x).toBeGreaterThan(0);
    });
  }
});
