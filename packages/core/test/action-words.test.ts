import { describe, expect, it } from 'vitest';
import { makeSession, activeActionsAt, normalizeActionWord, type Trajectory } from '../src';

function route(events: { name: string; t: number }[], overrides: Partial<Trajectory> = {}): Trajectory {
  return {
    id: 'route',
    name: 'route',
    teamName: 'Team',
    teamNumber: '0000',
    source: 'ghostauto',
    alliance: 'blue',
    samples: [
      { t: 0, x: 0, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      { t: 10, x: 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
    ],
    durationS: 10,
    geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 },
    geometrySource: 'file',
    moduleLocations: [],
    events,
    warnings: [],
    ...overrides,
  } as Trajectory;
}

const names = (st: ReturnType<typeof makeSession>, t: number) =>
  activeActionsAt(st, t).map((a) => a.name);

describe('normalizeActionWord', () => {
  it('erases case and separator formatting', () => {
    for (const form of ['stop_intake', 'Stop-Intake', 'STOP_INTAKE', 'stop intake', 'stopIntake', 'Stop.Intake', '  stop—intake  ']) {
      expect(normalizeActionWord(form)).toBe('stopintake');
    }
    expect(normalizeActionWord('HalfOpenBlocker')).toBe('halfopenblocker');
  });
});

describe('activeActionsAt — pairs resolve to exact intervals', () => {
  it('a stop word closes the action it names, to the instant', () => {
    const st = makeSession(route([{ name: 'intake', t: 1 }, { name: 'stop_intake', t: 4.5 }]));
    expect(names(st, 0.99)).toEqual([]);
    expect(names(st, 1)).toEqual(['intake']);
    expect(names(st, 4.4)).toEqual(['intake']);
    expect(names(st, 4.51)).toEqual(['stop_intake']); // flash window only
  });

  it('stow_intake succeeds intake — same mechanism, new goal', () => {
    const st = makeSession(route([{ name: 'intake', t: 0 }, { name: 'stow_intake', t: 3 }]));
    expect(names(st, 2)).toEqual(['intake']);
    expect(names(st, 3)).toEqual(['stow_intake']);
  });

  it('feed/stop_feed bracket the feeding window', () => {
    const st = makeSession(route([{ name: 'feed', t: 2 }, { name: 'stop_feed', t: 6 }]));
    expect(names(st, 3)).toEqual(['feed']);
    expect(names(st, 9)).toEqual([]);
  });

  it('a stop without its opener is just a flash', () => {
    const st = makeSession(route([{ name: 'stop_intake', t: 2.99 }]));
    expect(names(st, 3)).toEqual(['stop_intake']);
    expect(names(st, 4.1)).toEqual([]);
  });
});

describe('activeActionsAt — parallel groups', () => {
  it('different mechanisms coexist; the shooter group replaces within itself', () => {
    // Machine-2 L6 shape: three actions open at once, shoot takes over pre_aim.
    const st = makeSession(route([
      { name: 'intake', t: 0 }, { name: 'pre_aim', t: 0 }, { name: 'align', t: 0 }, { name: 'shoot', t: 4.56 },
    ]));
    expect(names(st, 1)).toEqual(['intake', 'pre_aim', 'align']);
    // shooter slot keeps pre_aim's position — the badge never reorders.
    expect(names(st, 5)).toEqual(['intake', 'shoot', 'align']);
  });

  it('the machine-1 shooting burst reads as the code runs it', () => {
    // champs L11: shoot+feed+stow open; at 4.05 stop_feed closes feed and
    // pre_aim succeeds shoot.
    const st = makeSession(route([
      { name: 'shoot', t: 0 }, { name: 'feed', t: 0 }, { name: 'stow_intake', t: 0 },
      { name: 'feed_extension', t: 0 }, { name: 'pre_aim', t: 4.05 }, { name: 'stop_feed', t: 4.05 },
    ]));
    expect(names(st, 0.5)).toEqual(['shoot', 'feed', 'stow_intake', 'feed_extension']);
    expect(names(st, 0.2).includes('feed_extension')).toBe(true); // 1 s flash
    expect(names(st, 5.5)).toEqual(['pre_aim', 'stow_intake']);
  });

  it('blocker moves flash for their command budget, then drop off', () => {
    const st = makeSession(route([
      { name: 'intake', t: 0 }, { name: 'close_blocker', t: 0 }, { name: 'half_open_blocker', t: 2 }, { name: 'shoot', t: 8.56 },
    ]));
    expect(names(st, 1)).toEqual(['intake', 'close_blocker']);
    expect(names(st, 3)).toEqual(['intake', 'half_open_blocker']); // inside its 2 s budget
    expect(names(st, 4.3)).toEqual(['intake']);          // half_open's 2 s over
    expect(names(st, 9)).toEqual(['intake', 'shoot']);
  });
});

describe('activeActionsAt — other teams\' vocabularies', () => {
  it('format variants of the team words behave identically', () => {
    const st = makeSession(route([
      { name: 'Intake', t: 0 }, { name: 'STOP-INTAKE', t: 2 }, { name: 'DeployExtension', t: 3 },
    ]));
    expect(names(st, 1)).toEqual(['Intake']);
    expect(names(st, 2.5)).toEqual(['STOP-INTAKE']);
    expect(names(st, 3.5)).toEqual(['DeployExtension']);
    expect(names(st, 4.2)).toEqual([]);
  });

  it('unknown words default to sustained and coexist without replacing', () => {
    const st = makeSession(route([{ name: 'banana', t: 1 }, { name: 'wingus', t: 2 }, { name: 'banana', t: 5 }]));
    expect(names(st, 3)).toEqual(['banana', 'wingus']);
    expect(names(st, 9)).toEqual(['banana', 'wingus']); // both open; slots keep first-open order
  });

  it('returns nothing for unannotated routes at any time', () => {
    const st = makeSession(route([]));
    expect(activeActionsAt(st, 0)).toEqual([]);
    expect(activeActionsAt(st, 9)).toEqual([]);
  });
});
