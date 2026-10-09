import { describe, expect, it } from 'vitest';
import {
  checkSequenceJoins,
  checkSequenceTiming,
  deserializeSession,
  detectCollisions,
  hasEmptyArrangement,
  makeSession,
  resolveSequence,
  routeConnectsAfter,
  samplePoseAt,
  sampleSequenceState,
  sampleStateAt,
  sequenceEventTimes,
  serializeSession,
  sessionDuration,
  activeEndT,
  activeStartT,
  type SessionTrajectory,
  type SequenceJoinIssue,
  type Trajectory,
} from '../src';

/** A straight drive along +x, 0→2 m over `durationS` seconds, at rest on both ends. */
function route(overrides: Partial<Trajectory> = {}): Trajectory {
  const durationS = overrides.durationS ?? 2;
  return {
    id: 'route',
    name: 'route',
    teamName: 'Team',
    teamNumber: '0000',
    source: 'ghostauto',
    alliance: 'blue',
    samples: [
      { t: 0, x: 0, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      { t: durationS, x: 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
    ],
    durationS,
    geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 },
    geometrySource: 'file',
    moduleLocations: [],
    events: [],
    warnings: [],
    ...overrides,
  };
}

function robotWithSequence(segments: Parameters<typeof makeSequence>[0]): SessionTrajectory {
  const options = segments.map((s, i) => ({
    id: s.routeId,
    relPath: `team/${s.routeId}.ghostauto`,
    trajectory: s.trajectory,
  }));
  const st = makeSession(segments[0]!.trajectory);
  st.routeId = segments[0]!.routeId;
  st.routeOptions = options;
  st.sequence = { segments: segments.map((s) => ({ id: s.id, routeId: s.routeId, waitBeforeS: s.waitBeforeS, ...(s.playS !== undefined ? { playS: s.playS } : {}) })) };
  st.startDelayS = segments[0]!.waitBeforeS;
  return st;
}

function makeSequence(segments: { id: string; routeId: string; waitBeforeS: number; playS?: number; trajectory: Trajectory }[]) {
  return segments;
}

describe('resolveSequence', () => {
  it('places segments on the global clock with waits', () => {
    const st = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 1, trajectory: route({ id: 'a', durationS: 2 }) },
      { id: 's2', routeId: 'b', waitBeforeS: 0.5, trajectory: route({ id: 'b', durationS: 3 }) },
      { id: 's3', routeId: 'c', waitBeforeS: 0, trajectory: route({ id: 'c', durationS: 1 }) },
    ]));
    const resolved = resolveSequence(st)!;
    expect(resolved.map((s) => [s.startS, s.endS])).toEqual([[1, 3], [3.5, 6.5], [6.5, 7.5]]);
    expect(activeStartT(st)).toBe(1);
    expect(activeEndT(st)).toBe(7.5);
    expect(sessionDuration([st])).toBe(7.5);
  });

  it('clamps negative and non-finite waits to zero', () => {
    const st = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: -2, trajectory: route({ id: 'a', durationS: 2 }) },
      { id: 's2', routeId: 'b', waitBeforeS: Number.NaN, trajectory: route({ id: 'b', durationS: 2 }) },
    ]));
    const resolved = resolveSequence(st)!;
    expect(resolved.map((s) => s.startS)).toEqual([0, 2]);
  });

  it('falls back to the slot trajectory for dangling route ids', () => {
    const a = route({ id: 'a', durationS: 2 });
    const st = makeSession(a);
    st.routeId = 'a';
    st.routeOptions = [{ id: 'a', relPath: 'team/a.ghostauto', trajectory: a }];
    st.sequence = { segments: [{ id: 's1', routeId: 'a', waitBeforeS: 0 }, { id: 's2', routeId: 'missing', waitBeforeS: 0 }] };
    const resolved = resolveSequence(st)!;
    expect(resolved[0]!.trajectory).toBe(a);
    expect(resolved[1]!.trajectory).toBe(st.trajectory);
  });

  it('distinguishes legacy robots from explicitly empty sequences', () => {
    expect(resolveSequence(makeSession(route()))).toBeUndefined();
    const st = makeSession(route());
    st.sequence = { segments: [] };
    expect(resolveSequence(st)).toEqual([]);
  });
});

describe('sampleSequenceState', () => {
  const st = robotWithSequence(makeSequence([
    { id: 's1', routeId: 'a', waitBeforeS: 1, trajectory: route({ id: 'a', durationS: 2 }) },
    { id: 's2', routeId: 'b', waitBeforeS: 1, trajectory: route({ id: 'b', durationS: 2, samples: [
      { t: 0, x: 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      { t: 2, x: 2, y: 3, heading: Math.PI / 2, vx: 0, vy: 0, omega: 0 },
    ] }) },
  ]));
  // Global layout: delay [0,1), seg A [1,3), wait [3,4), seg B [4,6), done.

  it('parks at the first pose with zero velocity during the start delay', () => {
    const s = sampleSequenceState(st, 0.5)!;
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.omega).toBe(0);
    expect(s.t).toBe(0.5);
  });

  it('interpolates inside a segment on the global clock', () => {
    const s = sampleSequenceState(st, 2)!;
    expect(s.x).toBeCloseTo(1, 9);
    expect(samplePoseAt(st, 2).x).toBeCloseTo(1, 9);
  });

  it('parks at the previous segment end during a wait, never interpolating across the gap', () => {
    const s = sampleSequenceState(st, 3.5)!;
    expect(s.x).toBe(2);
    expect(s.y).toBe(0);
    expect(s.heading).toBe(0);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
  });

  it('parks at the final pose after the auto ends', () => {
    const s = sampleSequenceState(st, 9)!;
    expect(s.x).toBeCloseTo(2, 9);
    expect(s.y).toBeCloseTo(3, 9);
    expect(s.vx).toBe(0);
  });

  it('hands over instantly with a zero wait', () => {
    const immediate = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 0, trajectory: route({ id: 'a', durationS: 2 }) },
      { id: 's2', routeId: 'b', waitBeforeS: 0, trajectory: route({ id: 'b', durationS: 2, samples: [
        { t: 0, x: 2, y: 0, heading: 0, vx: 1, vy: 0, omega: 0 },
        { t: 2, x: 4, y: 0, heading: 0, vx: 1, vy: 0, omega: 0 },
      ] }) },
    ]));
    const s = sampleSequenceState(immediate, 2)!;
    expect(s.x).toBe(2);
    expect(s.vx).toBe(1);
  });

  it('sampleStateAt keeps legacy sampling for robots without a sequence', () => {
    const legacy = makeSession(route());
    legacy.startDelayS = 0.5;
    expect(sampleStateAt(legacy, 1.5)!.x).toBeCloseTo(1, 9);
    expect(sampleStateAt(legacy, 9)!.x).toBe(2);
    expect(activeEndT(legacy)).toBe(2.5);
  });
});

describe('checkSequenceJoins', () => {
  it('reports nothing for a continuous seam (matching pose, both at rest)', () => {
    const st = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 0, trajectory: route({ id: 'a', durationS: 2 }) },
      { id: 's2', routeId: 'b', waitBeforeS: 0, trajectory: route({ id: 'b', durationS: 2, samples: [
        { t: 0, x: 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
        { t: 2, x: 3, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      ] }) },
    ]));
    expect(checkSequenceJoins(st)).toEqual([]);
  });

  it('reports nothing when a seam continues mid-motion with matching pose and speed', () => {
    const st = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 0, trajectory: route({ id: 'a', durationS: 2, samples: [
        { t: 0, x: 0, y: 0, heading: 0, vx: 1, vy: 0, omega: 0 },
        { t: 2, x: 2, y: 0, heading: 0, vx: 1, vy: 0, omega: 0 },
      ] }) },
      { id: 's2', routeId: 'b', waitBeforeS: 0, trajectory: route({ id: 'b', durationS: 2, samples: [
        { t: 0, x: 2, y: 0, heading: 0, vx: 1, vy: 0, omega: 0 },
        { t: 2, x: 4, y: 0, heading: 0, vx: 1, vy: 0, omega: 0 },
      ] }) },
    ]));
    expect(checkSequenceJoins(st)).toEqual([]);
  });

  it('measures position, heading and velocity mismatches with their seam times', () => {
    const st = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 0, trajectory: route({ id: 'a', durationS: 2, samples: [
        { t: 0, x: 0, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
        { t: 2, x: 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      ] }) },
      { id: 's2', routeId: 'b', waitBeforeS: 0.5, trajectory: route({ id: 'b', durationS: 2, samples: [
        { t: 0, x: 2.2, y: 0.3, heading: Math.PI / 4, vx: 0.5, vy: 0, omega: 0 },
        { t: 2, x: 4, y: 0.3, heading: Math.PI / 4, vx: 0.5, vy: 0, omega: 0 },
      ] }) },
    ]));
    const issues = checkSequenceJoins(st);
    expect(issues).toHaveLength(3);
    const byKind = Object.fromEntries(issues.map((i) => [i.kind, i])) as Record<SequenceJoinIssue['kind'], SequenceJoinIssue>;
    expect(byKind.position.delta).toBeCloseTo(Math.hypot(0.2, 0.3), 9);
    expect(byKind.heading.delta).toBeCloseTo(45, 9);
    expect(byKind.velocity.delta).toBeCloseTo(0.5, 9);
    expect(issues.every((i) => i.fromIndex === 0 && i.seamT === 2)).toBe(true);
  });

  it('reports nothing for robots without a sequence or with one segment', () => {
    expect(checkSequenceJoins(makeSession(route()))).toEqual([]);
    const single = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 0, trajectory: route() },
    ]));
    expect(checkSequenceJoins(single)).toEqual([]);
  });
});

/** A route whose first sample sits at (x, y) with `headingDeg`, at rest. */
function startingAt(x: number, y: number, headingDeg = 0, first: Partial<Trajectory['samples'][number]> = {}): Trajectory {
  const heading = headingDeg * Math.PI / 180;
  return route({ samples: [
    { t: 0, x, y, heading, vx: 0, vy: 0, omega: 0, ...first },
    { t: 2, x: x + 2, y, heading, vx: 0, vy: 0, omega: 0 },
  ] });
}

describe('routeConnectsAfter', () => {
  it('connects a route that starts exactly where the previous one ends', () => {
    // route() ends at (2, 0) heading 0.
    expect(routeConnectsAfter(route(), startingAt(2, 0))).toEqual({ connects: true, positionGapM: 0, headingGapDeg: 0 });
  });

  it('accepts a position gap within the default 1 cm tolerance and measures it', () => {
    const check = routeConnectsAfter(route(), startingAt(2.008, -0.004));
    expect(check.connects).toBe(true);
    expect(check.positionGapM).toBeCloseTo(Math.hypot(0.008, 0.004), 9);
  });

  it('blocks on position and heading separately, reporting both measurements', () => {
    expect(routeConnectsAfter(route(), startingAt(3, 0))).toEqual({ connects: false, positionGapM: 1, headingGapDeg: 0 });
    expect(routeConnectsAfter(route(), startingAt(2, 0, 90))).toEqual({ connects: false, positionGapM: 0, headingGapDeg: 90 });
  });

  it('never gates on the speed jump — a wait parks the robot at rest', () => {
    const check = routeConnectsAfter(route(), startingAt(2, 0, 0, { vx: 5 }));
    expect(check.connects).toBe(true);
  });

  it('honours tolerance overrides', () => {
    expect(routeConnectsAfter(route(), startingAt(2.05, 0), { positionTolM: 0.1 }).connects).toBe(true);
    expect(routeConnectsAfter(route(), startingAt(2.05, 0), { positionTolM: 0.01 }).connects).toBe(false);
    expect(routeConnectsAfter(route(), startingAt(2, 0, 5), { headingTolDeg: 10 }).connects).toBe(true);
  });

  it('does not gate trajectories without samples', () => {
    expect(routeConnectsAfter(route({ samples: [] }), startingAt(2, 0)).connects).toBe(true);
    expect(routeConnectsAfter(route(), route({ samples: [] })).connects).toBe(true);
  });
});

describe('checkSequenceTiming', () => {
  it('flags a finish past the autonomous period', () => {
    const st = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 14, trajectory: route({ id: 'a', durationS: 2 }) },
    ]));
    expect(checkSequenceTiming(st, 15)).toEqual({ finishS: 16, autoPeriodS: 15 });
    expect(checkSequenceTiming(st, 20)).toBeUndefined();
    expect(checkSequenceTiming(makeSession(route()), 1)).toBeUndefined();
  });
});

describe('sequenceEventTimes', () => {
  it('maps events onto the global clock per segment and falls back to legacy', () => {
    const st = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 1, trajectory: route({ id: 'a', durationS: 2, events: [{ name: 'A1', t: 1 }] }) },
      { id: 's2', routeId: 'b', waitBeforeS: 0.5, trajectory: route({ id: 'b', durationS: 2, events: [{ name: 'B1', t: 0.5 }] }) },
    ]));
    expect(sequenceEventTimes(st)).toEqual([{ name: 'A1', t: 2 }, { name: 'B1', t: 4 }]);
    const legacy = makeSession(route({ events: [{ name: 'E', t: 1 }] }));
    legacy.startDelayS = 0.25;
    expect(sequenceEventTimes(legacy)).toEqual([{ name: 'E', t: 1.25 }]);
  });
});


describe('waiting robots occupy space (collision)', () => {
  it('detects overlap while a composed robot waits between segments', () => {
    // Robot A: drives to x=2, waits 3 s parked at x=2, then continues.
    const a = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a1', waitBeforeS: 0, trajectory: route({ id: 'a1', durationS: 1 }) },
      { id: 's2', routeId: 'a2', waitBeforeS: 3, trajectory: route({ id: 'a2', durationS: 1, samples: [
        { t: 0, x: 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
        { t: 1, x: 3, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      ] }) },
    ]));
    // Robot B: sits at x=2 the whole time (zero-length "path" parked).
    const b = makeSession(route({ durationS: 0, samples: [{ t: 0, x: 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 }] }));
    const collisions = detectCollisions([a, b], { stepS: 0.25 });
    expect(collisions.length).toBeGreaterThan(0);
    // The overlap window must include the wait (roughly t = 1..4).
    const widest = collisions.reduce((w, c) => (c.endT - c.startT > w.endT - w.startT ? c : w), collisions[0]!);
    expect(widest.startT).toBeLessThanOrEqual(1.1);
    expect(widest.endT).toBeGreaterThanOrEqual(3.9);
    // B's start delay overlaps A's driving too; the parked wait is inside.
    const duringWait = collisions.some((c) => c.startT <= 2 && c.endT >= 3.5);
    expect(duringWait).toBe(true);
  });
});

describe('session persistence', () => {
  it('round-trips a sequence with waits and route options', () => {
    const st = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 1.5, trajectory: route({ id: 'a', durationS: 2 }) },
      { id: 's2', routeId: 'b', waitBeforeS: 0.25, trajectory: route({ id: 'b', durationS: 3 }) },
    ]));
    const restored = deserializeSession(serializeSession([st], 'reefscape-2025')).robots[0]!;
    expect(restored.sequence?.segments).toEqual(st.sequence?.segments);
    expect(restored.startDelayS).toBe(1.5);
    expect(activeEndT(restored)).toBe(activeEndT(st));
    expect(samplePoseAt(restored, 4).x).toBeCloseTo(samplePoseAt(st, 4).x, 9);
  });

  it('opens legacy single-route sessions unchanged', () => {
    const legacy = makeSession(route());
    legacy.startDelayS = 0.75;
    const file = JSON.parse(serializeSession([legacy], 'reefscape-2025')) as { robots: Array<{ sequence?: unknown }> };
    expect(file.robots[0]!.sequence).toBeUndefined();
    const restored = deserializeSession(JSON.stringify(file)).robots[0]!;
    expect(restored.sequence).toBeUndefined();
    expect(restored.startDelayS).toBe(0.75);
  });

  it('self-heals numeric damage and rejects structural damage', () => {
    const st = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 1, trajectory: route() },
    ]));
    const text = serializeSession([st], 'reefscape-2025');
    const damaged = JSON.parse(text) as { robots: Array<{ sequence?: { segments: Array<Record<string, unknown>> } }> };
    damaged.robots[0]!.sequence!.segments[0]!.waitBeforeS = -3;
    const healed = deserializeSession(JSON.stringify(damaged)).robots[0]!;
    expect(healed.sequence!.segments[0]!.waitBeforeS).toBe(0);
    expect(healed.startDelayS).toBe(0);

    const broken = JSON.parse(text) as { robots: Array<{ sequence?: { segments: Array<Record<string, unknown>> } }> };
    broken.robots[0]!.sequence!.segments[0]!.routeId = 42;
    expect(() => deserializeSession(JSON.stringify(broken))).toThrow('invalid auto sequence');
  });

  it('preserves an empty sequence and keeps the robot usable', () => {
    const st = makeSession(route());
    st.sequence = { segments: [] };
    const restored = deserializeSession(serializeSession([st], 'reefscape-2025')).robots[0]!;
    expect(restored.sequence).toEqual({ segments: [] });
  });
});


describe('explicitly empty arrangements', () => {
  it('parks instead of replaying the old route and survives session roundtrip', () => {
    const robot = makeSession(route({ events: [{ name: 'score', t: 1 }] }));
    robot.sequence = { segments: [] };
    expect(resolveSequence(robot)).toEqual([]);
    expect(activeStartT(robot)).toBe(0);
    expect(activeEndT(robot)).toBe(0);
    expect(sampleStateAt(robot, 1)).toMatchObject({ x: 0, y: 0, vx: 0, vy: 0, omega: 0 });
    expect(sequenceEventTimes(robot)).toEqual([]);
    expect(checkSequenceTiming(robot, 15)).toBeUndefined();
    const restored = deserializeSession(serializeSession([robot], 'blue')).robots[0]!;
    expect(restored.sequence).toEqual({ segments: [] });
    expect(sampleStateAt(restored, 10)).toMatchObject({ x: 0, vx: 0 });
  });

  it('is recognizable as empty — legacy robots are not', () => {
    // The renderer and the collision check skip an empty arrangement (user
    // 2026-10-08: a removed robot must not sit on the field as a phantom).
    const robot = makeSession(route());
    expect(hasEmptyArrangement(robot)).toBe(false); // legacy: plays its route
    robot.sequence = { segments: [] };
    expect(hasEmptyArrangement(robot)).toBe(true);
    robot.sequence = { segments: [{ id: 's1', routeId: 'a', waitBeforeS: 0 }] };
    expect(hasEmptyArrangement(robot)).toBe(false);
  });
});

describe('partial execution (playS): a leg longer than the remaining auto plays as far as it can', () => {
  // 8-second drive 0→8 m; only the first 2 seconds fit the arrangement.
  const cut = () => {
    const st = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 0, trajectory: route({ id: 'a', durationS: 8, samples: [
        { t: 0, x: 0, y: 0, heading: 0, vx: 1, vy: 0, omega: 0 },
        { t: 8, x: 8, y: 0, heading: 0, vx: 1, vy: 0, omega: 0 },
      ] }) },
    ]));
    st.sequence!.segments[0]!.playS = 2;
    return st;
  };

  it('ends the segment at the cut and samples the route only that far', () => {
    const st = cut();
    expect(resolveSequence(st)![0]!.endS).toBe(2);
    expect(activeEndT(st)).toBe(2);
    expect(sessionDuration([st])).toBe(2);
    expect(sampleStateAt(st, 1)!.x).toBeCloseTo(1, 9);
  });

  it('parks at the cut pose with zero velocity once the allotment is spent', () => {
    const s = sampleStateAt(cut(), 5)!;
    expect(s.x).toBeCloseTo(2, 9);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
  });

  it('excludes events past the cut', () => {
    const st = cut();
    st.routeOptions![0]!.trajectory.events = [{ name: 'early', t: 1 }, { name: 'late', t: 5 }];
    expect(sequenceEventTimes(st)).toEqual([{ name: 'early', t: 1 }]);
  });

  it('grades a seam after the cut from the cut pose, not the route end', () => {
    const st = robotWithSequence(makeSequence([
      { id: 's1', routeId: 'a', waitBeforeS: 0, trajectory: route({ id: 'a', durationS: 8, samples: [
        { t: 0, x: 0, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
        { t: 8, x: 8, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      ] }) },
      { id: 's2', routeId: 'b', waitBeforeS: 0, trajectory: route({ id: 'b', durationS: 2, samples: [
        { t: 0, x: 3, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
        { t: 2, x: 4, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      ] }) },
    ]));
    st.sequence!.segments[0]!.playS = 2;
    const issues = checkSequenceJoins(st);
    expect(issues.some((issue) => issue.kind === 'position' && issue.delta === 1 && issue.seamT === 2)).toBe(true);
  });

  it('round-trips playS through the session file and heals damaged values', () => {
    const st = cut();
    const restored = deserializeSession(serializeSession([st], 'blue')).robots[0]!;
    expect(restored.sequence!.segments[0]!.playS).toBe(2);
    expect(activeEndT(restored)).toBe(2);
    const text = serializeSession([st], 'blue');
    const damaged = JSON.parse(text) as { robots: Array<{ sequence?: { segments: Array<Record<string, unknown>> } }> };
    damaged.robots[0]!.sequence!.segments[0]!.playS = Number.NaN;
    const healed = deserializeSession(JSON.stringify(damaged)).robots[0]!;
    expect(healed.sequence!.segments[0]!.playS).toBeUndefined();
    expect(activeEndT(healed)).toBe(8);
  });

  it('ignores playS that reaches or exceeds the route', () => {
    const st = cut();
    st.sequence!.segments[0]!.playS = 8;
    expect(resolveSequence(st)![0]!.endS).toBe(8);
    st.sequence!.segments[0]!.playS = 99;
    expect(resolveSequence(st)![0]!.endS).toBe(8);
  });
});
