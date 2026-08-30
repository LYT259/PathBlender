/**
 * Phase 2: PathPlanner .path parsing + trajectory generation tests.
 * Samples: real Pickup.path / Score.path from the PathPlanner repo examples.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generatePathPoints,
  generateTrajectory,
  makeRobotConfig,
  parsePathFile,
  parsePathJson,
  parsePathPlannerAuto,
  samplePath,
  ParseError,
} from '../src';

const SAMPLES = resolve(__dirname, '../../../samples');
const read = (rel: string): string =>
  readFileSync(resolve(SAMPLES, rel), 'utf-8');

const pickup = parsePathJson(read('pathplanner/Pickup.path'), 'Pickup.path');
const score = parsePathJson(read('pathplanner/Score.path'), 'Score.path');
const config = makeRobotConfig();

describe('.path parsing', () => {
  it('reads waypoints, constraints, end state', () => {
    expect(pickup.waypoints).toHaveLength(2);
    expect(pickup.waypoints[0]!.prevControl).toBeNull();
    expect(pickup.waypoints[0]!.nextControl).not.toBeNull();
    expect(pickup.globalConstraints.maxVelocityMPS).toBeCloseTo(3.0, 6);
    expect(pickup.globalConstraints.maxAngularVelocityRadPS).toBeCloseTo((540 * Math.PI) / 180, 6);
    expect(pickup.goalEndState.velocityMPS).toBe(0);
    expect(pickup.reversed).toBe(false);
    expect(pickup.eventMarkers[0]!.name).toBe('Example Marker');
  });
});

describe('path discretization', () => {
  const points = generatePathPoints(pickup);

  it('produces points along the bezier between the anchors', () => {
    expect(points.length).toBeGreaterThan(10);
    const first = points[0]!;
    const last = points[points.length - 1]!;
    expect(first.position.x).toBeCloseTo(pickup.waypoints[0]!.anchor.x, 3);
    expect(first.position.y).toBeCloseTo(pickup.waypoints[0]!.anchor.y, 3);
    expect(last.position.x).toBeCloseTo(pickup.waypoints[1]!.anchor.x, 3);
    expect(last.position.y).toBeCloseTo(pickup.waypoints[1]!.anchor.y, 3);
  });

  it('accumulates distance monotonically', () => {
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.distanceAlongPath).toBeGreaterThanOrEqual(
        points[i - 1]!.distanceAlongPath,
      );
    }
    // Pickup.path spans roughly from (1.43, 1.88) to (7.73, 0.81) — at least 6 m.
    expect(points[points.length - 1]!.distanceAlongPath).toBeGreaterThan(5.5);
    // Spacing targeted at 0.2 m.
    const spacings = points.slice(1).map((p, i) => p.distanceAlongPath - points[i]!.distanceAlongPath);
    const maxSpacing = Math.max(...spacings);
    expect(maxSpacing).toBeLessThan(0.3);
  });

  it('samples the bezier continuously (samplePath)', () => {
    const a = samplePath(pickup, 0);
    const mid = samplePath(pickup, 0.5);
    const b = samplePath(pickup, 1);
    expect(a.x).toBeCloseTo(1.4267, 3);
    expect(b.x).toBeCloseTo(7.7269, 3);
    // Midpoint of a mostly-straight bezier stays between the ends.
    expect(mid.x).toBeGreaterThan(a.x);
    expect(mid.x).toBeLessThan(b.x);
  });
});

describe('trajectory generation (forward+reverse passes)', () => {
  it('generates a physically sane trajectory for Pickup.path', () => {
    const t = generateTrajectory(pickup, config);
    const s = t.samples;

    expect(s.length).toBeGreaterThan(20);
    expect(s[0]!.t).toBe(0);
    expect(t.totalTimeS).toBeGreaterThan(1.5);
    expect(t.totalTimeS).toBeLessThan(30); // ~6.3 m at ≤3 m/s + accel → sanity window

    // Time strictly non-decreasing.
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.t).toBeGreaterThanOrEqual(s[i - 1]!.t);
    }

    // End where the path ends, at rest (goal end velocity 0).
    const last = s[s.length - 1]!;
    expect(last.x).toBeCloseTo(7.7269, 2);
    expect(last.y).toBeCloseTo(0.8077, 2);
    expect(Math.hypot(last.vx, last.vy)).toBeLessThan(0.05);

    // Start at rest (ideal start velocity 0).
    expect(Math.hypot(s[0]!.vx, s[0]!.vy)).toBeLessThan(0.05);

    // Velocities never exceed the global constraint (3.0 m/s) materially.
    for (const st of s) {
      expect(Math.hypot(st.vx, st.vy)).toBeLessThan(3.0 + 0.1);
    }

    // Positions stay near the path (every sample within 5 cm of some path point).
    const points = generatePathPoints(pickup);
    for (const st of s) {
      const near = points.some(
        (p) => Math.hypot(p.position.x - st.x, p.position.y - st.y) < 0.05,
      );
      if (!near) {
        throw new Error(`sample at t=${st.t} off-path: (${st.x}, ${st.y})`);
      }
    }
  });

  it('handles Score.path too, with its marker timing', () => {
    const t = generateTrajectory(score, config);
    expect(t.totalTimeS).toBeGreaterThan(1);
    expect(t.events.length).toBeGreaterThan(0);
    for (const e of t.events) {
      expect(e.t).toBeGreaterThanOrEqual(0);
      expect(e.t).toBeLessThanOrEqual(t.totalTimeS + 1e-9);
    }
  });

  it('faster constraint yields a shorter-or-equal run time', () => {
    const slow = generateTrajectory(pickup, config).totalTimeS;
    const fast = generateTrajectory(
      {
        ...pickup,
        globalConstraints: {
          ...pickup.globalConstraints,
          maxVelocityMPS: 10,
          maxAccelerationMPSSq: 10,
        },
      },
      config,
    ).totalTimeS;
    expect(fast).toBeLessThanOrEqual(slow + 1e-6);
  });
});

describe('parsePathFile integration', () => {
  it('imports .path into the unified model with warnings', () => {
    const traj = parsePathFile(read('pathplanner/Pickup.path'), 'Pickup.path');
    expect(traj.source).toBe('pathplanner-path');
    expect(traj.durationS).toBeGreaterThan(1.5);
    expect(traj.samples[0]!.x).toBeCloseTo(1.4267, 3);
    expect(traj.warnings.some((w) => w.includes('default robot config'))).toBe(true);
    expect(traj.events.length).toBeGreaterThan(0);
  });

  it('degrades pre-2025 .path files with explicit warnings, applying isReversed', () => {
    const text = read('pathplanner/legacy_reversed.path');
    const parsed = parsePathJson(text, 'legacy_reversed.path');
    expect(parsed.parseWarnings.some((w) => w.includes('format version "2024.0"'))).toBe(true);
    expect(
      parsed.parseWarnings.some((w) => w.includes('legacy "constraints" list (2 entries)')),
    ).toBe(true);
    expect(parsed.parseWarnings.some((w) => w.includes('"isReversed" flag applied'))).toBe(true);
    // The legacy flag maps onto the model field…
    expect(parsed.reversed).toBe(true);

    const traj = parsePathFile(text, 'legacy_reversed.path');
    expect(traj.samples.length).toBeGreaterThan(2);
    expect(traj.warnings.some((w) => w.includes('legacy "constraints" list'))).toBe(true);

    // …and actually flips the pose heading on differential trains (swerve
    // heading comes from rotation targets, matching PathPlannerLib).
    const tank = makeRobotConfig({ holonomic: false });
    const fwd = generateTrajectory(
      { ...parsed, reversed: false },
      tank,
    );
    const back = generateTrajectory(parsed, tank);
    const dh = back.samples[10]!.heading - fwd.samples[10]!.heading;
    expect(Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh)))).toBeCloseTo(Math.PI, 5);
  });

  it('applies constraint-zone speed limits and pointTowards headings', () => {
    const text = read('pathplanner/constrained_pointing.path');
    const traj = parsePathFile(text, 'constrained_pointing.path');
    expect(traj.samples.length).toBeGreaterThan(10);

    // The 0.1–0.9 zone caps velocity at 1 m/s along the path length. The
    // sample spans x≈1.43→7.73, so assert on samples clearly inside the
    // zone's physical span (with margin for the unconstrained ends).
    const xs = traj.samples.map((s) => s.x);
    const capped = traj.samples.filter(
      (s) => s.x > Math.min(...xs) + 0.8 && s.x < Math.max(...xs) - 0.8,
    );
    for (const s of capped) {
      expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(1.0 + 1e-6);
    }

    // pointTowards the (0, 5.5) goal: headings must aim there between the
    // file-specified endpoints (first sample keeps idealStartingState
    // rotation, last sample keeps goalEndState rotation).
    for (const s of traj.samples.slice(1, -1)) {
      const want = Math.atan2(5.5 - s.y, 0.0 - s.x);
      const d = s.heading - want;
      expect(Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))).toBeLessThan(0.02);
    }
  });

  it('propagates .path parse warnings into .auto routines referencing them', () => {
    const traj = parsePathPlannerAuto(
      read('pathplanner/Example Auto.auto'),
      'Example Auto.auto',
      (name) =>
        name === 'Pickup'
          ? read('pathplanner/legacy_reversed.path').replace('"Legacy Reversed"', '"Pickup"')
          : name === 'Score'
            ? read('pathplanner/Score.path')
            : undefined,
    );
    expect(traj.warnings.some((w) => w.includes('legacy "constraints" list'))).toBe(true);
  });
});

describe('.auto routine semantics', () => {
  const pickupText = read('pathplanner/Pickup.path');
  const scoreText = read('pathplanner/Score.path');
  const autoText = read('pathplanner/Example Auto.auto');

  it('chains Pickup → 1s wait → 1s wait → Score with events', () => {
    const traj = parsePathFile(autoText, 'Example Auto.auto', (name) =>
      name === 'Pickup' ? pickupText : name === 'Score' ? scoreText : undefined,
    );
    expect(traj.source).toBe('pathplanner-auto');
    // Pickup ≈ 3.14 s + two 1 s waits + Score; named commands count 0 s.
    expect(traj.durationS).toBeGreaterThan(3.14 + 2);
    expect(traj.durationS).toBeLessThan(3.14 + 2 + 4.5); // Score ≈ 4.1 s

    // The robot parks during each wait (constant position across it).
    const s = traj.samples;
    const idxAt = (t: number) => {
      let lo = 1;
      let hi = s.length - 1;
      while (lo !== hi) {
        const mid = Math.floor((lo + hi) / 2);
        if ((s[mid] as typeof s[number]).t < t) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const a = s[idxAt(3.5)] as typeof s[number];
    const b = s[idxAt(4.0)] as typeof s[number];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.02);

    // 'print hello' named command fires at the end of the first wait.
    const named = traj.events.find((e) => e.name === 'print hello');
    expect(named).toBeDefined();
    expect(named!.t).toBeGreaterThan(4.0);
    expect(named!.t).toBeLessThan(4.4);

    expect(traj.warnings.some((w) => w.includes('named commands'))).toBe(true);
  });

  it('fails with guidance when a referenced path is not provided', () => {
    try {
      parsePathFile(autoText, 'Example Auto.auto', () => undefined);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).message).toMatch(/Pickup/);
    }
  });

  it('score path loads standalone too', () => {
    const traj = parsePathFile(scoreText, 'Score.path');
    expect(traj.source).toBe('pathplanner-path');
    expect(traj.durationS).toBeGreaterThan(1);
  });
});
