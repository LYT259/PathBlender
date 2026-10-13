import { makeCustomField, makeSession, parsePathFile, type SessionTrajectory } from '@pathblender/core';
import a from './assets/first-check/A.ghostauto?raw';
import b from './assets/first-check/B.ghostauto?raw';
import c from './assets/first-check/C.ghostauto?raw';
import { applySequenceSegments, sequenceViewFor } from './auto-sequence-state';

/** Original synthetic teaching fixtures, not official field/robot measurements.
 * A: (2+t,4), B: (5,1+t), C: (2+t,6.5), 0 <= t <= 6 s, at 0.1 s intervals.
 * 0.9 m square bumpers. A and B meet at t=3. B delayed 2 s clears every pair.
 * Files use the normal core parser and ordinary session/check/playback path. */
export const PRACTICE_FIELD = makeCustomField({
  name: 'Practice — synthetic data', lengthM: 12, widthM: 8,
  ppm: 100, marginM: 0, pixelWidth: 1200, pixelHeight: 800, autoPeriodS: 15,
});
export const PRACTICE_B_ID = 'first-check-b';
const PRACTICE_IDS = ['first-check-a', PRACTICE_B_ID, 'first-check-c'];

export function createFirstCheck(): SessionTrajectory[] {
  return [a, b, c].map((text, index) => {
    const letter = ['A', 'B', 'C'][index]!;
    return makeSession({ ...parsePathFile(text, `${letter}.ghostauto`),
      id: PRACTICE_IDS[index]!, displayName: letter, teamNumber: letter,
    }, index);
  });
}

export function isFirstCheckSession(robots: readonly SessionTrajectory[]): boolean {
  return robots.length === 3 && PRACTICE_IDS.every((id) => robots.some((r) => r.trajectory.id === id));
}

/** Use the same composition mutation as the editor, including on an already
 * arranged robot. Never overwrite a user's other segments or imported samples. */
export function delayPracticeB(robots: SessionTrajectory[]): SessionTrajectory[] {
  return robots.map((robot) => {
    if (robot.trajectory.id !== PRACTICE_B_ID) return robot;
    const { segments } = sequenceViewFor(robot);
    return applySequenceSegments(robot, segments.map((segment, i) => i === 0 ? { ...segment, waitBeforeS: 2 } : segment));
  });
}
