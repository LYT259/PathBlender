import { describe, expect, it } from 'vitest';
import { robotAnnotation, robotIdentity, robotOriginalIdentity } from '../src/robot-identity';

type Identity = { name: string; teamNumber: string; displayName?: string };

const traj = (overrides: Partial<Identity> = {}): Identity => ({
  name: 'Route',
  teamNumber: '8814',
  displayName: undefined,
  ...overrides,
});

describe('robot identity helpers', () => {
  it('prefers a trimmed display name over the imported identity', () => {
    expect(robotIdentity(traj({ displayName: '  甲队 Red One  ' }))).toBe('甲队 Red One');
  });

  it('falls back to the bare team number, then the route name', () => {
    expect(robotIdentity(traj())).toBe('8814');
    expect(robotIdentity(traj({ teamNumber: '' }))).toBe('Route');
    expect(robotIdentity(traj({ teamNumber: '', displayName: '   ' }))).toBe('Route');
  });

  it('keeps the original teamNumber/name rule for the details panel', () => {
    expect(robotOriginalIdentity(traj({ displayName: 'My Robot' }))).toBe('8814');
    expect(robotOriginalIdentity(traj({ teamNumber: '', displayName: 'My Robot' }))).toBe('Route');
  });

  it('annotates the field with the display name, falling back to the raw team number', () => {
    expect(robotAnnotation(traj({ displayName: '甲队' }))).toBe('甲队');
    expect(robotAnnotation(traj())).toBe('8814');
    expect(robotAnnotation(traj({ displayName: '  ' }))).toBe('8814');
    expect(robotAnnotation(traj({ teamNumber: '', displayName: 'Only Name' }))).toBe('Only Name');
    expect(robotAnnotation(traj({ teamNumber: '' }))).toBe('');
  });
});
