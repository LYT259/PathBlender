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
  /** The season's legal auto starting region as a union of rectangles, in
   *  the blue SOURCE frame (sourceRobots stay blue; the red view derives by
   *  mirroring, so the same rects serve both alliances). The composer grays
   *  first legs starting outside it (user request 2026-10-08). Per-season
   *  derivations, all from the seasons' own game manuals (§5/§6/§7) with
   *  AprilTag-layout cross-checks — see START_ZONE comments at each field:
   *
   *  · 2026 REBUILT — the ALLIANCE ZONE: one rect, wall to 4.0284 m, full
   *    width (manual p. 21: 158.6 in deep × 317.7 in long; starting line
   *    included; tags: blue wall x≈0.008, red trench mirrors blue).
   *  · 2025 REEFSCAPE — BUMPERS must overlap the ROBOT STARTING LINE
   *    (G303-D), 7 ft 4 in from the REEF (glossary). The line is 2.2352 m
   *    from the reef CENTER (x=4.4895 across the face tags 17–22) — the
   *    face reading (7.56 m) would land inside the blue BARGE ZONE
   *    (x∈[6.99, 8.16]), which the line "between each REEF and the BARGE"
   *    excludes. Modeled as a ±0.5 m band around x=6.7247 (a ~0.9 m
   *    robot's bumpers overlap a 2 in line within that center span).
   *  · 2024 CRESCENDO — the ROBOT STARTING ZONE (manual p. 24): 6 ft 4⅛ in
   *    deep × 23 ft 8⅛ in along the wall, bounded by the AMP ZONE (y-max
   *    side: 1 ft 5¾ in = 0.4509 m strip) and the opponent's SOURCE ZONE
   *    (y-min side; the tag layout puts the blue source wall diagonal at
   *    y≈0, tags 9/10, and the amp at y≈8.2, tag 6): y ∈ [0.5474, 7.7601]
   *    (0.5474 + 7.2127 + 0.4509 = 8.211 = field width).
   *  · 2023 CHARGED UP — the COMMUNITY (manual p. 21 + H309-D): 18 ft
   *    (5.4864 m) wide centered, y ∈ [1.3619, 6.8483], with a two-rect
   *    depth — 11 ft ⅜ in (3.3623 m) across the community and 16 ft 1¼ in
   *    (4.9086 m) in front of the CHARGE STATION (its 8 ft / 2.4384 m
   *    pivoting frame, centered in the community width).
   *  · 2022 RAPID REACT — the two TARMACs (12 ft 9 in × 7 ft ¾ in, manual
   *    p. 24; start rule H309/G303: BUMPERS fully inside one) are octagonal
   *    pads sitting DIAGONALLY against the mid-field HUB — not wall strips.
   *    The official placement sheet is unrecoverable (FE-2022 package 404;
   *    the marking diagram's dimension chain does not close numerically; the
   *    official STEP CAD models no tape), so the region is fit from REAL
   *    match starts of three public team repos (Team3128/3128-robot-2022,
   *    1757WestwoodRobotics/2022-RapidReact — whose autos are literally
   *    named '5bR'/'4bL' Right/Left tarmac — and gwhs/RobotV1 'Tarmac-A'):
   *    9 true-start anchors cluster at x 4.94–8.20 m, mirrored about the
   *    width centreline, hugging the hub (gwhs's start at 8.20 pins the
   *    near-hub edge). Extending by a half-robot (2022 frame cap 36.5 in +
   *    tape half) gives the union rect below; the independent 45°-pad
   *    projection ((153+84.75)/√2 = 4.27 m) matches the fitted x span
   *    (4.18 m) within 9 cm. Precision class: ±10 cm, sample-derived.
   *  Undefined = the season has no (established) starting region → ungated. */
  startZone?: StartZoneRect[];
  /** Named starting-position groups for the route library's "group by start"
   *  order (user request 2026-10-09): advisory display classes, not gates —
   *  unlike startZone they never block or gray anything, they only sort
   *  routes whose first sample falls inside one. In the blue SOURCE frame
   *  (the red view mirrors onto the same geometry). Currently only 2026
   *  REBUILT defines classes; seasons without them keep the plain filename
   *  order and the picker hides the toggle. Every id must ship an i18n key
   *  `sequence.startGroup<Id>` in the web app. */
  startRegions?: readonly StartRegionClass[];
}

/** One named grouping region for route starts (blue source frame). */
export interface StartRegionClass {
  /** Grouping id ('trench', 'hub', …) — matches the i18n key suffix. */
  id: string;
  geometry: StartRegionGeometry;
}

/**
 * Grouping geometry: an `aabb` is the class when the start sample lies in
 * the box; a `nearRect` is the class when the start's distance to the box
 * (0 inside) is within maxDistanceM — for "starts pushed against the
 * structure" classes whose exact stand-off varies by robot length.
 */
export type StartRegionGeometry =
  | { kind: 'aabb'; xMinM: number; xMaxM: number; yMinM: number; yMaxM: number }
  | { kind: 'nearRect'; xMinM: number; xMaxM: number; yMinM: number; yMaxM: number; maxDistanceM: number };

/** One rectangle of a season's legal auto starting region (blue source frame). */
export interface StartZoneRect {
  xMinM: number;
  xMaxM: number;
  yMinM: number;
  yMaxM: number;
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
  startZone: [{ xMinM: 0, xMaxM: 4.0284, yMinM: 0, yMaxM: 8.069 }],
  // START REGIONS 2026 (user request 2026-10-09, route-library grouping) —
  // all geometry from the 2026 Game Manual §5 (TU22), AprilTag assignment
  // §5.x as pinned by the WPILib welded layout:
  //  · HUB (§5.4): 47 in (1.1937 m) square prism, near face ON the robot
  //    starting line 158.6 in (4.0284 m) from the alliance wall, centered
  //    on the field midline → footprint x[4.0284, 5.2221], y[3.4376,
  //    4.6316] (midline 4.0346 ± 0.597). Class = start within 0.8 m of the
  //    footprint: real "pushed against the HUB" starts (M1/M3/MSm) measure
  //    0.40–0.49 m; the nearest non-HUB real start (L5-style, mid-area) is
  //    1.33 m — the 0.8 m band splits them with ≥0.3 m margin both ways.
  //  · TRENCH (§5.6): 65.65 in (1.6682 m) wide × 47 in (1.1937 m) deep
  //    drive-under arms running from each guardrail toward the BUMPS, just
  //    past the starting line; the manual's tag assignment (trench tags 17/
  //    22/23/28 at x 4.588–4.663, y 0.6445/7.4248 ≈ the opening centers)
  //    pins the arms' centers at x≈4.62 → upper arm x[3.7859, 5.4541] ×
  //    y[6.8763, 8.07], lower arm mirrored. Class = inside an arm footprint
  //    with a 0.40 m approach grace in x (real under-arm starts L1/L11 read
  //    x 3.97–4.43; 8814's FCeSt stages 0.26 m short of the arm with its
  //    bumper at the opening) and 0.10 m in y; SCsS at 1.18 m short of the
  //    arm stays unclassified.
  startRegions: [
    { id: 'trench', geometry: { kind: 'aabb', xMinM: 3.3859, xMaxM: 5.8541, yMinM: 6.7763, yMaxM: 8.17 } },
    { id: 'trench', geometry: { kind: 'aabb', xMinM: 3.3859, xMaxM: 5.8541, yMinM: -0.1, yMaxM: 1.2937 } },
    { id: 'hub', geometry: { kind: 'nearRect', xMinM: 4.0284, xMaxM: 5.2221, yMinM: 3.4376, yMaxM: 4.6316, maxDistanceM: 0.8 } },
  ],
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
    // START_ZONE 2022 — the hub-flanking TARMAC pair, sample-fit union rect
    // (derivation in the FieldPackage.startZone comment): three teams' real
    // match starts + half-robot margin; x 4.47..8.65 hugs the hub (8.23),
    // y mirror-symmetric about the 4.115 centreline.
    startZone: [{ xMinM: 4.47, xMaxM: 8.65, yMinM: 1.01, yMaxM: 7.22 }],
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
    // START_ZONE 2023 — the COMMUNITY (H309-D): 18 ft wide, centered; 11 ft ⅜ in
    // deep across the community, 16 ft 1¼ in deep in front of the 8 ft CHARGE
    // STATION frame (centered in the community width). Widths in THIS frame
    // (the PP playfield canvas, 8.0163 m — not the manual's 8.2102 enclosure).
    startZone: [
      { xMinM: 0, xMaxM: 3.3623, yMinM: 1.2649, yMaxM: 6.7513 },
      { xMinM: 0, xMaxM: 4.9085, yMinM: 2.7889, yMaxM: 5.2273 },
    ],
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
    // START_ZONE 2024 — the ROBOT STARTING ZONE: 6 ft 4⅛ in deep × 23 ft 8⅛ in
    // along the wall, between the AMP ZONE strip (1 ft 5¾ in, y-max side —
    // tag 6 sits at y=8.204) and the opponent's SOURCE ZONE diagonal (y-min
    // side — tags 9/10). y bounds from 8.2093 − 0.4508 − 7.2168 = 0.5417.
    startZone: [{ xMinM: 0, xMaxM: 1.9336, yMinM: 0.5417, yMaxM: 7.7584 }],
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
    // START_ZONE 2025 — BUMPERS overlap the ROBOT STARTING LINE (G303-D), a
    // full-width black line 7 ft 4 in from the REEF center (x=4.4895 across
    // face tags 17–22 → line x=6.7247; the from-the-face reading, 7.56, is
    // excluded — it lands inside the blue BARGE ZONE [6.99, 8.16], which the
    // line "between each REEF and the BARGE" cannot). ±0.5 m band: a ~0.9 m
    // robot's bumpers overlap the 2 in line within that center span.
    startZone: [{ xMinM: 6.2247, xMaxM: 7.2247, yMinM: 0, yMaxM: 8.052 }],
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
 * Whether a trajectory's first sample starts inside the season's legal auto
 * starting region (FieldPackage.startZone, a union of rectangles). The
 * trajectory is the blue-frame SOURCE sample (sourceRobots stay blue;
 * `robotsForAlliance` derives the red view), and the red view's region is
 * the mirror of the blue one — so on the source frame the predicate is the
 * same for both alliances and the alliance never enters it. Zone boundaries
 * are inclusive (tape belongs to the zone); no samples means nothing to
 * gate.
 */
export function startsInAllianceZone(trajectory: Trajectory, zone: readonly StartZoneRect[]): boolean {
  const first = trajectory.samples[0];
  if (!first) return true;
  return zone.some((r) =>
    first.x >= r.xMinM - 1e-9 && first.x <= r.xMaxM + 1e-9 &&
    first.y >= r.yMinM - 1e-9 && first.y <= r.yMaxM + 1e-9);
}

/**
 * The named start group a route's FIRST sample falls into — the route
 * library's "group by start" key (user request 2026-10-09). Advisory only:
 * unlike startsInAllianceZone this never gates anything, it just sorts.
 * Returns undefined when the season defines no classes, the route has no
 * samples, or the start matches none (the "other starts" bucket).
 */
export function routeStartRegion(
  trajectory: Trajectory,
  regions: readonly StartRegionClass[] | undefined,
): string | undefined {
  if (!regions || regions.length === 0) return undefined;
  const first = trajectory.samples[0];
  if (!first) return undefined;
  for (const region of regions) {
    const g = region.geometry;
    if (g.kind === 'aabb') {
      if (first.x >= g.xMinM - 1e-9 && first.x <= g.xMaxM + 1e-9
        && first.y >= g.yMinM - 1e-9 && first.y <= g.yMaxM + 1e-9) return region.id;
    } else {
      const dx = Math.max(g.xMinM - first.x, 0, first.x - g.xMaxM);
      const dy = Math.max(g.yMinM - first.y, 0, first.y - g.yMaxM);
      if (Math.hypot(dx, dy) <= g.maxDistanceM + 1e-9) return region.id;
    }
  }
  return undefined;
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
