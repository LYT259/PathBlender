// Per-season obstacle extraction config + pipeline.
// Manual source of record for classifications/dimensions: each season's
// official Game Manual §5 (ARENA) — 2026: https://www.frcmanual.com/2026/arena
// (checked 2026-11-08). Field constants + AprilTag layouts come from
// @pathblender/core (run `npm run build -w @pathblender/core` first — plain
// Node resolves the workspace package to its dist).
//
// Geometry discipline (red book §6.7): every hull below is extracted from the
// bundled official-CAD GLB by code; config rows carry citations, never
// hand-typed coordinates. UNVERIFIED gaps are marked inline.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@pathblender/core';
import {
  parseGlb,
  elementGroups,
  worldMatrices,
  makeNativeToWorld,
  monotoneChainHull,
  groupWorldPoints,
  clusterPoints,
  pointNearHull,
  accessorVertices,
} from './extract.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FIELDS3D_DIR = resolve(SCRIPT_DIR, '../../packages/web/public/fields3d');
const DATA_OUT = resolve(SCRIPT_DIR, '../../packages/core/src/field-obstacles-data.ts');

export const glbPath = (dir) => resolve(FIELDS3D_DIR, dir, 'model.glb');
export const configPath = (dir) => resolve(FIELDS3D_DIR, dir, 'config.json');

/** Same rule as packages/web/src/field3d-frame.ts:118 (configMirrorAxis):
 *  a `z:180°` rotations entry ⇒ 'x', else 'z'. The generator always derives
 *  the mirror from the shipped config.json — never a hand-set axis. */
export function configMirrorAxis(rotations) {
  const turn = (deg) => ((deg % 360) + 360) % 360;
  return rotations.some((r) => r.axis === 'z' && Math.abs(turn(r.degrees) - 180) < 1e-6)
    ? 'x'
    : 'z';
}

export { pointNearHull };

/**
 * Lower edge of the extraction band, meters. FRC bumpers never reach below
 * ~2 in (5.08 cm) off the carpet, so structure that exists only under this
 * line cannot touch a bumper and is drivable floor furniture (HANGAR
 * baseplates ⅛ in, floor-protection hardboard ⅜ in, cable-protector floor
 * runs ¾ in, CARGO rings ⅛ in). Keeping them out also stops floor sheets
 * from bridging disjoint legs into one cluster.
 */
const BAND_FLOOR_M = 0.05;
/** Cluster cell size — connects same-element substructure (2023 GRID
 * dividers ~47 cm apart), separates genuinely disjoint legs (≥ 2.7 m). */
const CLUSTER_CELL_M = 0.5;

export const SEASONS = [
  {
    fieldId: 'rebuilt-2026',
    // Single welded GLB ships for 2026 (FIELD3D_MODELS has no andymark entry);
    // obstaclesForField falls back to welded for the andymark variant. The
    // AndyMark structure offsets measured in field3d-frame.ts (~14 mm) are far
    // below the 3 in collision tolerance.
    glbDir: { welded: '2026-rebuilt' },
    // Band rationale (deviation from plan's 1.5 m, recorded in the plan file's
    // spirit of honesty over literalism): the bumper model is flat 2D, so any
    // in-band vertex extends the hull horizontally. The 2026 hub's net poles
    // lean outward only above ~0.9 m — a 1.5 m band would mark legally
    // drivable space behind them as blocked. [0, 0.5] m is a superset of the
    // FRC bumper zone that excludes high-only overhangs while keeping every
    // structure a bumper can actually touch (hubs, towers, stage legs,
    // coral stations — all present from the floor).
    bandTopM: 0.5,
    elements: [
      {
        match: /^GE-26300: Hub /, id: 'hub', name: 'Hub', action: 'include', alliancePaired: true,
        reason: '47 in square prism from the floor (§5.4) — blocks ground robots',
        citation: '2026 Game Manual §5.4 (HUB)',
      },
      {
        match: /^GE-26500: Tower /, id: 'tower', name: 'Tower', action: 'include', alliancePaired: true,
        reason: 'uprights rise from the floor inside the ALLIANCE ZONE (§5.8)',
        citation: '2026 Game Manual §5.8 (TOWER)',
      },
      {
        match: /^GE-26200: Trench /, id: 'trench', name: 'Trench', action: 'exclude',
        reason: 'structure ROBOTS drive underneath (§5.6)',
        citation: '2026 Game Manual §5.6 (TRENCH)',
      },
      {
        match: /^GE-26100: Bump /, id: 'bump', name: 'Bump', action: 'exclude',
        reason: '6.513 in tall structures ROBOTS drive over (§5.5) — in the bumper band but explicitly traversable',
        citation: '2026 Game Manual §5.5 (BUMP)',
      },
      {
        match: /^GE-26000: Outpost /, id: 'outpost', name: 'Outpost', action: 'exclude',
        reason: 'part of the field boundary (§5.2: the FIELD is bounded by ALLIANCE WALLS, OUTPOSTS, TOWER WALLS, guardrails); boundary crossings are detectFieldBounds\' domain. Its GLB assembly sits at/outside the playfield corner — the in-field sliver is 1.9 cm, below the 3 in tolerance either way',
        citation: '2026 Game Manual §5.2, §5.9.2',
      },
      {
        match: /^GE-26600: Depot /, id: 'depot', name: 'Depot', action: 'exclude',
        reason: '1.125 in (2.86 cm) floor barrier (§5.7) — max possible bumper overlap 0.029 m < 0.0762 m tolerance, can never report; the DEPOT sits inside the ALLIANCE ZONE robots legally occupy (§5.3). GLB cross-check: extracted footprint 0.6858 × 1.0668 m = 27 in × 42 in exactly',
        citation: '2026 Game Manual §5.7 (DEPOT), §5.3',
      },
      {
        match: /^GE-26900: Fuel$/, id: 'fuel', name: 'Fuel', action: 'exclude',
        reason: 'SCORING ELEMENTS (5.91 in foam balls), not field structure',
        citation: '2026 Game Manual §5.10 (FUEL)',
      },
      {
        match: /^FE-2026-02: /, id: 'perimeter', name: 'Perimeter', action: 'exclude',
        reason: 'welded perimeter assembly (walls + guardrails) — owned by detectFieldBounds',
        citation: '2026 Game Manual §5.2',
      },
      {
        match: /^FE-2026-01: |^(Gaffer|Carpet) /, id: 'markings', name: 'Markings', action: 'exclude',
        reason: 'carpet + gaffer-tape field markings',
        citation: '2026 Game Manual §5.2, §5.3',
      },
    ],
    // Tag→element assignment per §5.10 (HUB tag IDs; TOWER WALL tags) with the
    // x-split pinned by the WPILib welded layout. Hub tags are face-mounted at
    // z=1.124 m (44.25 in, §5.10) — admissible anchors because the §5.4 prism
    // cross-section at that height is still the full 47 in square (they do not
    // hover past the base the way reef-top tags do). Trench tags 1/6/7/12/17/
    // 22/23/28 and outpost tags 13/14/29/30 belong to excluded elements.
    tagAnchors: [
      { obstacleId: 'hub-blue', tagIds: [18, 19, 20, 21, 24, 25, 26, 27], citation: '§5.10 HUB IDs, WPILib welded layout' },
      { obstacleId: 'hub-red', tagIds: [2, 3, 4, 5, 8, 9, 10, 11], citation: '§5.10 HUB IDs, WPILib welded layout' },
      { obstacleId: 'tower-blue', tagIds: [31, 32], citation: '§5.10 TOWER WALL IDs (z=0.5524 m)' },
      { obstacleId: 'tower-red', tagIds: [15, 16], citation: '§5.10 TOWER WALL IDs (z=0.5524 m)' },
    ],
    // Values re-derived from the manual + field.ts REBUILT_2026 comments
    // (§5.4 + §5.3 starting line). 47 in = 1.1938 m exactly.
    manualDims: [
      { obstacleId: 'hub-blue', kind: 'span', axis: 'x', expectM: 1.1938, tolM: 0.02, citation: '§5.4 47 in' },
      { obstacleId: 'hub-blue', kind: 'span', axis: 'y', expectM: 1.1938, tolM: 0.02, citation: '§5.4 47 in' },
      { obstacleId: 'hub-blue', kind: 'min', axis: 'x', expectM: 4.0284, tolM: 0.02, citation: '§5.4 + §5.3: 158.6 in starting line' },
      { obstacleId: 'hub-blue', kind: 'center', axis: 'y', expectM: 4.0346, tolM: 0.02, citation: '§5.4 centered on midline' },
      { obstacleId: 'hub-red', kind: 'span', axis: 'x', expectM: 1.1938, tolM: 0.02, citation: '§5.4 47 in' },
      { obstacleId: 'hub-red', kind: 'span', axis: 'y', expectM: 1.1938, tolM: 0.02, citation: '§5.4 47 in' },
      { obstacleId: 'hub-red', kind: 'max', axis: 'x', expectM: 16.54 - 4.0284, tolM: 0.02, citation: '§5.4 mirrored: 158.6 in from red wall' },
      { obstacleId: 'hub-red', kind: 'center', axis: 'y', expectM: 4.0346, tolM: 0.02, citation: '§5.4 centered on midline' },
      // Tower dims deliberately absent: §5.8's 49.25 in width / 45.0 in depth
      // describe the TOWER WALL + baseplate extents; the baseplate (0.2–0.3 in
      // tall edges) is drivable floor furniture below BAND_FLOOR_M, so the
      // extracted bumper-band hull (uprights + wall, measured 1.1178 × 1.1062)
      // has no manual dimension to pin. Tower-wall tag anchors + the
      // direction-sensitive hub dims carry the orientation check.
    ],
  },
  {
    fieldId: 'rapidreact-2022',
    glbDir: { welded: '2022-rapidreact' },
    bandTopM: 0.5,
    // UNVERIFIED (orientation residual, red book §16.26): 2022 ships no
    // AprilTag decals and the layout is rotationally symmetric, so no
    // tag anchor can catch a 180° flip. Orientation rests on the shared
    // config-derived mirror contract (configMirrorAxis, pinned by the
    // 2024-2026 tag registration in field3d-model.test.ts) plus the
    // CAD-named HANGAR alliances cross-checked against the schematic's
    // alliance-colour order (field.ts rapidreact-2022 imageRendered
    // comment). No manual dim row below is direction-sensitive.
    tagAnchors: [],
    elements: [
      {
        match: /^THE HUB /, id: 'hub', name: 'Hub', action: 'include',
        reason: 'shared central HUB: fenders, lower hub base and exit mouths all stand on the carpet (§5.3)',
        citation: '2022 Game Manual §5.3 (HUB)',
      },
      {
        match: /^HANGAR /, id: 'hangar', name: 'Hangar', action: 'include', alliancePaired: true, split: 'legs',
        reason: 'truss legs rise from baseplates on the carpet (§5.4.1); per-leg hulls keep the open interior drivable',
        citation: '2022 Game Manual §5.4 (HANGAR)',
      },
      {
        match: /^TERMINAL /, id: 'terminal', name: 'Terminal', action: 'include', alliancePaired: true,
        reason: 'corner assembly whose front faces bound the FIELD (§5) but whose body occupies ~2 m of reachable playfield corner — clipping the rect keeps the corner honest',
        citation: '2022 Game Manual §5.5 (TERMINAL)',
      },
      {
        match: /^CARGORINGS_HUB$|Tennis Ball/, id: 'cargo', name: 'Cargo', action: 'exclude',
        reason: 'game pieces + ⅛ in floor O-rings (not field structure)',
        citation: '2022 Game Manual §5 (CARGO / CARGO RING)',
      },
      {
        match: /^GE-00305 |^FE-00300|^GE-22600/, id: 'cable-protector', name: 'Cable Protector', action: 'exclude',
        reason: 'cable protector run: floor segments ⅞ in tall (below the 3 in tolerance); exit segment rides the guardrail',
        citation: '2022 Game Manual §5 (cable protector)',
      },
      {
        match: /^GE-22202_Weldment/, id: 'hangar-wall', name: 'Hangar Wall', action: 'exclude',
        reason: 'HANGAR WALL between DRIVER STATION 1 and the guardrail is integrated into the alliance wall (2\'9⅝" wide, in-rect sliver 3 mm)',
        citation: '2022 Game Manual §5.6.2 (HANGAR WALLS)',
      },
      {
        match: /^Field Wall|^Driver Station Wall/, id: 'perimeter', name: 'Perimeter', action: 'exclude',
        reason: 'walls + guardrails owned by detectFieldBounds',
        citation: '2022 Game Manual §5',
      },
      {
        match: /^Carpet|^tapeline_|^Field Pin/, id: 'markings', name: 'Markings', action: 'exclude',
        reason: 'carpet, tape lines/zone markings and floor pins',
        citation: '2022 Game Manual §5 (zones and markings)',
      },
    ],
    manualDims: [
      // §5.3: the HUB is "centered on the FIELD" — flip-invariant, stated
      // honestly. No span row: the in-band hull (2.635 m) is a composite of
      // fenders + lower exits that no single manual dimension describes
      // (§5.3.1 fender faces 2'9⅞" from centre; §5.3 8'11" overall includes
      // the UPPER exits at 2.64 m height).
      { obstacleId: 'hub', kind: 'center', axis: 'x', expectM: 16.4592 / 2, tolM: 0.02, citation: '§5.3 centered on the FIELD' },
      { obstacleId: 'hub', kind: 'center', axis: 'y', expectM: 8.2296 / 2, tolM: 0.02, citation: '§5.3 centered on the FIELD' },
    ],
  },
  {
    fieldId: 'chargedup-2023',
    glbDir: { welded: '2023-chargedup' },
    bandTopM: 0.5,
    elements: [
      {
        match: /Grid \(GE-23000\)/, id: 'grid', name: 'Grid', action: 'include', alliancePaired: true,
        reason: 'grid columns, hybrid dividers (5 in) and node structure stand on the carpet in front of the alliance wall (§5.5)',
        citation: '2023 Game Manual §5.5 (GRIDS)',
      },
      {
        match: /^Barrier /, id: 'barrier', name: 'Barrier', action: 'include', alliancePaired: true,
        reason: '1\'4" base + 1\'¼" (31 cm) polycarbonate wall separating COMMUNITY from LOADING ZONE (§5.5) — bumper-height wall',
        citation: '2023 Game Manual §5.5 (BARRIER)',
      },
      {
        match: /^Double Substation /, id: 'substation', name: 'Double Substation', action: 'include', alliancePaired: true,
        reason: 'extends 1\'2" into the FIELD past the alliance wall (§5.6.2) — robots legally touch its face; suffix = field end (the substation at the blue wall is the red alliance\'s, §5.5)',
        citation: '2023 Game Manual §5.6.2 (DOUBLE SUBSTATION)',
      },
      {
        match: /^Charging Station /, id: 'charge-station', name: 'Charging Station', action: 'exclude',
        reason: 'drive-on platform (plan directive; §5.4 pivoting surface + ramps)',
        citation: '2023 Game Manual §5.4 (CHARGE STATION)',
      },
      {
        match: /Single Substation /, id: 'single-substation', name: 'Single Substation', action: 'exclude',
        reason: 'in-line with the guardrail, FIELD-facing wall 3⅛ in BEHIND the guardrail (§5.6.1) — boundary, in-rect sliver ~4 cm',
        citation: '2023 Game Manual §5.6.1 (SINGLE SUBSTATION)',
      },
      {
        match: /^FE-0030[07]|^GE-23500 /, id: 'cable-protector', name: 'Cable Protector', action: 'exclude',
        reason: 'cable protector runs: floor segments ⅞ in tall; exit segment extends 1¾ in past the guardrail (§5) — below the 3 in tolerance',
        citation: '2023 Game Manual §5 (cable protector)',
      },
      {
        match: /Field Wall|^Driver Station Wall/, id: 'perimeter', name: 'Perimeter', action: 'exclude',
        reason: 'walls + guardrails owned by detectFieldBounds',
        citation: '2023 Game Manual §5',
      },
      {
        match: /^Carpet|^Cube v3|^Traffic Cone|^Staging Mark|Staged Game Pieces|^Tape_|Grid Front Tape|Scoring Zone Tape|Loading Station Zone|Centerline/, id: 'markings', name: 'Markings', action: 'exclude',
        reason: 'carpet, tape markings and staged game pieces',
        citation: '2023 Game Manual §5 (zones and markings, §5.8)',
      },
    ],
    // §5.9.2: GRID tags on the middle-row cube nodes (z=0.4628); DOUBLE
    // SUBSTATION tags at z=0.6955 — both face-mounted, z < 1.0 m.
    tagAnchors: [
      { obstacleId: 'grid-blue', tagIds: [6, 7, 8], citation: '§5.9.2 GRID AprilTags' },
      { obstacleId: 'grid-red', tagIds: [1, 2, 3], citation: '§5.9.2 GRID AprilTags' },
      { obstacleId: 'substation-blue', tagIds: [5], citation: '§5.9.2 DOUBLE SUBSTATION AprilTags' },
      { obstacleId: 'substation-red', tagIds: [4], citation: '§5.9.2 DOUBLE SUBSTATION AprilTags' },
    ],
    manualDims: [
      // Grid structure front sits ~5 cm behind the assembly's front tape
      // line (§5.5 4'8¼" assembly incl. tape; the tape is a separate
      // markings group) — only the width row is manual-verifiable.
      { obstacleId: 'grid-blue', kind: 'span', axis: 'y', expectM: 5.4991, tolM: 0.02, citation: '§5.5 18 ft ½ in wide' },
      { obstacleId: 'grid-red', kind: 'span', axis: 'y', expectM: 5.4991, tolM: 0.02, citation: '§5.5 18 ft ½ in wide' },
      { obstacleId: 'barrier-blue', kind: 'span', axis: 'x', expectM: 2.2352 - 2 * 0.0127, tolM: 0.02, citation: '§5.5 base 7 ft 4 in; hull = ½ in-thick wall inset ½ in per end (base itself is ¼ in floor furniture below BAND_FLOOR_M)' },
      { obstacleId: 'barrier-red', kind: 'span', axis: 'x', expectM: 2.2352 - 2 * 0.0127, tolM: 0.02, citation: '§5.5 derived (see barrier-blue)' },
      { obstacleId: 'substation-blue', kind: 'max', axis: 'x', expectM: 0.3556, tolM: 0.02, citation: '§5.6.2 extends 1 ft 2 in into the FIELD' },
      { obstacleId: 'substation-red', kind: 'min', axis: 'x', expectM: 16.5405 - 0.3556, tolM: 0.02, citation: '§5.6.2 mirrored' },
    ],
  },
  {
    fieldId: 'crescendo-2024',
    glbDir: { welded: '2024-crescendo' },
    bandTopM: 0.5,
    elements: [
      {
        match: /^Speaker /, id: 'speaker', name: 'Speaker', action: 'include', alliancePaired: true,
        reason: 'SUBWOOFER: 6-faced element against the alliance wall extending 3\'⅛" into the FIELD, structure from the carpet (§5.6.1)',
        citation: '2024 Game Manual §5.6.1 (SPEAKER / SUBWOOFER)',
      },
      {
        match: /^Source /, id: 'source', name: 'Source', action: 'include', alliancePaired: true,
        reason: 'corner SOURCE assembly (§5.4) occupies ~1.8 × 1.1 m of reachable playfield corner',
        citation: '2024 Game Manual §5.4 (SOURCE)',
      },
      {
        match: /^Stage /, id: 'stage', name: 'Stage', action: 'include', alliancePaired: true, split: 'legs',
        reason: '3 truss feet from the carpet per STAGE (§5.5); core clears at 2\'3⅞" (71 cm) and chains hang at 72 cm — per-leg hulls keep under-stage driving free',
        citation: '2024 Game Manual §5.5 (STAGE)',
      },
      {
        match: /^Amp /, id: 'amp', name: 'Amp', action: 'exclude',
        reason: 'guardrail-mounted (§5.1: FIELD bounded by AMPS); in-rect extent ~1.1 cm — below the 3 in tolerance either way',
        citation: '2024 Game Manual §5.3 (AMP), §5.1',
      },
      {
        match: /^Note Holder /, id: 'note-holder', name: 'Note Holder', action: 'exclude',
        reason: 'sub-assembly inside the SOURCE footprint (measured containment, GE-24400 ⊂ GE-24000) — covered by the source hull; avoids double counting',
        citation: '2024 Game Manual §5.4 (SOURCE assembly)',
      },
      {
        match: /^Note$|^High Note$/, id: 'note', name: 'Note', action: 'exclude',
        reason: 'game pieces',
        citation: '2024 Game Manual §5.7 (NOTE / HIGH NOTE)',
      },
      {
        match: /Field Wall|Driver Stations/, id: 'perimeter', name: 'Perimeter', action: 'exclude',
        reason: 'walls + guardrails owned by detectFieldBounds',
        citation: '2024 Game Manual §5',
      },
      {
        match: /^Carpet & Tape/, id: 'markings', name: 'Markings', action: 'exclude',
        reason: 'carpet + tape markings',
        citation: '2024 Game Manual §5.2',
      },
    ],
    // §5.8: SPEAKER tags 3/4/7/8 sit on the ALLIANCE WALL above the
    // SUBWOOFER (z=1.4511, wall plane flush with the subwoofer back);
    // SOURCE tags 1/2/9/10 on the SOURCE wall (z=1.3559, vertical face).
    // STAGE tags 11–16 are mounted on the suspended STAGE core (§5.8,
    // z=1.3208) — they hover between the legs and are NOT admissible.
    // AMP tags 5/6: amp excluded.
    tagAnchors: [
      { obstacleId: 'speaker-blue', tagIds: [7, 8], citation: '§5.8 SPEAKER AprilTags' },
      { obstacleId: 'speaker-red', tagIds: [3, 4], citation: '§5.8 SPEAKER AprilTags' },
      { obstacleId: 'source-blue', tagIds: [9, 10], citation: '§5.8 SOURCE AprilTags' },
      { obstacleId: 'source-red', tagIds: [1, 2], citation: '§5.8 SOURCE AprilTags' },
    ],
    manualDims: [
      // §5.6.1: the SUBWOOFER extends 3 ft ⅛ in (0.9171 m) from the ALLIANCE
      // WALL. No width row: the manual states no SUBWOOFER width.
      { obstacleId: 'speaker-blue', kind: 'max', axis: 'x', expectM: 0.9171, tolM: 0.02, citation: '§5.6.1 SUBWOOFER 3 ft ⅛ in' },
      { obstacleId: 'speaker-red', kind: 'min', axis: 'x', expectM: 16.5405 - 0.9171, tolM: 0.02, citation: '§5.6.1 mirrored' },
    ],
  },
  {
    fieldId: 'reefscape-2025',
    glbDir: { welded: '2025-reefscape-welded', andymark: '2025-reefscape-andymark' },
    bandTopM: 0.5,
    elements: [
      {
        match: /^REEF /, id: 'reef', name: 'Reef', action: 'include', alliancePaired: true,
        reason: 'hexagonal base with trough (front edge 46 cm) and vertical pipes from the carpet (§5.3)',
        citation: '2025 Game Manual §5.3 (REEF)',
      },
      {
        match: /^CORAL STATION /, id: 'coral-station', name: 'Coral Station', action: 'include', multiPaired: true,
        reason: 'corner assemblies connecting guardrail to ALLIANCE WALL (§5.6.2) occupying ~1.7 × 1.3 m of reachable corner; the welded/AndyMark builds differ ~7 cm here (field.ts 2025 imageRendered comment)',
        citation: '2025 Game Manual §5.6.2 (CORAL STATION)',
      },
      {
        match: /^BARGE /, id: 'barge-post', name: 'Barge Post', action: 'include',
        reason: 'the BARGE truss/cages are overhead (truss at 5\'2", §5.4) and its legs stand outside the guardrails — but the centre support column rises from the carpet at midfield (§5.4 "supported in the center of the FIELD by vertical truss"), which is real bumper-band blocking geometry (deviation from the plan\'s blanket barge exclusion, driven by measured GLB geometry; cluster naming keeps only the post)',
        citation: '2025 Game Manual §5.4 (BARGE)',
      },
      {
        match: /^PROCESSOR /, id: 'processor', name: 'Processor', action: 'exclude',
        reason: 'integrated into the guardrail (§5.1 FIELD bounded by PROCESSORS); measured in-rect extent ~1 mm',
        citation: '2025 Game Manual §5.5 (PROCESSOR), §5.1',
      },
      {
        match: /^CORAL HOLDER /, id: 'coral-holder', name: 'Coral Holder', action: 'exclude',
        reason: 'sub-assembly inside the CORAL STATION footprint (measured containment, GE-25410 ⊂ GE-25000) — covered by the station hull',
        citation: '2025 Game Manual §5.6.2',
      },
      {
        match: /^ALGAE|^CORAL \(|^algae$/, id: 'game-pieces', name: 'Coral & Algae', action: 'exclude',
        reason: 'scoring elements',
        citation: '2025 Game Manual §5.7',
      },
      {
        match: /FIELD WALL|DRIVER STATIONS/, id: 'perimeter', name: 'Perimeter', action: 'exclude',
        reason: 'walls + guardrails owned by detectFieldBounds',
        citation: '2025 Game Manual §5',
      },
      {
        match: /^Carpet & Tape/, id: 'markings', name: 'Markings', action: 'exclude',
        reason: 'carpet + tape markings',
        citation: '2025 Game Manual §5.2',
      },
    ],
    // §5.8: REEF face tags at z=0.3081 (6⅞ in, mounted on the faces);
    // CORAL STATION tags at z=1.4859 face-mounted on the station (a tall
    // box to 1.7 m — cross-section at tag height equals the base footprint).
    // BARGE tags 4/5/14/15 (z=1.8679, 30° lean above the cages) and
    // PROCESSOR tags 3/16 (processor excluded) anchor nothing.
    tagAnchors: [
      { obstacleId: 'reef-blue', tagIds: [17, 18, 19, 20, 21, 22], citation: '§5.8 REEF AprilTags (faces)' },
      { obstacleId: 'reef-red', tagIds: [6, 7, 8, 9, 10, 11], citation: '§5.8 REEF AprilTags (faces)' },
      { obstacleId: 'coral-station-blue-low', tagIds: [12], citation: '§5.8 CORAL STATION AprilTags' },
      { obstacleId: 'coral-station-blue-high', tagIds: [13], citation: '§5.8 CORAL STATION AprilTags' },
      { obstacleId: 'coral-station-red-low', tagIds: [1], citation: '§5.8 CORAL STATION AprilTags' },
      { obstacleId: 'coral-station-red-high', tagIds: [2], citation: '§5.8 CORAL STATION AprilTags' },
    ],
    manualDims: [
      { obstacleId: 'reef-blue', kind: 'span', axis: 'x', expectM: 1.6637, tolM: 0.02, citation: '§5.3 5 ft 5½ in hexagon (face to face)' },
      { obstacleId: 'reef-blue', kind: 'min', axis: 'x', expectM: 3.6576, tolM: 0.02, citation: '§5.3 12 ft from the ALLIANCE WALL (near face)' },
      { obstacleId: 'reef-blue', kind: 'center', axis: 'y', expectM: 8.052 / 2, tolM: 0.02, citation: '§5.3 centered between guardrails' },
      { obstacleId: 'reef-red', kind: 'span', axis: 'x', expectM: 1.6637, tolM: 0.02, citation: '§5.3 mirrored' },
      { obstacleId: 'reef-red', kind: 'max', axis: 'x', expectM: 17.548 - 3.6576, tolM: 0.02, citation: '§5.3 mirrored' },
      { obstacleId: 'reef-red', kind: 'center', axis: 'y', expectM: 8.052 / 2, tolM: 0.02, citation: '§5.3 centered between guardrails' },
    ],
  },
];

/** Group classification: first matching row wins. */
function classify(season, groups) {
  const errors = [];
  const classified = groups.map((g) => {
    const row = season.elements.find((r) => r.match.test(g.name));
    if (!row) errors.push(`no config row matches group ${JSON.stringify(g.name)}`);
    return { group: g, row };
  });
  for (const r of season.elements) {
    if (r.action === 'include' && !classified.some((c) => c.row === r)) {
      errors.push(`include row ${r.id} matches no group`);
    }
  }
  return { classified, errors };
}

const round4 = (v) => Math.round(v * 1e4) / 1e4;

/** Extract + validate one season → variant-set object for FIELD_OBSTACLE_DATA.
 *  Throws on any validation failure (never a best-effort write). */
export async function extractSeason(season) {
  const field = core.FIELDS.find((f) => f.id === season.fieldId);
  if (!field) throw new Error(`unknown field ${season.fieldId} (is @pathblender/core dist built?)`);
  const out = {};
  for (const variant of Object.keys(season.glbDir)) {
    const dir = season.glbDir[variant];
    const cfg = JSON.parse(readFileSync(configPath(dir), 'utf8'));
    const mirror = configMirrorAxis(cfg.rotations);
    const cx = field.lengthM / 2;
    const cy = field.widthM / 2;
    const toWorld = makeNativeToWorld(mirror, cx, cy);
    const { json, bin } = parseGlb(readFileSync(glbPath(dir)));
    const groups = elementGroups(json);
    const { classified, errors } = classify(season, groups);
    const obstacles = [];
    const seenIds = new Set();
    for (const { group, row } of classified) {
      if (row?.action !== 'include') continue;
      // Band-passing world points, restricted to the playfield rectangle
      // BEFORE hulling: geometry beyond the walls belongs to the boundary
      // (detectFieldBounds) and would otherwise span hulls across the field
      // (measured: 2025 BARGE legs just outside the guardrails).
      const pts = groupWorldPoints(json, bin, group, {
        zMin: BAND_FLOOR_M,
        zMax: season.bandTopM,
        toWorld,
      }).filter((p) => p.x >= 0 && p.x <= field.lengthM && p.y >= 0 && p.y <= field.widthM);
      if (pts.length === 0) {
        errors.push(`${group.name}: no in-playfield in-band geometry`);
        continue;
      }
      // Split rows (disjoint legs) cluster their structure points; every
      // other row takes ONE hull over all its in-band points (the tower
      // baseplate lives below BAND_FLOOR_M and only clustering on the
      // remaining islands would shatter it).
      const clusters = row.split === 'legs' ? clusterPoints(pts, CLUSTER_CELL_M) : [pts];
      if (clusters.length === 0) {
        errors.push(`${group.name}: only sub-tolerance clusters in band`);
        continue;
      }
      // Deterministic cluster order: sort by centroid (y, then x).
      const centroid = (arr) => [
        arr.reduce((s, p) => s + p.x, 0) / arr.length,
        arr.reduce((s, p) => s + p.y, 0) / arr.length,
      ];
      clusters.sort((a, b) => {
        const [ax, ay] = centroid(a);
        const [bx, by] = centroid(b);
        return ay - by || ax - bx;
      });
      // Alliance/position suffixes come from the GROUP centroid (never hand-set).
      const [gcx, gcy] = centroid(pts);
      const xSide = gcx < field.lengthM / 2 ? 'blue' : 'red';
      const ySide = gcy < field.widthM / 2 ? 'low' : 'high';
      for (let ci = 0; ci < clusters.length; ci++) {
        const cluster = clusters[ci];
        let hull;
        try {
          hull = monotoneChainHull(cluster.map((p) => ({ x: p.x, y: p.y })));
        } catch (err) {
          errors.push(`${group.name} cluster ${ci}: ${err.message}`);
          continue;
        }
        let zLo = Infinity;
        let zHi = -Infinity;
        for (const p of cluster) {
          if (p.height < zLo) zLo = p.height;
          if (p.height > zHi) zHi = p.height;
        }
        // Round to 4 decimals, then drop vertices that rounding left
        // collinear or micro-concave (keeps hulls strictly CCW-convex and
        // free of collinear clutter). Iterate: each drop changes the
        // neighbours, so re-check until stable.
        let clean = hull.map((p) => ({ x: round4(p.x), y: round4(p.y) }));
        for (;;) {
          const next = clean.filter((p, i) => {
            const a = clean[(i + clean.length - 1) % clean.length];
            const c = clean[(i + 1) % clean.length];
            if (!a || !c) return false;
            return (p.x - a.x) * (c.y - p.y) - (p.y - a.y) * (c.x - p.x) > 1e-9;
          });
          if (next.length === clean.length) break;
          clean = next;
        }
        if (clean.length < 3) {
          errors.push(`${group.name} cluster ${ci}: < 3 vertices survive rounding cleanup`);
          continue;
        }
        const id =
          row.split === 'legs' ? `${row.id}-${xSide}-leg${ci + 1}`
          : row.multiPaired ? `${row.id}-${xSide}-${ySide}`
          : `${row.id}${row.alliancePaired ? `-${xSide}` : ''}`;
        if (seenIds.has(id)) errors.push(`duplicate obstacle id ${id}`);
        seenIds.add(id);
        obstacles.push({
          id,
          name: row.split === 'legs' ? `${row.name} Leg` : row.name,
          hull: clean,
          zMinM: round4(zLo),
          zMaxM: round4(zHi),
        });
      }
    }
    obstacles.sort((a, b) => a.id.localeCompare(b.id));

    // Per-variant tag anchors + manual dims + containment.
    const layout = variant === 'andymark' && field.aprilTagsAndyMark ? field.aprilTagsAndyMark : field.aprilTags;
    const tags = new Map((layout ?? []).map((t) => [t.id, t]));
    const byId = new Map(obstacles.map((o) => [o.id, o]));
    for (const anchor of season.tagAnchors) {
      const o = byId.get(anchor.obstacleId);
      if (!o) {
        errors.push(`tagAnchor ${anchor.obstacleId}: no such obstacle`);
        continue;
      }
      for (const id of anchor.tagIds) {
        const tag = tags.get(id);
        if (!tag) {
          errors.push(`tagAnchor ${anchor.obstacleId}: tag ${id} missing from layout`);
          continue;
        }
        if (!pointNearHull({ x: tag.x, y: tag.y }, o.hull, 0.05)) {
          errors.push(`tagAnchor ${anchor.obstacleId} tag ${id} at (${tag.x},${tag.y}) not on/inside hull`);
        }
      }
    }
    for (const dim of season.manualDims) {
      const o = byId.get(dim.obstacleId);
      if (!o) {
        errors.push(`manualDim ${dim.obstacleId}: no such obstacle`);
        continue;
      }
      const vals = o.hull.map((p) => p[dim.axis]);
      const got =
        dim.kind === 'span' ? Math.max(...vals) - Math.min(...vals)
        : dim.kind === 'center' ? (Math.max(...vals) + Math.min(...vals)) / 2
        : dim.kind === 'min' ? Math.min(...vals)
        : Math.max(...vals);
      if (Math.abs(got - dim.expectM) > dim.tolM) {
        errors.push(`manualDim ${dim.obstacleId} ${dim.kind}/${dim.axis}: got ${got.toFixed(4)}, want ${dim.expectM} ±${dim.tolM} (${dim.citation})`);
      }
    }
    for (const o of obstacles) {
      for (const p of o.hull) {
        if (p.x < -0.05 || p.x > field.lengthM + 0.05 || p.y < -0.05 || p.y > field.widthM + 0.05) {
          errors.push(`${o.id}: hull vertex (${p.x},${p.y}) outside playfield ± 0.05`);
        }
      }
    }
    if (errors.length > 0) {
      throw new Error(`${season.fieldId}/${variant} validation failed:\n  ${errors.join('\n  ')}`);
    }
    out[variant] = obstacles;
  }
  return out;
}

/** Render FIELD_OBSTACLE_DATA file content for the given extraction results. */
export function renderDataFile(results) {
  const header = `// GENERATED FILE — do not edit by hand. Regenerate: node scripts/field-obstacles/extract-footprints.mjs
// Source geometry: AdvantageScopeAssets Field3d GLBs (BSD-3-Clause), derived from official FIRST CAD.
// Validated per season against WPILib AprilTag layouts and official game-manual dimensions
// (see scripts/field-obstacles/seasons.mjs for citations). No coordinate in this file is hand-typed.
import type { FieldObstacleVariantSet } from './field-obstacles';

export const FIELD_OBSTACLE_DATA: Record<string, FieldObstacleVariantSet> = {
`;
  const body = Object.keys(results)
    .sort()
    .map((fieldId) => {
      const set = results[fieldId];
      const variants = Object.keys(set)
        .sort()
        .map((variant) => {
          const arr = set[variant].map((o) => {
            const hull = o.hull.map((p) => `          { x: ${p.x}, y: ${p.y} },`).join('\n');
            return `      {
        id: '${o.id}',
        name: '${o.name}',
        hull: [
${hull}
        ],
        zMinM: ${o.zMinM},
        zMaxM: ${o.zMaxM},
      },`;
          }).join('\n');
          return `    ${variant}: [
${arr}
    ],`;
        })
        .join('\n');
      return `  '${fieldId}': {
${variants}
  },`;
    })
    .join('\n');
  return `${header}${body}\n};\n`;
}

/** --list support: name, mesh-node count, world AABB of every group. */
export function listGroups(dir, mirror, cx, cy) {
  const { json, bin } = parseGlb(readFileSync(glbPath(dir)));
  const toWorld = makeNativeToWorld(mirror, cx, cy);
  const world = worldMatrices(json);
  const rows = [];
  for (const g of elementGroups(json)) {
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    let meshNodes = 0;
    for (const ni of g.nodeIndices) {
      const node = json.nodes[ni];
      if (node.mesh === undefined) continue;
      meshNodes++;
      const m = world[ni];
      for (const prim of json.meshes[node.mesh].primitives) {
        for (const v of accessorVertices(json, bin, prim.attributes.POSITION)) {
          const p = [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2] + m[i][3]);
          const w = toWorld(p);
          lo = [Math.min(lo[0], w.x), Math.min(lo[1], w.y), Math.min(lo[2], w.height)];
          hi = [Math.max(hi[0], w.x), Math.max(hi[1], w.y), Math.max(hi[2], w.height)];
        }
      }
    }
    rows.push({ name: g.name, meshNodes, aabb: { lo: lo.map((v) => round4(v)), hi: hi.map((v) => round4(v)) } });
  }
  return rows;
}

export { DATA_OUT };
