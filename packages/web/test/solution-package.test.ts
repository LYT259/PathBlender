/**
 * Solution package (File ▸ Export Solution Package…): the archive layout,
 * per-team session fidelity, byte-identical original files and the honest
 * video fallback. Canvas/MediaRecorder producers are injected — jsdom has
 * neither — so the tests exercise orchestration, naming and packaging.
 */
import { describe, expect, it } from 'vitest';
import { deserializeSession, type SessionTrajectory, type Trajectory } from '@pathblender/core';
import {
  buildSolutionPackage,
  listVideoMimes,
  pickVideoMime,
  recordVideoWithProbe,
  teamArtifacts,
} from '../src/solution-package';
import { readZipDirectory, inflateEntry } from '../src/zip';

const SAMPLE = 30; // samples per second of trajectory

function makeRobot(overrides: {
  name: string;
  teamNumber?: string;
  teamName?: string;
  displayName?: string;
  startDelayS?: number;
  color?: string;
  mirrored?: boolean;
  relPath?: string;
  id?: string;
}): SessionTrajectory {
  const samples: Trajectory['samples'] = [];
  for (let i = 0; i <= 2 * SAMPLE; i++) {
    const t = i / SAMPLE;
    samples.push({ t, x: t, y: t * 0.2, heading: 0, vx: 1, vy: 0, omega: 0 });
  }
  const trajectory: Trajectory = {
    id: overrides.id ?? `traj-${overrides.name}`,
    name: overrides.name,
    teamName: overrides.teamName ?? overrides.name,
    teamNumber: overrides.teamNumber ?? '',
    displayName: overrides.displayName,
    source: 'ghostauto',
    alliance: 'blue',
    samples,
    durationS: 2,
    geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 },
    geometrySource: 'file',
    moduleLocations: [],
    events: [],
    warnings: [],
  };
  return {
    trajectory,
    startDelayS: overrides.startDelayS ?? 0,
    color: overrides.color ?? '#C5A16A',
    visible: true,
    mirrored: overrides.mirrored,
  };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const MP4_BYTES = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const TRAJ_BYTES = new TextEncoder().encode('{"original":"ghostauto-bytes"}');

function baseOptions() {
  const teamA = makeRobot({ name: 'runA', teamNumber: '8814', startDelayS: 1.5, color: '#C5A16A', mirrored: true });
  teamA.routeOptions = [{ id: 'r1', relPath: 'blue/runA.ghostauto', trajectory: teamA.trajectory }];
  const teamB = makeRobot({ name: 'runB', teamNumber: '11019', startDelayS: 0, color: '#A28CBA' });
  teamB.routeOptions = [{ id: 'r1', relPath: 'blue/runB.ghostauto', trajectory: teamB.trajectory }];
  const rawA = new File([TRAJ_BYTES], 'runA.ghostauto');
  const rawB = new File([TRAJ_BYTES], 'runB.ghostauto');
  const settings = new File([new TextEncoder().encode('{}')], 'settings.json');
  return {
    robots: [teamA, teamB],
    visibleRobots: [teamA, teamB],
    field: { id: 'rebuilt-2026', name: 'Rebuilt', year: 2026, lengthM: 17.548, widthM: 8.052, autoPeriodS: 20 } as Parameters<typeof buildSolutionPackage>[0]['field'],
    fieldId: 'rebuilt-2026',
    customFieldForSession: undefined,
    rawFiles: new Map([['blue/runA.ghostauto', rawA], ['blue/runB.ghostauto', rawB]]),
    settingsFiles: new Map([['traj-runA', settings]]),
    conflicts: [],
    bounds: [],
    appVersion: '0.0.0-test',
    capture: {
      renderPng: async () => PNG_BYTES,
      recordVideo: async () => ({ bytes: MP4_BYTES, mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' }),
    },
  } as const;
}

describe('team artifacts', () => {
  it('prefers the team number, dedupes collisions, falls back to 队伍A/B', () => {
    const robots = [
      makeRobot({ name: 'a', teamNumber: '8814' }),
      makeRobot({ name: 'b', teamNumber: '8814' }),
      makeRobot({ name: 'c', teamName: '', displayName: 'Alpha' }),
      makeRobot({ name: '', teamName: '' }),
    ];
    const teams = teamArtifacts(robots, new Map(), new Map());
    expect(teams.map((t) => t.dirName)).toEqual(['8814', '8814-2', 'Alpha', '队伍D']);
  });

  it('collects this team\'s raw files by relPath plus the applied settings file', () => {
    const robot = makeRobot({ name: 'runA', teamNumber: '8814' });
    robot.routeOptions = [
      { id: 'r1', relPath: 'blue/runA.ghostauto', trajectory: robot.trajectory },
      { id: 'r2', relPath: 'blue/alt.ghostauto', trajectory: robot.trajectory },
    ];
    robot.profileOptions = [{ id: 'p1', relPath: 'blue/settings.json', profile: { name: 'MK5i', geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 }, moduleLocations: [] } }];
    const rawA = new File([TRAJ_BYTES], 'runA.ghostauto');
    const rawAlt = new File([TRAJ_BYTES], 'alt.ghostauto');
    const rawSettings = new File([TRAJ_BYTES], 'settings.json');
    const rawUnrelated = new File([TRAJ_BYTES], 'other.ghostauto');
    const teams = teamArtifacts(
      [robot],
      new Map([
        ['blue/runA.ghostauto', rawA],
        ['blue/alt.ghostauto', rawAlt],
        ['other/other.ghostauto', rawUnrelated],
      ]),
      new Map([[robot.trajectory.id, rawSettings]]),
    );
    // The profile option's file was never imported into the raw store, so
    // it cannot be included — only what this session actually holds.
    expect(teams[0]!.originalFiles.map((f) => f.relPath)).toEqual([
      'blue/runA.ghostauto',
      'blue/alt.ghostauto',
      'settings.json',
    ]);
  });
});

describe('pickVideoMime', () => {
  it('prefers H.264 mp4, then webm, then nothing', () => {
    expect(pickVideoMime((m) => m.startsWith('video/mp4'))).toMatchObject({ ext: 'mp4' });
    expect(pickVideoMime((m) => m.startsWith('video/webm'))).toMatchObject({ ext: 'webm' });
    expect(pickVideoMime(() => false)).toBeNull();
  });
});

describe('listVideoMimes', () => {
  it('lists every claiming candidate in preference order', () => {
    expect(listVideoMimes((m) => m.startsWith('video/mp4') || m === 'video/webm').map((c) => c.ext))
      .toEqual(['mp4', 'mp4', 'mp4', 'webm']);
    expect(listVideoMimes(() => false)).toEqual([]);
  });
});

describe('recordVideoWithProbe', () => {
  const MP4 = { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' };
  const WEBM = { mime: 'video/webm;codecs=vp9', ext: 'webm' };
  const take = (n: number) => new Uint8Array(n);

  it('probes with a short take before spending the full one', async () => {
    const calls: Array<[string, number]> = [];
    const video = await recordVideoWithProbe(
      async (mime, seconds) => {
        calls.push([mime, seconds]);
        return take(7);
      },
      [MP4, WEBM],
      20,
      1,
    );
    expect(video).toMatchObject({ mime: MP4.mime, ext: 'mp4' });
    expect(calls).toEqual([[MP4.mime, 1], [MP4.mime, 20]]);
  });

  it('skips a codec that claims support yet writes nothing', async () => {
    const video = await recordVideoWithProbe(
      async (mime) => (mime === MP4.mime ? take(0) : take(7)),
      [MP4, WEBM],
      20,
      1,
    );
    expect(video).toMatchObject({ mime: WEBM.mime, ext: 'webm' });
  });

  it('drops a codec whose probe passed but whose full take came back empty', async () => {
    const video = await recordVideoWithProbe(
      async (mime, seconds) => (mime === MP4.mime && seconds > 1 ? take(0) : take(7)),
      [MP4, WEBM],
      20,
      1,
    );
    expect(video).toMatchObject({ mime: WEBM.mime, ext: 'webm' });
  });

  it('records nothing rather than shipping an empty replay', async () => {
    expect(await recordVideoWithProbe(async () => take(0), [MP4, WEBM], 20, 1)).toBeNull();
  });
});

describe('buildSolutionPackage', () => {
  it('packs README, full session, video, overview, per-team sessions and byte-identical originals', async () => {
    const o = baseOptions();
    const result = await buildSolutionPackage({ ...o, capture: { ...o.capture } });
    const dir = readZipDirectory(result.zip);
    const names = dir.map((e) => e.name);
    expect(names).toEqual([
      'README.md',
      '完整方案.pb',
      '回放.mp4',
      '路线总览.png',
      '各队方案/8814.pb',
      '原始导入文件/8814/blue/runA.ghostauto',
      '原始导入文件/8814/settings.json',
      '各队方案/11019.pb',
      '原始导入文件/11019/blue/runB.ghostauto',
    ]);

    // The full session restores with both robots and preserves the delay.
    const full = JSON.parse(new TextDecoder().decode(await inflateEntry(dir[1]!)));
    expect(full.app).toBe('pathblender');
    expect(full.robots).toHaveLength(2);
    expect(full.robots[0].startDelayS).toBeCloseTo(1.5, 9);
    expect(full.robots[0].mirrored).toBe(true);
    const restored = deserializeSession(new TextDecoder().decode(await inflateEntry(dir[1]!)));
    expect(restored.robots).toHaveLength(2);

    // Per-team sessions contain exactly one robot, with delay + color kept.
    const teamA = deserializeSession(new TextDecoder().decode(await inflateEntry(dir[4]!)));
    expect(teamA.robots).toHaveLength(1);
    expect(teamA.robots[0]!.trajectory.teamNumber).toBe('8814');
    expect(teamA.robots[0]!.startDelayS).toBeCloseTo(1.5, 9);
    expect(teamA.robots[0]!.color).toBe('#C5A16A');
    const teamB = deserializeSession(new TextDecoder().decode(await inflateEntry(dir[7]!)));
    expect(teamB.robots[0]!.trajectory.teamNumber).toBe('11019');

    // Original file bytes survive verbatim; video/png ride through as-is.
    expect(Array.from(await inflateEntry(dir[5]!))).toEqual(Array.from(TRAJ_BYTES));
    expect(Array.from(dir[2]!.data)).toEqual(Array.from(MP4_BYTES));
    expect(Array.from(dir[3]!.data)).toEqual(Array.from(PNG_BYTES));

    // The README is bilingual and documents the actual codec.
    const readme = new TextDecoder().decode(await inflateEntry(dir[0]!));
    expect(readme).toContain('Solution Package 方案包');
    expect(readme).toContain('视频');
    expect(readme).toContain('avc1');
    expect(result.suggestedName).toMatch(/^pathblender-solution-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  it('never ships an empty video take (encoder claimed support but produced nothing)', async () => {
    const o = baseOptions();
    const result = await buildSolutionPackage({
      ...o,
      capture: {
        renderPng: async () => PNG_BYTES,
        recordVideo: async () => ({ bytes: new Uint8Array(), mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' }),
      },
    });
    expect(result.entries.every((n) => !n.startsWith('回放.'))).toBe(true);
    expect(result.videoMime).toBeNull();
  });

  it('omits the video honestly when the engine cannot record', async () => {
    const o = baseOptions();
    const result = await buildSolutionPackage({ ...o, capture: { renderPng: async () => PNG_BYTES } });
    expect(result.entries.every((n) => !n.startsWith('回放.'))).toBe(true);
    expect(result.videoMime).toBeNull();
    const dir = readZipDirectory(result.zip);
    const readme = new TextDecoder().decode(await inflateEntry(dir[0]!));
    expect(readme).toContain('未包含');
  });

  it('omits 原始导入文件 folders for teams with no recoverable originals', async () => {
    const o = baseOptions();
    const result = await buildSolutionPackage({
      ...o,
      rawFiles: new Map(),
      settingsFiles: new Map(),
    });
    expect(result.entries.every((n) => !n.startsWith('原始导入文件/'))).toBe(true);
  });

  it('reports progress through the stages', async () => {
    const o = baseOptions();
    const stages: string[] = [];
    await buildSolutionPackage({ ...o, capture: { renderPng: async () => PNG_BYTES } , onProgress: (s) => stages.push(s) });
    expect(stages).toContain('rendering');
    expect(stages).toContain('saving');
  });
});
