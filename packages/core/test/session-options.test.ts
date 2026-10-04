import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deserializeSession, makeSession, parseTraj, serializeSession } from '../src';
function fixture() {
  const trajectory = parseTraj(readFileSync(resolve(__dirname, '../../../samples/traj/v3_swerve.traj'), 'utf8'), 'L1.traj');
  return { ...makeSession({ ...trajectory, teamNumber: 'AAAAAA' }), routeId: 'route-1', profileId: 'profile-1',
    routeOptions: [{ id: 'route-1', relPath: 'choreo/L1.traj', trajectory }],
    profileOptions: [{ id: 'profile-1', relPath: 'choreo/settings.json', profile: { name: 'robot', geometry: trajectory.geometry, moduleLocations: trajectory.moduleLocations } }],
  };
}
describe('team-owned alternatives in sessions', () => {
  it('round-trips all route samples and the selected robot configuration', () => {
    const original = fixture();
    const [restored] = deserializeSession(serializeSession([original], 'rebuilt-2026')).robots;
    expect(restored?.routeOptions).toEqual(original.routeOptions);
    expect(restored?.profileOptions).toEqual(original.profileOptions);
    expect(restored?.profileId).toBe('profile-1');
    expect(restored?.routeId).toBe('route-1');
    expect(restored?.trajectory.teamNumber).toBe('AAAAAA');
  });
  it('accepts older files that have a route id but no stored alternatives', () => {
    const value = fixture();
    const legacy = { ...value, routeOptions: undefined, profileOptions: undefined, profileId: undefined };
    const [restored] = deserializeSession(serializeSession([legacy], 'rebuilt-2026')).robots;
    expect(restored?.routeId).toBe('route-1');
    expect(restored?.routeOptions).toBeUndefined();
  });
  it.each(['samples', 'events', 'warnings', 'moduleLocations', 'teamNumber'])('rejects an incomplete saved alternative: %s', (key) => {
    const data = JSON.parse(serializeSession([fixture()], 'rebuilt-2026'));
    delete data.robots[0].routeOptions[0].trajectory[key];
    expect(() => deserializeSession(JSON.stringify(data))).toThrow('invalid team route options');
  });
  it('rejects invalid option geometry before it can be selected', () => {
    const data = JSON.parse(serializeSession([fixture()], 'rebuilt-2026'));
    data.robots[0].profileOptions[0].profile.geometry.lengthM = -1;
    expect(() => deserializeSession(JSON.stringify(data))).toThrow('invalid team profile options');
  });
});
