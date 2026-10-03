import {
  makeSession,
  parseGhostAuto,
  REBUILT_2026,
  type SessionTrajectory,
} from '@pathblender/core';
// Field-agnostic by construction: both routes cross at their own computed
// centre (±1.5 m), safely inside every bundled season field. The caller
// decides which field/variant to show it on — first run defaults to
// AndyMark, then the remembered choice (see App's field pref).

// Matches REBUILT_2026.autoPeriodS (20 s), so the first-run ruler is filled
// by the demo end to end.
const DURATION_S = 20;
const SAMPLE_COUNT = 401;
const HALF_ROUTE_M = 1.5;
const BUMPER_M = 0.8;

/**
 * Fictional local teaching data, not a team's competition auto. Both robots
 * cross the neutral-zone centre at half the run (ten seconds). Coordinates
 * derive from the bundled field dimensions; the short routes stay between
 * the fixed hubs. The bumper size is an explicit property of these
 * fictional robots.
 */
export function createWelcomeExample(names: { a: string; b: string }): {
  robots: SessionTrajectory[];
} {
  const centreX = REBUILT_2026.lengthM / 2;
  const centreY = REBUILT_2026.widthM / 2;
  const robots = ([names.a, names.b] as const).map((name, index) => {
    const vertical = index === 1;
    const states = Array.from({ length: SAMPLE_COUNT }, (_, sampleIndex) => {
      const u = sampleIndex / (SAMPLE_COUNT - 1);
      // Smooth start/stop, with velocity matching the derivative of position.
      const progress = u * u * (3 - 2 * u);
      const offset = (2 * progress - 1) * HALF_ROUTE_M;
      const speed = 2 * HALF_ROUTE_M * 6 * u * (1 - u) / DURATION_S;
      return {
        t: u * DURATION_S,
        x: centreX + (vertical ? 0 : offset),
        y: centreY + (vertical ? offset : 0),
        rotation: vertical ? Math.PI / 2 : 0,
        vx: vertical ? 0 : speed,
        vy: vertical ? speed : 0,
        omega: 0,
      };
    });
    // Use the normal core import boundary, including geometry validation.
    // Every call parses fresh objects, so edits never alter a future example.
    // Names and bumper numbers are plain team numbers (user request
    // 2026-10-03: the demo reads as two real robots, not "示例路径 A/B").
    const trajectory = parseGhostAuto(JSON.stringify({
      version: '1.0',
      name,
      teamName: '',
      bumperSize: { width: BUMPER_M, height: BUMPER_M },
      bumperOffset: { x: 0, y: 0 },
      holonomic: true,
      moduleLocations: [],
      states,
    }), `welcome-example-${index === 0 ? 'a' : 'b'}.ghostauto`);
    trajectory.id = `welcome-example-${index === 0 ? 'a' : 'b'}`;
    trajectory.teamNumber = index === 0 ? '00001' : '00002';
    return makeSession(trajectory, index);
  });

  return { robots };
}
