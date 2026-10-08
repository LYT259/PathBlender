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

export type FieldArtStyle = 'schematic' | 'rendered';

export interface FieldPackage {
  id: string;
  name: string;
  year: number;
  /** Autonomous Period length that season's game ran, seconds — the
   *  timeline floor and mediation delay ceilings derive from it. 2026
   *  REBUILT is 20 s; every bundled earlier season (2022–2025) was 15 s. */
  autoPeriodS: number;
  /** Playfield size excluding margins (the coordinate space of paths). */
  lengthM: number;
  widthM: number;
  /** Primary artwork — the flat schematic style (PathPlanner) for the
   *  seasons that have one (2022–2026); the only artwork for 2022
   *  (AdvantageScope renders, no schematic exists upstream). */
  image?: FieldImageCalibration;
  /** Semi-realistic rendered artwork (AdvantageScope/Chief Delphi renders),
   *  when the season has one alongside the schematic. */
  imageRendered?: FieldImageCalibration;
  /** AndyMark-built variant of the rendered artwork, when the season ships
   *  one (the 2025 official construction pair). */
  imageRenderedAndyMark?: FieldImageCalibration;
  /** AprilTag layout overlay (WPILib/PhotonVision JSON), when provided. */
  aprilTags?: AprilTag[];
  /** AndyMark-built-field tag layout, when it differs from the default
   *  (welded) set — the 2D overlay and 3D beacons follow the selection. */
  aprilTagsAndyMark?: AprilTag[];
  /** Depth of each ALLIANCE ZONE from its alliance wall, meters, full field
   *  width — the season's legal auto starting region, when the game defines
   *  one. 2026 REBUILT (composer grays first legs starting elsewhere, user
   *  request 2026-10-08): the game manual (§5 FIELD definitions, p. 21)
   *  sizes the zone 158.6 in deep × 317.7 in long (~4.03 m × 8.07 m = full
   *  field width), bounded by and including the ROBOT STARTING LINE.
   *  Cross-checked against the WPILib tag layout: blue wall tags sit at
   *  x≈0.008, the line lands at x=4.0284 in front of the trench tags
   *  (x≈4.59–4.66), and the red trench mirrors blue exactly
   *  (16.541−11.953 = 4.588). Undefined = the season defines no such zone. */
  allianceStartZoneM?: number;
}

// Official AprilTag layouts per season (WPILib blue-origin frame, meters),
// from allwpilib's apriltag resources (BSD-3-Clause) — field facts.
// `aprilTags` = welded-field layout; `aprilTagsAndyMark` where it differs.

const TAGS_2022: AprilTag[] = [
  { id: 0, x: -0.0035, y: 7.5789, z: 0.8859, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 1, x: 3.2327, y: 5.4867, z: 1.7255, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 2, x: 3.0678, y: 5.3305, z: 1.3762, rotRad: -1.5708, quat: [0, 0, -0.707107, 0.707107] },
  { id: 3, x: 0.004, y: 5.0585, z: 0.8065, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 4, x: 0.004, y: 3.5125, z: 0.8065, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 5, x: 0.1211, y: 1.7178, z: 0.8906, rotRad: 0.8072, quat: [0, 0, 0.392738, 0.91965] },
  { id: 6, x: 0.8733, y: 0.9413, z: 0.8906, rotRad: 0.8072, quat: [0, 0, 0.392738, 0.91965] },
  { id: 7, x: 1.6151, y: 0.1573, z: 0.8906, rotRad: 0.8072, quat: [0, 0, 0.392738, 0.91965] },
  { id: 10, x: 16.4627, y: 0.6507, z: 0.8859, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 11, x: 13.235, y: 2.7435, z: 1.7255, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 12, x: 13.3914, y: 2.8998, z: 1.3762, rotRad: 1.5708, quat: [0, 0, 0.707107, 0.707107] },
  { id: 13, x: 16.4552, y: 3.1755, z: 0.8065, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 14, x: 16.4552, y: 4.7171, z: 0.8065, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 15, x: 16.335, y: 6.515, z: 0.8938, rotRad: -2.3771, quat: [0, 0, 0.927836, -0.372988] },
  { id: 16, x: 15.5905, y: 7.2927, z: 0.8906, rotRad: -2.3771, quat: [0, 0, 0.927836, -0.372988] },
  { id: 17, x: 14.8472, y: 8.0691, z: 0.8906, rotRad: -2.3771, quat: [0, 0, 0.927836, -0.372988] },
  { id: 40, x: 7.8741, y: 4.9132, z: 0.7033, rotRad: 1.9897, quat: [0, 0, 0.838671, 0.544639] },
  { id: 41, x: 7.4312, y: 3.7593, z: 0.7033, rotRad: -2.7227, quat: [0, 0, 0.978148, -0.207912] },
  { id: 42, x: 8.5851, y: 3.3164, z: 0.7033, rotRad: -1.1519, quat: [0, 0, -0.544639, 0.838671] },
  { id: 43, x: 9.028, y: 4.4703, z: 0.7033, rotRad: 0.4189, quat: [0, 0, 0.207912, 0.978148] },
  { id: 50, x: 7.679, y: 4.3262, z: 2.4177, rotRad: 2.7751, quat: [-0.22745, 0.042155, 0.956586, 0.177293] },
  { id: 51, x: 8.0182, y: 3.5642, z: 2.4177, rotRad: -1.9373, quat: [-0.19064, -0.131023, 0.801773, -0.551044] },
  { id: 52, x: 8.7802, y: 3.9034, z: 2.4177, rotRad: -0.3665, quat: [-0.042155, -0.22745, 0.177293, -0.956586] },
  { id: 53, x: 8.441, y: 4.6654, z: 2.4177, rotRad: 1.2043, quat: [-0.131023, 0.19064, 0.551044, 0.801773] },
];

const TAGS_2023: AprilTag[] = [
  { id: 1, x: 15.5136, y: 1.0716, z: 0.4628, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 2, x: 15.5136, y: 2.748, z: 0.4628, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 3, x: 15.5136, y: 4.4244, z: 0.4628, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 4, x: 16.1788, y: 6.7498, z: 0.6955, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 5, x: 0.3619, y: 6.7498, z: 0.6955, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 6, x: 1.0274, y: 4.4244, z: 0.4628, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 7, x: 1.0274, y: 2.748, z: 0.4628, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 8, x: 1.0274, y: 1.0716, z: 0.4628, rotRad: 0, quat: [0, 0, 0, 1] },
];

const TAGS_2024: AprilTag[] = [
  { id: 1, x: 15.0795, y: 0.2459, z: 1.3559, rotRad: 2.0944, quat: [0, 0, 0.866025, 0.5] },
  { id: 2, x: 16.1851, y: 0.8837, z: 1.3559, rotRad: 2.0944, quat: [0, 0, 0.866025, 0.5] },
  { id: 3, x: 16.5793, y: 4.9827, z: 1.4511, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 4, x: 16.5793, y: 5.5479, z: 1.4511, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 5, x: 14.7008, y: 8.2042, z: 1.3559, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 6, x: 1.8415, y: 8.2042, z: 1.3559, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 7, x: -0.0381, y: 5.5479, z: 1.4511, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 8, x: -0.0381, y: 4.9827, z: 1.4511, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 9, x: 0.3561, y: 0.8837, z: 1.3559, rotRad: 1.0472, quat: [0, 0, 0.5, 0.866025] },
  { id: 10, x: 1.4615, y: 0.2459, z: 1.3559, rotRad: 1.0472, quat: [0, 0, 0.5, 0.866025] },
  { id: 11, x: 11.9047, y: 3.7132, z: 1.3208, rotRad: -1.0472, quat: [0, 0, 0.5, -0.866025] },
  { id: 12, x: 11.9047, y: 4.4983, z: 1.3208, rotRad: 1.0472, quat: [0, 0, 0.5, 0.866025] },
  { id: 13, x: 11.2202, y: 4.1051, z: 1.3208, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 14, x: 5.3208, y: 4.1051, z: 1.3208, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 15, x: 4.6413, y: 4.4983, z: 1.3208, rotRad: 2.0944, quat: [0, 0, 0.866025, 0.5] },
  { id: 16, x: 4.6413, y: 3.7132, z: 1.3208, rotRad: -2.0944, quat: [0, 0, 0.866025, -0.5] },
];

const TAGS_2025_WELDED: AprilTag[] = [
  { id: 1, x: 16.6972, y: 0.6553, z: 1.4859, rotRad: 2.1991, quat: [0, 0, 0.891007, 0.45399] },
  { id: 2, x: 16.6972, y: 7.3965, z: 1.4859, rotRad: -2.1991, quat: [0, 0, 0.891007, -0.45399] },
  { id: 3, x: 11.5608, y: 8.0556, z: 1.3017, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 4, x: 9.2761, y: 6.1377, z: 1.8679, rotRad: 0, quat: [0, 0.258819, 0, 0.965926] },
  { id: 5, x: 9.2761, y: 1.9149, z: 1.8679, rotRad: 0, quat: [0, 0.258819, 0, 0.965926] },
  { id: 6, x: 13.4744, y: 3.3063, z: 0.3081, rotRad: -1.0472, quat: [0, 0, 0.5, -0.866025] },
  { id: 7, x: 13.8905, y: 4.0259, z: 0.3081, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 8, x: 13.4744, y: 4.7455, z: 0.3081, rotRad: 1.0472, quat: [0, 0, 0.5, 0.866025] },
  { id: 9, x: 12.6434, y: 4.7455, z: 0.3081, rotRad: 2.0944, quat: [0, 0, 0.866025, 0.5] },
  { id: 10, x: 12.2273, y: 4.0259, z: 0.3081, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 11, x: 12.6434, y: 3.3063, z: 0.3081, rotRad: -2.0944, quat: [0, 0, 0.866025, -0.5] },
  { id: 12, x: 0.8512, y: 0.6553, z: 1.4859, rotRad: 0.9425, quat: [0, 0, 0.45399, 0.891007] },
  { id: 13, x: 0.8512, y: 7.3965, z: 1.4859, rotRad: -0.9425, quat: [0, 0, 0.45399, -0.891007] },
  { id: 14, x: 8.2723, y: 6.1377, z: 1.8679, rotRad: 3.1416, quat: [-0.258819, 0, 0.965926, 0] },
  { id: 15, x: 8.2723, y: 1.9149, z: 1.8679, rotRad: 3.1416, quat: [-0.258819, 0, 0.965926, 0] },
  { id: 16, x: 5.9875, y: -0.0038, z: 1.3017, rotRad: 1.5708, quat: [0, 0, 0.707107, 0.707107] },
  { id: 17, x: 4.0739, y: 3.3063, z: 0.3081, rotRad: -2.0944, quat: [0, 0, 0.866025, -0.5] },
  { id: 18, x: 3.6576, y: 4.0259, z: 0.3081, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 19, x: 4.0739, y: 4.7455, z: 0.3081, rotRad: 2.0944, quat: [0, 0, 0.866025, 0.5] },
  { id: 20, x: 4.9047, y: 4.7455, z: 0.3081, rotRad: 1.0472, quat: [0, 0, 0.5, 0.866025] },
  { id: 21, x: 5.321, y: 4.0259, z: 0.3081, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 22, x: 4.9047, y: 3.3063, z: 0.3081, rotRad: -1.0472, quat: [0, 0, 0.5, -0.866025] },
];

const TAGS_2025_ANDYMARK: AprilTag[] = [
  { id: 1, x: 16.6873, y: 0.6281, z: 1.4859, rotRad: 2.1991, quat: [0, 0, 0.891007, 0.45399] },
  { id: 2, x: 16.6873, y: 7.4143, z: 1.4859, rotRad: -2.1991, quat: [0, 0, 0.891007, -0.45399] },
  { id: 3, x: 11.491, y: 8.0317, z: 1.3017, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 4, x: 9.2761, y: 6.1326, z: 1.8679, rotRad: 0, quat: [0, 0.258819, 0, 0.965926] },
  { id: 5, x: 9.2761, y: 1.9098, z: 1.8679, rotRad: 0, quat: [0, 0.258819, 0, 0.965926] },
  { id: 6, x: 13.4744, y: 3.3012, z: 0.3081, rotRad: -1.0472, quat: [0, 0, 0.5, -0.866025] },
  { id: 7, x: 13.8905, y: 4.0208, z: 0.3081, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 8, x: 13.4744, y: 4.7404, z: 0.3081, rotRad: 1.0472, quat: [0, 0, 0.5, 0.866025] },
  { id: 9, x: 12.6434, y: 4.7404, z: 0.3081, rotRad: 2.0944, quat: [0, 0, 0.866025, 0.5] },
  { id: 10, x: 12.2273, y: 4.0208, z: 0.3081, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 11, x: 12.6434, y: 3.3012, z: 0.3081, rotRad: -2.0944, quat: [0, 0, 0.866025, -0.5] },
  { id: 12, x: 0.8613, y: 0.6281, z: 1.4859, rotRad: 0.9425, quat: [0, 0, 0.45399, 0.891007] },
  { id: 13, x: 0.8613, y: 7.4143, z: 1.4859, rotRad: -0.9425, quat: [0, 0, 0.45399, -0.891007] },
  { id: 14, x: 8.2723, y: 6.1326, z: 1.8679, rotRad: 3.1416, quat: [-0.258819, 0, 0.965926, 0] },
  { id: 15, x: 8.2723, y: 1.9098, z: 1.8679, rotRad: 3.1416, quat: [-0.258819, 0, 0.965926, 0] },
  { id: 16, x: 6.0576, y: 0.0107, z: 1.3017, rotRad: 1.5708, quat: [0, 0, 0.707107, 0.707107] },
  { id: 17, x: 4.0739, y: 3.3012, z: 0.3081, rotRad: -2.0944, quat: [0, 0, 0.866025, -0.5] },
  { id: 18, x: 3.6576, y: 4.0208, z: 0.3081, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 19, x: 4.0739, y: 4.7404, z: 0.3081, rotRad: 2.0944, quat: [0, 0, 0.866025, 0.5] },
  { id: 20, x: 4.9047, y: 4.7404, z: 0.3081, rotRad: 1.0472, quat: [0, 0, 0.5, 0.866025] },
  { id: 21, x: 5.321, y: 4.0208, z: 0.3081, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 22, x: 4.9047, y: 3.3012, z: 0.3081, rotRad: -1.0472, quat: [0, 0, 0.5, -0.866025] },
];

const TAGS_2026_ANDYMARK: AprilTag[] = [
  { id: 1, x: 11.864, y: 7.4115, z: 0.889, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 2, x: 11.9014, y: 4.6248, z: 1.124, rotRad: 1.5708, quat: [0, 0, 0.707107, 0.707107] },
  { id: 3, x: 11.2978, y: 4.377, z: 1.124, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 4, x: 11.2978, y: 4.0214, z: 1.124, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 5, x: 11.9014, y: 3.418, z: 1.124, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 6, x: 11.864, y: 0.6312, z: 0.889, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 7, x: 11.9389, y: 0.6312, z: 0.889, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 8, x: 12.257, y: 3.418, z: 1.124, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 9, x: 12.5052, y: 3.6658, z: 1.124, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 10, x: 12.5052, y: 4.0214, z: 1.124, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 11, x: 12.257, y: 4.6248, z: 1.124, rotRad: 1.5708, quat: [0, 0, 0.707107, 0.707107] },
  { id: 12, x: 11.9389, y: 7.4115, z: 0.889, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 13, x: 16.4993, y: 7.3919, z: 0.5524, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 14, x: 16.4993, y: 6.9601, z: 0.5524, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 15, x: 16.499, y: 4.3125, z: 0.5524, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 16, x: 16.499, y: 3.8807, z: 0.5524, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 17, x: 4.6491, y: 0.6312, z: 0.889, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 18, x: 4.6116, y: 3.418, z: 1.124, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 19, x: 5.2152, y: 3.6658, z: 1.124, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 20, x: 5.2152, y: 4.0214, z: 1.124, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 21, x: 4.6116, y: 4.6248, z: 1.124, rotRad: 1.5708, quat: [0, 0, 0.707107, 0.707107] },
  { id: 22, x: 4.6491, y: 7.4115, z: 0.889, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 23, x: 4.5742, y: 7.4115, z: 0.889, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 24, x: 4.256, y: 4.6248, z: 1.124, rotRad: 1.5708, quat: [0, 0, 0.707107, 0.707107] },
  { id: 25, x: 4.0079, y: 4.377, z: 1.124, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 26, x: 4.0079, y: 4.0214, z: 1.124, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 27, x: 4.256, y: 3.418, z: 1.124, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 28, x: 4.5742, y: 0.6312, z: 0.889, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 29, x: 0.0137, y: 0.6508, z: 0.5524, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 30, x: 0.0137, y: 1.0826, z: 0.5524, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 31, x: 0.014, y: 3.7302, z: 0.5524, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 32, x: 0.014, y: 4.162, z: 0.5524, rotRad: 0, quat: [0, 0, 0, 1] },
];


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
    autoPeriodS: 20,
  lengthM: 16.54,
  widthM: 8.07,
  allianceStartZoneM: 4.0284,
  image: { pixelWidth: 3508, pixelHeight: 1814, ppm: 200, marginM: 0.5 },
  // Official 2026 welded-field AprilTag layout (WPILib blue-origin frame),
  // from allwpilib's apriltag resources (BSD-3-Clause); field facts, used
  // for the 2D overlay and the 3D beacons.
  aprilTags: [
  { id: 1, x: 11.878, y: 7.4248, z: 0.889, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 2, x: 11.9154, y: 4.638, z: 1.124, rotRad: 1.5708, quat: [0, 0, 0.707107, 0.707107] },
  { id: 3, x: 11.3119, y: 4.3902, z: 1.124, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 4, x: 11.3119, y: 4.0346, z: 1.124, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 5, x: 11.9154, y: 3.4312, z: 1.124, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 6, x: 11.878, y: 0.6445, z: 0.889, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 7, x: 11.9529, y: 0.6445, z: 0.889, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 8, x: 12.271, y: 3.4312, z: 1.124, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 9, x: 12.5192, y: 3.679, z: 1.124, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 10, x: 12.5192, y: 4.0346, z: 1.124, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 11, x: 12.271, y: 4.638, z: 1.124, rotRad: 1.5708, quat: [0, 0, 0.707107, 0.707107] },
  { id: 12, x: 11.9529, y: 7.4248, z: 0.889, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 13, x: 16.5333, y: 7.4033, z: 0.5524, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 14, x: 16.5333, y: 6.9715, z: 0.5524, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 15, x: 16.533, y: 4.3236, z: 0.5524, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 16, x: 16.533, y: 3.8918, z: 0.5524, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 17, x: 4.6631, y: 0.6445, z: 0.889, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 18, x: 4.6256, y: 3.4312, z: 1.124, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 19, x: 5.2292, y: 3.679, z: 1.124, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 20, x: 5.2292, y: 4.0346, z: 1.124, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 21, x: 4.6256, y: 4.638, z: 1.124, rotRad: 1.5708, quat: [0, 0, 0.707107, 0.707107] },
  { id: 22, x: 4.6631, y: 7.4248, z: 0.889, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 23, x: 4.5882, y: 7.4248, z: 0.889, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 24, x: 4.27, y: 4.638, z: 1.124, rotRad: 1.5708, quat: [0, 0, 0.707107, 0.707107] },
  { id: 25, x: 4.0219, y: 4.3902, z: 1.124, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 26, x: 4.0219, y: 4.0346, z: 1.124, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 27, x: 4.27, y: 3.4312, z: 1.124, rotRad: -1.5708, quat: [0, 0, 0.707107, -0.707107] },
  { id: 28, x: 4.5882, y: 0.6445, z: 0.889, rotRad: 3.1416, quat: [0, 0, 1, 0] },
  { id: 29, x: 0.0077, y: 0.666, z: 0.5524, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 30, x: 0.0077, y: 1.0978, z: 0.5524, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 31, x: 0.0081, y: 3.7457, z: 0.5524, rotRad: 0, quat: [0, 0, 0, 1] },
  { id: 32, x: 0.0081, y: 4.1775, z: 0.5524, rotRad: 0, quat: [0, 0, 0, 1] },
  ],
  // Rendered artwork (AdvantageScopeAssets Field2d_2026FRCFieldV2, BSD-3;
  // source render: Chief Delphi high-resolution field image), 3902×1584.
  // Corner calibration from its config (topLeft [524,95], bottomRight
  // [3378,1489] over 651.22″×317.677″) mapped onto this package's 16.54×8.07
  // constants → 2854 px of length at 172.55 px/m, blue corner 524 px from
  // the left edge, 95 px from the bottom edge. Tag-decal probe vs the
  // AndyMark layout: median 15 px (≈ 9 cm), no systematic bias; the
  // welded/AndyMark deltas (≤ 34 mm ≈ 6 px) are below the artwork's own
  // scatter, so one sheet serves both variants.
  imageRendered: { pixelWidth: 3902, pixelHeight: 1584, ppm: 172.55, ppmY: 172.74, marginM: 0, originPx: { x: 524, y: 95 } },
  aprilTagsAndyMark: TAGS_2026_ANDYMARK,
};

/**
 * Earlier seasons, calibrations from the same PathPlanner source.
 * Playfield sizes for 2022–2025 are derived from the image calibration
 * (ppm, zero margin) — within a few cm of the official dimensions; the
 * only consumer is the red↔blue flip, which is insensitive to that.
 */
export const FIELDS: readonly FieldPackage[] = [
  {
    id: 'rapidreact-2022',
    name: 'Rapid React',
    year: 2022,
    autoPeriodS: 15,
    lengthM: 3240 / 196.85,
    widthM: 1620 / 196.85,
    image: { pixelWidth: 3240, pixelHeight: 1620, ppm: 196.85, marginM: 0 },
    // Rendered artwork (AdvantageScopeAssets Field2d_2022FRCFieldV3, BSD-3;
    // source render: Chief Delphi 2022 top-down field renders), 7045×2934.
    // Corner calibration from its config (topLeft [884,148], bottomRight
    // [6160,2786] over 648″×324″ — exactly this package's constants). The
    // render draws the WPILib 2022 offseason tag set: decal probe vs
    // TAGS_2022 gives median 7.7 px (≈ 2.4 cm), no systematic bias; the
    // four hangar-ring decals scatter ±33 px (≈ 10 cm, drawn loose).
    imageRendered: { pixelWidth: 7045, pixelHeight: 2934, ppm: 320.55, ppmY: 320.55, marginM: 0, originPx: { x: 884, y: 148 } },
    aprilTags: TAGS_2022,
  },
  {
    id: 'chargedup-2023',
    name: 'Charged Up',
    year: 2023,
    autoPeriodS: 15,
    lengthM: 3256 / 196.85,
    widthM: 1578 / 196.85,
    image: { pixelWidth: 3256, pixelHeight: 1578, ppm: 196.85, marginM: 0 },
    // Rendered artwork (AdvantageScopeAssets Field2d_2023FRCFieldV4, BSD-3;
    // source render: Chief Delphi top-down field renders). Corner calibration
    // from its config (topLeft [482,89], bottomRight [3126,1373] over the
    // 651.25″×315.5″ span) mapped onto this package's constants → 2644 px of
    // field length at 159.85 px/m, blue corner 482 px from the left edge,
    // 89 px from the bottom edge. Tag-decal probe: residuals up to ±35 px in
    // a symmetric bow (mid-wall decals drawn inset on both walls) — artwork
    // looseness, no global bias.
    imageRendered: { pixelWidth: 3608, pixelHeight: 1462, ppm: 159.85, ppmY: 160.16, marginM: 0, originPx: { x: 482, y: 89 } },
    aprilTags: TAGS_2023,
  },
  {
    id: 'crescendo-2024',
    name: 'Crescendo',
    year: 2024,
    autoPeriodS: 15,
    lengthM: 3256 / 196.85,
    widthM: 1616 / 196.85,
    image: { pixelWidth: 3256, pixelHeight: 1616, ppm: 196.85, marginM: 0 },
    // Rendered artwork (AdvantageScopeAssets Field2d_2024FRCFieldV3, BSD-3;
    // source render: Chief Delphi). Corner calibration from its config
    // (topLeft [513,78], bottomRight [3327,1475] over 651.25″×323.25″)
    // mapped onto this package's constants. Tag-decal probe: median 26 px
    // scatter grouped per structure (same-wall decals disagree) — artwork
    // looseness, no consistent global bias.
    imageRendered: { pixelWidth: 3840, pixelHeight: 1554, ppm: 158.96, ppmY: 159.42, marginM: 0, originPx: { x: 513, y: 79 } },
    aprilTags: TAGS_2024,
  },
  {
    id: 'reefscape-2025',
    name: 'Reefscape',
    year: 2025,
    autoPeriodS: 15,
    // Official WPILib field constants, 2025 frame (allwpilib
    // fields/src/main/native/resources/org/wpilib/fields/frc/
    // 2025-reefscape-welded.json, "field-dimensions" 17.548 × 8.052, BSD-3):
    // the 2025 coordinate frame spans the FULL enclosure — the alliance
    // walls are recessed ~0.5 m per end for the new driver stations, so the
    // playfield robots drive on sits inset, and the 180° red→blue flip must
    // rotate about the ENCLOSURE centre (8.774, 4.026), not 16.5417/2.
    // AndyMark width is 8.042 — one constant serves both builds (5 mm per
    // side, below any placement tolerance).
    lengthM: 17.548,
    widthM: 8.052,
    // Schematic (default) artwork: PathPlanner field25.png (MIT), 3510×1610.
    // Calibration is the artist's own (uniform 200 px/m, zero margin — the
    // canvas spans the enclosure; PathPlanner renders on it with exactly
    // this). Verified on the shipped PNG: the enclosure walls are drawn AT
    // the canvas edges, and both coral-station
    // decals clip at the canvas edges exactly where margin-0 predicts them
    // (half-cut at top/bottom). High-mounted decals (DS-wall tags and the
    // reef-slope tops, z ≈ 1.5–1.9 m) carry a uniform ≈ 20 cm inward
    // displacement — pseudo-3D height offset in the artwork, same looseness
    // class as the AS sheets' structure offsets, not a grid shift. Both
    // construction variants share this single artwork — tags-only
    // switching, exactly like 2026.
    image: { pixelWidth: 3510, pixelHeight: 1610, ppm: 200, marginM: 0 },
    // Rendered artwork: the official construction-variant pair
    // (AdvantageScopeAssets Field2d_2025FRCFieldWeldedV3 / AndyMarkV3,
    // BSD-3; 3773×1528 each — the two artworks are pixel-identical except
    // each coral station, drawn 12 px ≈ 7 cm toward centre on the AndyMark
    // sheet, matching the tag deltas). Calibration (one set serves both
    // sheets; AM enclosure 8.042 vs 8.052 is 0.6 % of ppmY, below the
    // artwork's own noise): carpet edges at columns 420/3351 and rows
    // 73/1454 measured on the shipped PNGs map to the 17.548 × 8.052 frame
    // → ppm 167.08, ppmY 171.49, blue corner 420 px from the left edge,
    // 74 px from the bottom edge. Validated against all 22 AprilTag decals
    // in each artwork: median offset (−0.5, +1.2) px — no systematic bias;
    // per-tag scatter rms ≈ 12 px (≈ 7 cm) is the artwork's structure
    // looseness (reef tag ring drawn ~8 cm large in radius, barge posts
    // ±21 px, DS walls ~17 px inset), not calibration error. The AndyMark
    // sheet's coral-station decals sit on the AndyMark tag coordinates
    // to ≤ 1 px.
    imageRendered: { pixelWidth: 3773, pixelHeight: 1528, ppm: 167.08, ppmY: 171.49, marginM: 0, originPx: { x: 420, y: 74 } },
    imageRenderedAndyMark: { pixelWidth: 3773, pixelHeight: 1528, ppm: 167.08, ppmY: 171.49, marginM: 0, originPx: { x: 420, y: 74 } },
    aprilTags: TAGS_2025_WELDED,
    aprilTagsAndyMark: TAGS_2025_ANDYMARK,
  },
  REBUILT_2026,
];

export function fieldById(id: string): FieldPackage {
  return FIELDS.find((f) => f.id === id) ?? REBUILT_2026;
}

/**
 * Resolve a field package for a construction variant and an artwork style.
 * The AndyMark build always swaps in its official tag layout when one
 * exists; the artwork follows the style — 'rendered' takes the
 * AdvantageScope artwork (2025 additionally takes its AndyMark sheet of the
 * official pair), 'schematic' (or a style the season lacks) takes the
 * primary artwork, which for 2022 IS the render. The id, name and
 * playfield size never change.
 */
export function withFieldVariant(
  field: FieldPackage,
  variant: 'welded' | 'andymark',
  style: FieldArtStyle = 'schematic',
): FieldPackage {
  const aprilTags =
    variant === 'andymark' && field.aprilTagsAndyMark ? field.aprilTagsAndyMark : field.aprilTags;
  let image = field.image;
  if (style === 'rendered' && field.imageRendered) {
    image =
      variant === 'andymark' && field.imageRenderedAndyMark
        ? field.imageRenderedAndyMark
        : field.imageRendered;
  }
  if (aprilTags === field.aprilTags && image === field.image) return field;
  return { ...field, aprilTags, image };
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
  autoPeriodS?: number;
}): FieldPackage {
  return {
    id: CUSTOM_FIELD_ID,
    name: cal.name ?? 'Custom',
    year: 0,
    // Custom images are usually a variant of a recent season's field; 15 s
    // was the Autonomous Period every season through 2025 (2026 REBUILT is
    // the first 20 s game).
    autoPeriodS: cal.autoPeriodS ?? 15,
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
 * Whether a trajectory's first sample starts inside the robot's own
 * ALLIANCE ZONE — the season's legal auto starting region
 * (FieldPackage.allianceStartZoneM). The trajectory is the blue-frame
 * SOURCE sample (sourceRobots stay blue; `robotsForAlliance` derives the
 * red view), and the red view's zone is the mirror of the blue one — so
 * on the source frame the predicate is the same for both alliances and
 * the alliance never enters it. The starting line is part of the zone
 * ("bounded by and includes the ROBOT STARTING LINE", 2026 manual p. 21);
 * no samples means nothing to gate.
 */
export function startsInAllianceZone(trajectory: Trajectory, zoneDepthM: number): boolean {
  const first = trajectory.samples[0];
  if (!first) return true;
  return first.x >= -1e-9 && first.x <= zoneDepthM + 1e-9;
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

/**
 * Mirror a trajectory between the two trench sides (left↔right): reflection
 * across the field's long centerline, `y → widthM − y`, in whatever frame the
 * samples are already stored in — the caller applies it AFTER the alliance
 * view flip, so one definition serves both alliances. A reflection changes
 * chirality, so heading, vy and ω negate while x, vx and every event time
 * survive unchanged (route order, waits and duration are untouched by
 * construction). An involution: mirroring twice restores the samples
 * bit-for-bit apart from floating-point identity of the arithmetic
 * `widthM − (widthM − y) === y` on IEEE doubles.
 */
export function mirrorAcrossLongAxis(traj: Trajectory, field: FieldPackage): Trajectory {
  const samples = traj.samples.map((s) => ({
    ...s,
    y: field.widthM - s.y,
    heading: wrapAngle(-s.heading),
    vy: -s.vy,
    omega: -s.omega,
  }));
  return { ...traj, samples };
}
