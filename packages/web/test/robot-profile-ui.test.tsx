import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyProfileToRobot, makeSession, parseGhostAuto, parsePathFile, parseRobotProfile, type SessionTrajectory } from '@pathblender/core';
import { I18nProvider } from '../src/i18n';
import { App } from '../src/App';
import { saveText } from '../src/download';
import { applyUploadedProfile, inspectorWarnings } from '../src/robot-profile-ui';
import { comboboxValues, openCombobox } from './combobox';

vi.mock('../src/download', () => ({ saveText: vi.fn(async () => true) }));

const SAMPLES = resolve(__dirname, '../../../samples');
const read = (rel: string) => readFileSync(resolve(SAMPLES, rel), 'utf-8');
const SETTINGS = JSON.stringify({
  robotConfig: { robotWidth: 0.85, robotLength: 1.02, robotMass: 61.2, robotMOI: 5.1 },
});
const defaultWarning = 'generated with default robot config (Kraken X60 swerve) — timing is an estimate; attach a PathPlanner settings.json profile for real geometry and timing';

function ppRobot(): SessionTrajectory {
  const trajectory = parsePathFile(read('pathplanner/Pickup.path'), 'team/Pickup.path', () => undefined);
  return { ...makeSession(trajectory), routeId: 'pickup', routeOptions: [{ id: 'pickup', relPath: 'team/Pickup.path', trajectory }] };
}
function ghostRobot(): SessionTrajectory {
  const trajectory = { ...parseGhostAuto(read('ghostauto/straight_run.ghostauto'), 'A.ghostauto'), source: 'choreo-traj' as const, geometrySource: 'default' as const, warnings: [defaultWarning, 'Keep this unrelated diagnostic'] };
  return { ...makeSession(trajectory), routeId: 'a', routeOptions: [{ id: 'a', relPath: 'team/A.ghostauto', trajectory }] };
}

beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); localStorage.setItem('pb.lengthUnit', 'm'); vi.clearAllMocks(); });

describe('applyUploadedProfile', () => {
  it('applies the profile to the robot and every library route, regenerating PathPlanner timing', () => {
    const robot = ppRobot();
    const before = robot.trajectory.samples;
    const profile = parseRobotProfile(SETTINGS, 'team/settings.json')!;
    const applied = applyUploadedProfile(robot, profile, 'team/settings.json');
    expect(applied.profileId).toBeDefined();
    expect(applied.profileOptions).toHaveLength(1);
    expect(applied.trajectory.geometry.lengthM).toBeCloseTo(1.02, 9);
    expect(applied.trajectory.geometry.widthM).toBeCloseTo(0.85, 9);
    expect(applied.trajectory.geometrySource).toBe('file');
    // Real-robot regeneration: new samples, new duration, partial-config
    // warning (mass+MOI profile — defaults still fill the other parameters).
    expect(applied.trajectory.samples).not.toBe(before);
    expect(applied.trajectory.warnings.some((w) => w.startsWith('timing re-estimated with partial robot config'))).toBe(true);
    expect(applied.trajectory.durationS).toBeGreaterThan(0);
    // The route library carries the same applied profile — composed segments
    // resolve through routeOptions, so they must see the regenerated timing.
    const option = applied.routeOptions![0]!.trajectory;
    expect(option.samples).not.toBe(before);
    expect(option.geometry.lengthM).toBeCloseTo(1.02, 9);
    expect(option.geometrySource).toBe('file');
    expect(option.warnings.some((w) => w.startsWith('timing re-estimated with partial robot config'))).toBe(true);
    // The composition itself is untouched: route ids and waits stay put.
    const composed = { ...applied, sequence: { segments: [{ id: 's1', routeId: 'pickup', waitBeforeS: 1 }] } };
    const composedApplied = applyUploadedProfile(composed, profile, 'team/settings.json');
    expect(composedApplied.sequence).toEqual(composed.sequence);
  });

  it('applies geometry only to non-PathPlanner routes — samples are never touched', () => {
    const robot = ghostRobot();
    const profile = parseRobotProfile(SETTINGS, 'settings.json')!;
    const applied = applyUploadedProfile(robot, profile, 'settings.json');
    expect(applied.trajectory.geometrySource).toBe('file');
    expect(applied.trajectory.geometry.lengthM).toBeCloseTo(1.02, 9);
    expect(applied.trajectory.samples).toBe(robot.trajectory.samples);
    expect(applied.routeOptions![0]!.trajectory.samples).toBe(robot.routeOptions![0]!.trajectory.samples);
    // The default-config estimate stays in the data but is hidden by the UI
    // filter; unrelated diagnostics are kept.
    expect(inspectorWarnings(applied.trajectory.warnings)).toEqual(['Keep this unrelated diagnostic']);
  });
});

describe('settings.json upload in the workspace', () => {
  function dropFiles(files: File[]) {
    fireEvent.drop(window, { dataTransfer: { files } });
  }
  const settingsInput = () => document.querySelector('input[accept=".json,application/json"]') as HTMLInputElement;

  it('applies a real profile: upload action disappears, layout restores and data shows as from-file', async () => {
    render(<App />);
    dropFiles([new File([read('pathplanner/Pickup.path')], 'Pickup.path', { type: 'application/json' })]);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    const upload = screen.getByRole('button', { name: 'Import settings.json' });
    expect(document.querySelector('.robot-library-row')).toHaveClass('needs-settings');
    fireEvent.click(upload);
    fireEvent.change(settingsInput(), { target: { files: [new File([SETTINGS], 'settings.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Import settings.json' })).not.toBeInTheDocument());
    expect(document.querySelector('.robot-library-row')).not.toHaveClass('needs-settings');
    expect(screen.getByText(/Robot profile applied/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Robot', exact: true }));
    expect(screen.getByText('From file')).toBeInTheDocument();
    expect(screen.queryByText('Not imported')).not.toBeInTheDocument();
    expect(screen.getByText('1.02 m')).toBeInTheDocument();
    expect(screen.getByText('0.85 m')).toBeInTheDocument();
    expect(screen.queryByText(defaultWarning)).not.toBeInTheDocument();
  });

  it('keeps the red missing state and the upload action on cancel, corrupt JSON and unrelated JSON', async () => {
    render(<App />);
    dropFiles([new File([read('pathplanner/Pickup.path')], 'Pickup.path', { type: 'application/json' })]);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    const upload = screen.getByRole('button', { name: 'Import settings.json' });
    fireEvent.click(upload);
    // Cancel: an empty selection never hides the entry.
    fireEvent.change(settingsInput(), { target: { files: [] } });
    expect(screen.getByRole('button', { name: 'Import settings.json' })).toBeInTheDocument();
    // Corrupt JSON: a concise error, the action stays.
    fireEvent.change(settingsInput(), { target: { files: [new File(['{"robotConfig":'], 'settings.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByText(/not valid JSON/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Import settings.json' })).toBeInTheDocument();
    // Unrelated JSON: not a profile, the action stays.
    fireEvent.change(settingsInput(), { target: { files: [new File(['{"name":"hi"}'], 'settings.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByText(/Not a usable robot profile/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Import settings.json' })).toBeInTheDocument();
    // The red badge persists throughout.
    fireEvent.click(screen.getByRole('button', { name: 'Robot', exact: true }));
    expect(screen.getByText('Not imported')).toHaveClass('is-missing');
  });
});

describe('inspector warning filtering', () => {
  it('removes only the redundant default-config notice for both PathPlanner formats', () => {
    expect(inspectorWarnings([defaultWarning, 'generated with default robot config (Kraken X60 swerve) — timing is an estimate', 'Missing waypoint data'])).toEqual(['Missing waypoint data']);
  });
});

describe('unified application entries (Task 6)', () => {
  const constrainedText = read('pathplanner/constrained_pointing.path');
  const scoreText = read('pathplanner/Score.path');
  const autoText = read('pathplanner/Example Auto.auto');
  const profile45 = parseRobotProfile(
    JSON.stringify({ robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 45, robotMOI: 2.0 } }),
    '254/settings.json',
  )!;
  // The full synthetic set current-limited to 40 A retimes every fixture in
  // this folder decisively (probed 2026-11-07): the constrained content
  // 8.0105 → 10.074476474759628 s, Score 4.0827 → 10.619182604797595 s, and
  // the routine chains d1 + 2 s + d2 = 22.693659079557223 s.
  const SETTINGS_FULL40 = JSON.stringify({
    robotWidth: 0.85, robotLength: 0.85, holonomicMode: true,
    robotMass: 150, robotMOI: 6.9, wheelCOF: 1.2, driveWheelRadius: 0.048,
    driveGearing: 6.08, maxDriveSpeed: 4.5, driveMotorType: 'krakenX60',
    driveCurrentLimit: 40,
    flModuleX: 0.273, flModuleY: 0.273, frModuleX: -0.273, frModuleY: 0.273,
    blModuleX: 0.273, blModuleY: -0.273, brModuleX: -0.273, brModuleY: -0.273,
  });
  // The distractor that keeps the folder ambiguous (two profiles → no
  // automatic pick at import), so the test below exercises the select entry
  // alone: mass 45 + MOI 2.0 would re-time Pickup to 7.629417092969108 s,
  // distinguishable from every pinned value.
  const SETTINGS_MASS45_ALT = JSON.stringify({
    robotConfig: { robotWidth: 0.9, robotLength: 0.9, robotMass: 45, robotMOI: 2.0 },
  });

  function constrainedRobot(): SessionTrajectory {
    const trajectory = parsePathFile(constrainedText, 'team/pointing.path', () => undefined);
    return { ...makeSession(trajectory), routeId: 'p', routeOptions: [{ id: 'p', relPath: 'team/pointing.path', trajectory }] };
  }

  function folderFile(relPath: string, text: string) {
    const file = new File([text], relPath.split('/').at(-1)!, { type: 'application/json' });
    Object.defineProperty(file, 'webkitRelativePath', { value: relPath });
    return file;
  }
  const dropFolder = (files: File[]) => fireEvent.drop(window, { dataTransfer: { files } });

  it('upload and select entries produce identical application', () => {
    const robot = constrainedRobot();
    const uploaded = applyUploadedProfile(robot, profile45, 'x/settings.json');
    const viaCore = applyProfileToRobot(robot, profile45);
    // Bookkeeping aside, both entries apply exactly the same trajectories to
    // the whole slot — a real regeneration, not just a geometry swap.
    expect(uploaded.trajectory).toEqual(viaCore.trajectory);
    expect(uploaded.routeOptions).toEqual(viaCore.routeOptions);
    expect(uploaded.trajectory.durationS).not.toBeCloseTo(robot.trajectory.durationS, 6);
    // Bookkeeping stays each entry's own concern.
    expect(uploaded.profileId).toBeDefined();
    expect(uploaded.profileOptions).toHaveLength(1);
    expect(viaCore.profileId).toBeUndefined();
    expect(viaCore.profileOptions).toBeUndefined();
  });

  it('selecting a profile from the inspector applies it to the whole route library', async () => {
    render(<App />);
    // Two profiles in the folder → no automatic pick at import, so this test
    // isolates the select entry itself (a single-profile folder would let the
    // import-time application mask a select-only regression).
    dropFolder([
      folderFile('254/paths/Pickup.path', constrainedText),
      folderFile('254/paths/Score.path', scoreText),
      folderFile('254/autos/Example Auto.auto', autoText),
      folderFile('254/settings.json', SETTINGS_FULL40),
      folderFile('254/alt/settings.json', SETTINGS_MASS45_ALT),
    ]);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    fireEvent.click(screen.getByText('254', { selector: '.robot-name' }));
    const profiles = await screen.findByRole('combobox', { name: 'Robot profile' });
    expect(comboboxValues(profiles)).toHaveLength(3); // prompt + both profiles
    // Save moved to the File menu (2026-10-06): trigger the same handler via ⌘S.
    // Before selection: no profile bound, every library route still on the
    // default-config import timings.
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    const before = JSON.parse(vi.mocked(saveText).mock.calls.at(-1)![2]).robots[0];
    expect(before.profileId).toBeUndefined();
    const beforeDuration = (relPath: string) =>
      before.routeOptions.find((o: { relPath: string }) => o.relPath === relPath).trajectory.durationS;
    expect(beforeDuration('254/paths/Pickup.path')).toBeCloseTo(8.010485665780992, 6);
    expect(beforeDuration('254/paths/Score.path')).toBeCloseTo(4.082737556237078, 6);
    expect(beforeDuration('254/autos/Example Auto.auto')).toBeCloseTo(14.09322322201807, 6);
    // Select the 40 A profile by its rendered name ("254 · …", not "alt").
    const list = openCombobox(profiles);
    fireEvent.click(within(list).getAllByRole('option').find((o) => o.textContent!.startsWith('254 ·'))!);
    // After selection: the whole route library regenerated against the
    // selected config, profile bookkeeping bound to that entry.
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    const stored = JSON.parse(vi.mocked(saveText).mock.calls.at(-1)![2]).robots[0];
    expect(stored.profileId).toBe(
      stored.profileOptions.find((p: { relPath: string }) => p.relPath === '254/settings.json').id,
    );
    const duration = (relPath: string) =>
      stored.routeOptions.find((o: { relPath: string }) => o.relPath === relPath).trajectory.durationS;
    expect(duration('254/paths/Pickup.path')).toBeCloseTo(10.074476474759628, 6);
    expect(duration('254/paths/Score.path')).toBeCloseTo(10.619182604797595, 6);
    expect(duration('254/autos/Example Auto.auto')).toBeCloseTo(22.693659079557223, 6);
    for (const route of stored.routeOptions) {
      expect(route.trajectory.geometrySource).toBe('file');
      expect(route.trajectory.timingSource).toBe('full-config');
    }
  });
});
