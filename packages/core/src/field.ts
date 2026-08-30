/**
 * Field packages and red/blue alliance normalization.
 *
 * Red→blue transform follows WPILib official semantics: a 180° rotation
 * about the field center (an involution). Files import as blue-frame by
 * default; marking a file as red-alliance flips it once. Everything
 * downstream of the import layer is blue-frame only
 * (single-normalization-path invariant).
 */

import type { Alliance, Pose2d, Trajectory } from './types';
import { wrapAngle } from './math';
import type { AprilTag } from './april-tags';

export interface FieldImageCalibration {
  /** Image pixel size. */
  pixelWidth: number;
  pixelHeight: number;
  /** Pixels per meter. */
  ppm: number;
  /** Margin from image edge to field boundary, meters (uniform). */
  marginM: number;
  /**
   * Corner-point calibration override (AdvantageScope-style assets): the
   * pixel position of the blue-origin field corner. When present this wins
   * over the uniform-margin assumption; ppmY separately scales the y axis
   * (defaults to ppm).
   */
  originPx?: { x: number; y: number };
  ppmY?: number;
}

/**
 * World-space rectangle covered by a field image (meters, blue frame):
 * left/right along x, bottom/top along y. Derived from whichever
 * calibration style the package carries.
 */
export function fieldImageWorldRect(
  img: FieldImageCalibration,
  lengthM: number,
  widthM: number,
): { left: number; right: number; bottom: number; top: number } {
  const ppmY = img.ppmY ?? img.ppm;
  if (img.originPx) {
    // The image's left/bottom edges sit originPx.* pixels OUTSIDE the field
    // corner, i.e. to the left/below world (0, 0).
    const left = -img.originPx.x / img.ppm;
    const bottom = -img.originPx.y / ppmY;
    return {
      left,
      right: left + img.pixelWidth / img.ppm,
      bottom,
      top: bottom + img.pixelHeight / ppmY,
    };
  }
  return {
    left: -img.marginM,
    right: lengthM + img.marginM,
    bottom: -img.marginM,
    top: widthM + img.marginM,
  };
}

export interface FieldPackage {
  id: string;
  name: string;
  year: number;
  /** Playfield size excluding margins (the coordinate space of paths). */
  lengthM: number;
  widthM: number;
  /** Calibration for the bundled field image, when present. */
  image?: FieldImageCalibration;
  /** AprilTag layout overlay (WPILib/PhotonVision JSON), when provided. */
  aprilTags?: AprilTag[];
}

/**
 * 2026 REBUILT presented by Haas.
 * Calibration from PathPlanner (MIT) lib/widgets/field_image.dart:
 * field26.png, 3508×1814 px @ 200 px/m, 0.5 m margin on all sides.
 * Playfield = 3508/200 − 1.0 = 16.54 m × 1814/200 − 1.0 = 8.07 m.
 */
export const REBUILT_2026: FieldPackage = {
  id: 'rebuilt-2026',
  name: 'REBUILT',
  year: 2026,
  lengthM: 16.54,
  widthM: 8.07,
  image: { pixelWidth: 3508, pixelHeight: 1814, ppm: 200, marginM: 0.5 },
  // Official 2026 welded-field AprilTag layout (WPILib blue-origin frame),
  // from allwpilib's apriltag resources (BSD-3-Clause); field facts, used
  // for the 2D overlay and the 3D beacons.
  aprilTags: [
    { id: 1, x: 11.878, y: 7.4248, z: 0.889, rotRad: 3.1416 },
    { id: 2, x: 11.9154, y: 4.638, z: 1.124, rotRad: 1.5708 },
    { id: 3, x: 11.3119, y: 4.3902, z: 1.124, rotRad: 3.1416 },
    { id: 4, x: 11.3119, y: 4.0346, z: 1.124, rotRad: 3.1416 },
    { id: 5, x: 11.9154, y: 3.4312, z: 1.124, rotRad: -1.5708 },
    { id: 6, x: 11.878, y: 0.6445, z: 0.889, rotRad: 3.1416 },
    { id: 7, x: 11.9529, y: 0.6445, z: 0.889, rotRad: 0.0 },
    { id: 8, x: 12.271, y: 3.4312, z: 1.124, rotRad: -1.5708 },
    { id: 9, x: 12.5192, y: 3.679, z: 1.124, rotRad: 0.0 },
    { id: 10, x: 12.5192, y: 4.0346, z: 1.124, rotRad: 0.0 },
    { id: 11, x: 12.271, y: 4.638, z: 1.124, rotRad: 1.5708 },
    { id: 12, x: 11.9529, y: 7.4248, z: 0.889, rotRad: 0.0 },
    { id: 13, x: 16.5333, y: 7.4033, z: 0.5524, rotRad: 3.1416 },
    { id: 14, x: 16.5333, y: 6.9715, z: 0.5524, rotRad: 3.1416 },
    { id: 15, x: 16.533, y: 4.3236, z: 0.5524, rotRad: 3.1416 },
    { id: 16, x: 16.533, y: 3.8918, z: 0.5524, rotRad: 3.1416 },
    { id: 17, x: 4.6631, y: 0.6445, z: 0.889, rotRad: 0.0 },
    { id: 18, x: 4.6256, y: 3.4312, z: 1.124, rotRad: -1.5708 },
    { id: 19, x: 5.2292, y: 3.679, z: 1.124, rotRad: 0.0 },
    { id: 20, x: 5.2292, y: 4.0346, z: 1.124, rotRad: 0.0 },
    { id: 21, x: 4.6256, y: 4.638, z: 1.124, rotRad: 1.5708 },
    { id: 22, x: 4.6631, y: 7.4248, z: 0.889, rotRad: 0.0 },
    { id: 23, x: 4.5882, y: 7.4248, z: 0.889, rotRad: 3.1416 },
    { id: 24, x: 4.27, y: 4.638, z: 1.124, rotRad: 1.5708 },
    { id: 25, x: 4.0219, y: 4.3902, z: 1.124, rotRad: 3.1416 },
    { id: 26, x: 4.0219, y: 4.0346, z: 1.124, rotRad: 3.1416 },
    { id: 27, x: 4.27, y: 3.4312, z: 1.124, rotRad: -1.5708 },
    { id: 28, x: 4.5882, y: 0.6445, z: 0.889, rotRad: 3.1416 },
    { id: 29, x: 0.0077, y: 0.666, z: 0.5524, rotRad: 0.0 },
    { id: 30, x: 0.0077, y: 1.0978, z: 0.5524, rotRad: 0.0 },
    { id: 31, x: 0.0081, y: 3.7457, z: 0.5524, rotRad: 0.0 },
    { id: 32, x: 0.0081, y: 4.1775, z: 0.5524, rotRad: 0.0 }
  ],
};

/**
 * Earlier seasons, calibrations from the same PathPlanner source.
 * Playfield sizes for 2022–2025 are derived from the image calibration
 * (ppm, zero margin) — within a few cm of the official dimensions; the
 * only consumer is the red↔blue flip, which is insensitive to that.
 */
export const FIELDS: readonly FieldPackage[] = [
  {
    id: 'powerup-2018',
    name: 'POWER UP',
    year: 2018,
    lengthM: (648 * 0.0254),
    widthM: (324 * 0.0254),
    image: {
      pixelWidth: 3840, pixelHeight: 1559,
      ppm: (3320 - 519) / (648 * 0.0254),
      ppmY: (1480 - 78) / (324 * 0.0254),
      originPx: { x: 519, y: 78 },
      marginM: 0,
    },
  },
  {
    id: 'deepspace-2019',
    name: 'DEEP SPACE',
    year: 2019,
    lengthM: (648 * 0.0254),
    widthM: (324 * 0.0254),
    image: {
      pixelWidth: 3701, pixelHeight: 1500,
      ppm: (3204 - 496) / (648 * 0.0254),
      ppmY: (1421 - 78) / (324 * 0.0254),
      originPx: { x: 496, y: 78 },
      marginM: 0,
    },
  },
  {
    id: 'infinitercharge-2020',
    name: 'INFINITE RECHARGE',
    year: 2020,
    lengthM: (629.25 * 0.0254),
    widthM: (323.25 * 0.0254),
    image: {
      pixelWidth: 3548, pixelHeight: 1438,
      ppm: (3028 - 519) / (629.25 * 0.0254),
      ppmY: (1363 - 73) / (323.25 * 0.0254),
      originPx: { x: 519, y: 73 },
      marginM: 0,
    },
  },
  {
    id: 'rapidreact-2022',
    name: 'Rapid React',
    year: 2022,
    lengthM: 3240 / 196.85,
    widthM: 1620 / 196.85,
    image: { pixelWidth: 3240, pixelHeight: 1620, ppm: 196.85, marginM: 0 },
  },
  {
    id: 'chargedup-2023',
    name: 'Charged Up',
    year: 2023,
    lengthM: 3256 / 196.85,
    widthM: 1578 / 196.85,
    image: { pixelWidth: 3256, pixelHeight: 1578, ppm: 196.85, marginM: 0 },
  },
  {
    id: 'crescendo-2024',
    name: 'Crescendo',
    year: 2024,
    lengthM: 3256 / 196.85,
    widthM: 1616 / 196.85,
    image: { pixelWidth: 3256, pixelHeight: 1616, ppm: 196.85, marginM: 0 },
  },
  {
    id: 'reefscape-2025',
    name: 'Reefscape',
    year: 2025,
    // Official WPILib field constants (image includes blank canvas edge).
    lengthM: 16.5417,
    widthM: 8.0137,
    image: { pixelWidth: 3510, pixelHeight: 1610, ppm: 200, marginM: 0 },
  },
  REBUILT_2026,
];

export function fieldById(id: string): FieldPackage {
  return FIELDS.find((f) => f.id === id) ?? REBUILT_2026;
}

export const CUSTOM_FIELD_ID = 'custom';

/**
 * Build a user-imported field package (GHPaths ADR-0008 FieldMap concept:
 * image + calibration + playfield size). Callers own the image lifetime
 * (object URL); sessions persist the calibration but not the image bytes,
 * so restoring without the image falls back to an outline rendering.
 */
export function makeCustomField(cal: {
  name?: string;
  lengthM: number;
  widthM: number;
  ppm: number;
  marginM: number;
  pixelWidth: number;
  pixelHeight: number;
  aprilTags?: AprilTag[];
}): FieldPackage {
  return {
    id: CUSTOM_FIELD_ID,
    name: cal.name ?? 'Custom',
    year: 0,
    lengthM: cal.lengthM,
    widthM: cal.widthM,
    image: {
      pixelWidth: cal.pixelWidth,
      pixelHeight: cal.pixelHeight,
      ppm: cal.ppm,
      marginM: cal.marginM,
    },
    aprilTags: cal.aprilTags,
  };
}

/** Flip a pose from the red frame into the blue frame (180° about center). */
export function flipPoseToBlue(pose: Pose2d, field: FieldPackage): Pose2d {
  return {
    x: field.lengthM - pose.x,
    y: field.widthM - pose.y,
    heading: wrapAngle(pose.heading + Math.PI),
  };
}

/**
 * Change the alliance a trajectory is attributed to. Samples are stored
 * blue-frame; moving blue→red or red→blue flips them exactly once
 * (involution), so a red-viewed file lands on its true field position and
 * toggling back is lossless.
 */
export function applyAllianceChange(
  traj: Trajectory,
  alliance: Alliance,
  field: FieldPackage,
): Trajectory {
  if (traj.alliance === alliance) return traj;
  const samples = traj.samples.map((s) => {
    const p = flipPoseToBlue({ x: s.x, y: s.y, heading: s.heading }, field);
    return { ...s, x: p.x, y: p.y, heading: p.heading, vx: -s.vx, vy: -s.vy };
  });
  return { ...traj, alliance, samples };
}
