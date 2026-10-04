import { describe, expect, it } from 'vitest';
import { makeSession, DEFAULT_GEOMETRY, type Trajectory } from '@pathblender/core';
import { nextTeamPlaceholder, withTeamPlaceholders } from '../src/team-placeholder';
const robot = (teamNumber: string, id = crypto.randomUUID()) => makeSession({
  id, teamNumber, name: 'L1', teamName: '', source: 'choreo-traj', alliance: 'blue',
  samples: [], durationS: 0, geometry: DEFAULT_GEOMETRY, geometrySource: 'default',
  moduleLocations: [], events: [], warnings: [],
} satisfies Trajectory);
describe('unknown team identities', () => {
  it('allocates different six-letter identities without changing imported or edited numbers', () => {
    const source = [robot('254'), robot('AAAAAA'), robot(''), robot(''), robot('00001')];
    expect(withTeamPlaceholders(source).map((r) => r.trajectory.teamNumber)).toEqual(['254', 'AAAAAA', 'BBBBBB', 'CCCCCC', '00001']);
    expect(source[2]!.trajectory.teamNumber).toBe('');
  });
  it('migrates only legacy demonstration numbers', () => {
    const result = withTeamPlaceholders([robot('00001', 'welcome-example-a'), robot('00002', 'welcome-example-b'), robot('00002')]);
    expect(result.map((r) => r.trajectory.teamNumber)).toEqual(['AAAAAA', 'BBBBBB', '00002']);
  });
  it('continues with distinct six-letter placeholders after the alphabet is exhausted', () => {
    const used = new Set<string>();
    for (let i = 0; i < 100; i++) { const next = nextTeamPlaceholder(used); expect(next).toMatch(/^[A-Z]{6}$/); expect(used.has(next)).toBe(false); used.add(next); }
  });
});
