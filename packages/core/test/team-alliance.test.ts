import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEOMETRY,
  REBUILT_2026,
  applyProfileToTrajectory,
  deserializeSession,
  detectCollisions,
  flipPoseToBlue,
  makeSession,
  parsePathFile,
  serializeSession,
  sessionStartsInZone,
  setTeamAlliance,
  displayAlliance,
  wrapAngle,
  type Alliance,
  type RobotProfile,
  type SessionTrajectory,
  type Trajectory,
} from '../src';

const FIELD = REBUILT_2026;

function traj(overrides: Partial<Trajectory> = {}): Trajectory {
  return {
    id: 't1', name: 'A', teamName: 'Team', teamNumber: '254', source: 'ghostauto', alliance: 'blue',
    samples: [
      { t: 0, x: 2, y: 1, heading: 0.5, vx: 1, vy: 0.5, omega: 0.25 },
      { t: 1, x: 3, y: 2, heading: -1, vx: 2, vy: -1, omega: -0.5 },
      { t: 2, x: 4, y: 3, heading: 3, vx: 0, vy: 0, omega: 0 },
    ],
    durationS: 2,
    geometry: DEFAULT_GEOMETRY,
    geometrySource: 'file',
    moduleLocations: [],
    events: [{ name: 'score', t: 1.5 }],
    warnings: [],
    ...overrides,
  };
}

describe('setTeamAlliance geometry (import-layer red normalization)', () => {
  it('places a red team on the opposite half with the official 180° symmetry, and stores blue-frame with a blue tag', () => {
    const robot = makeSession(traj());
    const red = setTeamAlliance(robot, 'red', FIELD);
    expect(red.teamAlliance).toBe('red');
    expect(red.trajectory.alliance).toBe('blue');
    for (const [i, s] of red.trajectory.samples.entries()) {
      const p = flipPoseToBlue({ x: traj().samples[i]!.x, y: traj().samples[i]!.y, heading: traj().samples[i]!.heading }, FIELD);
      expect(s.x).toBeCloseTo(p.x, 12);
      expect(s.y).toBeCloseTo(p.y, 12);
      expect(s.heading).toBeCloseTo(p.heading, 12);
      expect(s.vx).toBe(-traj().samples[i]!.vx);
      expect(s.vy).toBe(-traj().samples[i]!.vy);
      expect(s.omega).toBe(traj().samples[i]!.omega);
    }
  });

  it('is an involution: setting red then blue restores every sample (exact where IEEE is exact, ≤1 ulp elsewhere)', () => {
    const robot = makeSession(traj());
    const back = setTeamAlliance(setTeamAlliance(robot, 'red', FIELD), 'blue', FIELD);
    expect(back.teamAlliance).toBe('blue');
    for (const [i, s] of back.trajectory.samples.entries()) {
      const o = traj().samples[i]!;
      expect(s.t).toBe(o.t);
      expect(s.omega).toBe(o.omega);
      expect(s.vx).toBe(o.vx);
      expect(s.vy).toBe(o.vy);
      expect(s.x).toBeCloseTo(o.x, 9);
      expect(s.y).toBeCloseTo(o.y, 9);
      expect(s.heading).toBeCloseTo(o.heading, 9);
    }
  });

  it('setting the same effective alliance never flips geometry (undefined ≡ blue)', () => {
    const robot = makeSession(traj());
    const explicitBlue = setTeamAlliance(robot, 'blue', FIELD);
    expect(explicitBlue.teamAlliance).toBe('blue');
    expect(explicitBlue.trajectory.samples).toEqual(traj().samples);
    const idempotent = setTeamAlliance(setTeamAlliance(robot, 'red', FIELD), 'red', FIELD);
    expect(idempotent.trajectory.samples).toEqual(setTeamAlliance(robot, 'red', FIELD).trajectory.samples);
  });

  it('flips every route option with the slot, and later-correction works from a restored blue-frame source', () => {
    const other = traj({ id: 't2', name: 'B', samples: [{ t: 0, x: 1, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 }], durationS: 0 });
    const robot: SessionTrajectory = {
      ...makeSession(traj()),
      routeOptions: [
        { id: 'r1', relPath: 'team/A.ghostauto', trajectory: traj() },
        { id: 'r2', relPath: 'team/B.ghostauto', trajectory: other },
      ],
    };
    const red = setTeamAlliance(robot, 'red', FIELD);
    for (const option of red.routeOptions!) {
      const sourceX = option.id === 'r1' ? 2 : 1;
      expect(option.trajectory.samples[0]!.x).toBeCloseTo(FIELD.lengthM - sourceX, 12);
    }
    // Correction from the restored shape (blue frame, flag red) back to blue moves the route home exactly once.
    const blue = setTeamAlliance(red, 'blue', FIELD);
    for (const [i, s] of blue.routeOptions![0]!.trajectory.samples.entries()) {
      const o = traj().samples[i]!;
      expect(s.x).toBeCloseTo(o.x, 9);
      expect(s.y).toBeCloseTo(o.y, 9);
      expect(s.heading).toBeCloseTo(o.heading, 9);
    }
  });
});

describe('setTeamAlliance on authored geometry (editable / regenFrom / original)', () => {
  const pathText = readFileSync(resolve(__dirname, '../../../samples/pathplanner/Score.path'), 'utf8');
  const parsed = () => parsePathFile(pathText, 'Score.path');

  it('flips PathPlanner waypoints, rotation targets, point-towards positions and end-state rotations', () => {
    const robot = makeSession(parsed());
    const red = setTeamAlliance(robot, 'red', FIELD);
    const editable = red.trajectory.editable;
    expect(editable?.kind).toBe('pathplanner');
    if (editable?.kind !== 'pathplanner') return;
    const source = parsed().editable;
    if (source?.kind !== 'pathplanner') return;
    for (const [i, w] of editable.path.waypoints.entries()) {
      expect(w.anchor.x).toBeCloseTo(FIELD.lengthM - source.path.waypoints[i]!.anchor.x, 12);
      expect(w.anchor.y).toBeCloseTo(FIELD.widthM - source.path.waypoints[i]!.anchor.y, 12);
      const srcPrev = source.path.waypoints[i]!.prevControl;
      if (srcPrev) expect(w.prevControl?.x).toBeCloseTo(FIELD.lengthM - srcPrev.x, 12);
      else expect(w.prevControl).toBeNull();
    }
    for (const [i, r] of editable.path.rotationTargets.entries()) {
      expect(r.rotationRad).toBeCloseTo(wrapAngle(source.path.rotationTargets[i]!.rotationRad + Math.PI), 9);
      expect(r.waypointRelativePos).toBe(source.path.rotationTargets[i]!.waypointRelativePos);
    }
    expect(editable.path.goalEndState.rotationRad).toBeCloseTo(wrapAngle(source.path.goalEndState.rotationRad + Math.PI), 9);
    expect(editable.path.idealStartingState.rotationRad).toBeCloseTo(wrapAngle(source.path.idealStartingState.rotationRad + Math.PI), 9);
    for (const [i, z] of editable.path.pointTowardsZones.entries()) {
      expect(z.fieldPosition.x).toBeCloseTo(FIELD.lengthM - source.path.pointTowardsZones[i]!.fieldPosition.x, 12);
      expect(z.rotationOffsetRad).toBe(source.path.pointTowardsZones[i]!.rotationOffsetRad);
    }
  });

  it('keeps a re-applied profile regenerating the red placement — editable flips with the slot', () => {
    const profile: RobotProfile = {
      name: 'P', geometry: DEFAULT_GEOMETRY, moduleLocations: [],
      massKG: 60, holonomic: true,
      dynamics: { maxDriveVelocityMPS: 4 },
    };
    // The real regeneration seam (profile-apply) regenerates from `editable`;
    // `regenFrom` is carried flipped too (kept for future wiring).
    const applied = applyProfileToTrajectory(parsed(), profile);
    expect(applied.samples.length).toBeGreaterThan(1);
    const red = setTeamAlliance(makeSession(applied), 'red', FIELD);
    // The slot flip rotated the regenerated samples by the field's 180° symmetry.
    for (const [i, s] of red.trajectory.samples.entries()) {
      const src = applied.samples[i]!;
      expect(s.x).toBeCloseTo(FIELD.lengthM - src.x, 12);
      expect(s.y).toBeCloseTo(FIELD.widthM - src.y, 12);
    }
    // Re-applying a profile to the red team regenerates through the FLIPPED
    // editable — the red placement survives, never jumping back to the blue half.
    const reapplied = applyProfileToTrajectory(red.trajectory, profile);
    expect(reapplied.samples.length).toBe(red.trajectory.samples.length);
    for (const [i, s] of reapplied.samples.entries()) {
      const src = red.trajectory.samples[i]!;
      expect(s.x).toBeCloseTo(src.x, 4);
      expect(s.y).toBeCloseTo(src.y, 4);
    }
  });

  it('flips a regenFrom payload when one is present', () => {
    const sourcePath = parsed().editable;
    if (sourcePath?.kind !== 'pathplanner') throw new Error('expected pathplanner editable');
    const withRegen: Trajectory = { ...parsed(), regenFrom: { kind: 'pathplanner-path', path: sourcePath.path } };
    const red = setTeamAlliance(makeSession(withRegen), 'red', FIELD);
    expect(red.trajectory.regenFrom?.path.waypoints[0]!.anchor.x).toBeCloseTo(FIELD.lengthM - sourcePath.path.waypoints[0]!.anchor.x, 12);
  });

  it('flips an original (pre-edit) snapshot coherently', () => {
    const withSnapshot: Trajectory = {
      ...parsed(),
      edited: true,
      original: {
        editable: parsed().editable!,
        samples: traj().samples,
        events: [], warnings: [], durationS: 2,
      },
    };
    const red = setTeamAlliance(makeSession(withSnapshot), 'red', FIELD);
    expect(red.trajectory.original?.samples[0]!.x).toBeCloseTo(FIELD.lengthM - 2, 12);
    expect(red.trajectory.original?.editable?.kind).toBe('pathplanner');
  });
});

describe('session file round trip', () => {
  it('persists the flag and reads legacy files as unset', () => {
    const robot = setTeamAlliance(makeSession(traj()), 'red', FIELD);
    const restored = deserializeSession(serializeSession([robot], FIELD.id)).robots[0]!;
    expect(restored.teamAlliance).toBe('red');
    expect(restored.trajectory.samples[0]!.x).toBeCloseTo(FIELD.lengthM - 2, 12);
    const legacy = deserializeSession(serializeSession([makeSession(traj())], FIELD.id)).robots[0]!;
    expect(legacy.teamAlliance).toBeUndefined();
  });

  it('self-heals an invalid flag value instead of rejecting the session', () => {
    const robot = setTeamAlliance(makeSession(traj()), 'red', FIELD);
    const raw = serializeSession([robot], FIELD.id).replace('"teamAlliance": "red"', '"teamAlliance": "cyan"');
    const restored = deserializeSession(raw).robots[0]!;
    expect(restored.teamAlliance).toBeUndefined();
  });
});

describe('collision pair relation', () => {
  function robot(id: string, x: number, teamAlliance?: Alliance): SessionTrajectory {
    const base = traj({ id, samples: [{ t: 0, x, y: 5, heading: 0, vx: 0, vy: 0, omega: 0 }], durationS: 1 });
    return { ...makeSession(base), teamAlliance };
  }
  const overlap = { stepS: 0.5 };

  it('classifies same-team pairs as teammates and cross-team pairs as opponents', () => {
    const teammates = detectCollisions([robot('a', 2), robot('b', 2.05)], overlap);
    expect(teammates).toHaveLength(1);
    expect(teammates[0]!.relation).toBe('teammates');
    const opponents = detectCollisions([robot('a', 2, 'blue'), robot('b', 2.05, 'red')], overlap);
    expect(opponents[0]!.relation).toBe('opponents');
  });

  it('defaults unset flags to the blue team so legacy sessions read as teammates', () => {
    const hits = detectCollisions([robot('a', 2), robot('b', 2.05, 'blue')], overlap);
    expect(hits[0]!.relation).toBe('teammates');
  });
});

describe('start-zone judging for teams', () => {
  it('accepts a red team starting on the red wall and gates one starting on the blue wall', () => {
    const zone = FIELD.startZone!;
    const blueStart = (zone[0]!.xMinM + zone[0]!.xMaxM) / 2;
    const redTeam = setTeamAlliance(
      makeSession(traj({
        samples: [{ t: 0, x: blueStart, y: (zone[0]!.yMinM + zone[0]!.yMaxM) / 2, heading: 0, vx: 0, vy: 0, omega: 0 }],
        durationS: 1,
      })),
      'red',
      FIELD,
    );
    // The flip placed the route on the red half; judged as a red team it starts legally.
    expect(redTeam.trajectory.samples[0]!.x).toBeGreaterThan(FIELD.lengthM / 2);
    expect(sessionStartsInZone(redTeam, zone, FIELD)).toBe(true);
    // A red team whose route still sits on the blue half (never flipped) is gated.
    const misplaced = { ...makeSession(traj({
      samples: [{ t: 0, x: blueStart, y: (zone[0]!.yMinM + zone[0]!.yMaxM) / 2, heading: 0, vx: 0, vy: 0, omega: 0 }],
      durationS: 1,
    })), teamAlliance: 'red' as Alliance };
    expect(sessionStartsInZone(misplaced, zone, FIELD)).toBe(false);
  });

  it('keeps blue teams on today’s verdict', () => {
    const zone = FIELD.startZone!;
    const blueStart = (zone[0]!.xMinM + zone[0]!.xMaxM) / 2;
    const robot = makeSession(traj({
      samples: [{ t: 0, x: blueStart, y: (zone[0]!.yMinM + zone[0]!.yMaxM) / 2, heading: 0, vx: 0, vy: 0, omega: 0 }],
      durationS: 1,
    }));
    expect(sessionStartsInZone(robot, zone, FIELD)).toBe(true);
    expect(sessionStartsInZone({ ...robot, teamAlliance: 'blue' }, zone, FIELD)).toBe(true);
  });
});

describe('displayAlliance', () => {
  it('prefers the team flag and falls back to the frame tag for unset slots', () => {
    expect(displayAlliance({ ...makeSession(traj()), teamAlliance: 'red' })).toBe('red');
    expect(displayAlliance({ ...makeSession(traj()), teamAlliance: 'blue' })).toBe('blue');
    expect(displayAlliance({ ...makeSession(traj({ alliance: 'red' })) })).toBe('red');
    expect(displayAlliance(makeSession(traj()))).toBe('blue');
  });
});
