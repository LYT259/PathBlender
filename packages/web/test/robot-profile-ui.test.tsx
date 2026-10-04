import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSession, parseGhostAuto, parsePathFile, parseRobotProfile, type SessionTrajectory } from '@pathblender/core';
import { I18nProvider } from '../src/i18n';
import { App } from '../src/App';
import { applyUploadedProfile, inspectorWarnings } from '../src/robot-profile-ui';

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
    // Real-robot regeneration: new samples, new duration, provenance warning.
    expect(applied.trajectory.samples).not.toBe(before);
    expect(applied.trajectory.warnings.some((w) => w.startsWith('regenerated with real robot config'))).toBe(true);
    expect(applied.trajectory.durationS).toBeGreaterThan(0);
    // The route library carries the same applied profile — composed segments
    // resolve through routeOptions, so they must see the regenerated timing.
    const option = applied.routeOptions![0]!.trajectory;
    expect(option.samples).not.toBe(before);
    expect(option.geometry.lengthM).toBeCloseTo(1.02, 9);
    expect(option.geometrySource).toBe('file');
    expect(option.warnings.some((w) => w.startsWith('regenerated with real robot config'))).toBe(true);
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
    const upload = screen.getByRole('button', { name: 'Upload settings.json' });
    expect(document.querySelector('.robot-library-row')).toHaveClass('needs-settings');
    fireEvent.click(upload);
    fireEvent.change(settingsInput(), { target: { files: [new File([SETTINGS], 'settings.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Upload settings.json' })).not.toBeInTheDocument());
    expect(document.querySelector('.robot-library-row')).not.toHaveClass('needs-settings');
    expect(screen.getByText(/Robot profile applied/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Robot', exact: true }));
    expect(screen.getByText('From file')).toBeInTheDocument();
    expect(screen.queryByText('Not uploaded')).not.toBeInTheDocument();
    expect(screen.getByText('1.02 m')).toBeInTheDocument();
    expect(screen.getByText('0.85 m')).toBeInTheDocument();
    expect(screen.queryByText(defaultWarning)).not.toBeInTheDocument();
  });

  it('keeps the red missing state and the upload action on cancel, corrupt JSON and unrelated JSON', async () => {
    render(<App />);
    dropFiles([new File([read('pathplanner/Pickup.path')], 'Pickup.path', { type: 'application/json' })]);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    const upload = screen.getByRole('button', { name: 'Upload settings.json' });
    fireEvent.click(upload);
    // Cancel: an empty selection never hides the entry.
    fireEvent.change(settingsInput(), { target: { files: [] } });
    expect(screen.getByRole('button', { name: 'Upload settings.json' })).toBeInTheDocument();
    // Corrupt JSON: a concise error, the action stays.
    fireEvent.change(settingsInput(), { target: { files: [new File(['{"robotConfig":'], 'settings.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByText(/not valid JSON/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Upload settings.json' })).toBeInTheDocument();
    // Unrelated JSON: not a profile, the action stays.
    fireEvent.change(settingsInput(), { target: { files: [new File(['{"name":"hi"}'], 'settings.json', { type: 'application/json' })] } });
    await waitFor(() => expect(screen.getByText(/Not a usable robot profile/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Upload settings.json' })).toBeInTheDocument();
    // The red badge persists throughout.
    fireEvent.click(screen.getByRole('button', { name: 'Robot', exact: true }));
    expect(screen.getByText('Not uploaded')).toHaveClass('is-missing');
  });
});

describe('inspector warning filtering', () => {
  it('removes only the redundant default-config notice for both PathPlanner formats', () => {
    expect(inspectorWarnings([defaultWarning, 'generated with default robot config (Kraken X60 swerve) — timing is an estimate', 'Missing waypoint data'])).toEqual(['Missing waypoint data']);
  });
});
