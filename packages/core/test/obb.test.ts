import { describe, expect, it } from 'vitest';
import { obbOverlap, poseToObb } from '../src';
import type { Pose2d, RobotGeometry } from '../src';

const unit: RobotGeometry = { lengthM: 1, widthM: 1, offsetX: 0, offsetY: 0 };

const pose = (x: number, y: number, heading = 0): Pose2d => ({ x, y, heading });

describe('poseToObb', () => {
  it('applies bumper offset in the robot frame', () => {
    const g: RobotGeometry = { lengthM: 1, widthM: 0.6, offsetX: 0.2, offsetY: 0 };
    const obb = poseToObb(pose(1, 1, Math.PI / 2), g);
    // Offset 0.2 rotated by +90°: (0, 0.2)
    expect(obb.cx).toBeCloseTo(1, 9);
    expect(obb.cy).toBeCloseTo(1.2, 9);
  });
});

describe('obbOverlap (SAT)', () => {
  it('axis-aligned overlap and separation', () => {
    expect(obbOverlap(poseToObb(pose(0, 0), unit), poseToObb(pose(0.9, 0), unit))).toBe(true);
    expect(obbOverlap(poseToObb(pose(0, 0), unit), poseToObb(pose(1.1, 0), unit))).toBe(false);
  });

  it('touching edges count as overlap', () => {
    expect(obbOverlap(poseToObb(pose(0, 0), unit), poseToObb(pose(1, 0), unit))).toBe(true);
  });

  it('45° rotation lets boxes interleave along diagonals', () => {
    // Square rotated 45° has half-extent √2/2 ≈ 0.707 along world x.
    const diag = poseToObb(pose(0, 0, Math.PI / 4), unit);
    const far = poseToObb(pose(1.5, 0), unit);
    const near = poseToObb(pose(1.2, 0), unit);
    expect(obbOverlap(diag, far)).toBe(false);
    expect(obbOverlap(diag, near)).toBe(true);
  });

  it('circles would have false-positived here — SAT must not', () => {
    // Two unit squares side by side, centers 1.05 m apart: axis gap 0.05 m
    // (clear), but bounding circles (r≈0.707 each) would overlap.
    const a = poseToObb(pose(0, 0), unit);
    const b = poseToObb(pose(1.05, 0), unit);
    const circOverlap = 1.05 < 2 * (Math.SQRT1_2 * 1); // ~1.414 diameter
    expect(circOverlap).toBe(true); // circle test would flag…
    expect(obbOverlap(a, b)).toBe(false); // …but exact rects are clear
  });
});
