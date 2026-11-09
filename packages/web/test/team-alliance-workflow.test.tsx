import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { REBUILT_2026, type SessionTrajectory } from '@pathblender/core';
import { App } from '../src/App';
import { saveText } from '../src/download';

vi.mock('../src/download', () => ({ saveText: vi.fn(), copyText: vi.fn() }));
vi.mock('../src/components/FieldCanvas', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas: forwardRef((_props: { robots: SessionTrajectory[] }, _ref) => <div data-testid="field-2d">{JSON.stringify(_props.robots)}</div>) };
});
vi.mock('../src/components/FieldCanvas3D', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas3D: forwardRef((_props: { robots: SessionTrajectory[] }, _ref) => <div data-testid="field-3d">{JSON.stringify(_props.robots)}</div>) };
});

const pathFile = (name: string, display = name) => new File([readFileSync(resolve(__dirname, '../../../samples/ghostauto', name), 'utf8')], display);
const fieldRobots = (): SessionTrajectory[] => JSON.parse(screen.getByTestId('field-2d').textContent!);
const drop = (files: File[]) => fireEvent.drop(window, { dataTransfer: { files } });
const folderFile = (name: string, folder: string, display: string) => {
  const file = pathFile(name, display);
  Object.defineProperty(file, 'webkitRelativePath', { value: `${folder}/${display}` });
  return file;
};
const allianceDialog = () => screen.findByRole('dialog', { name: 'Choose each team’s alliance' });
const rowAt = (index: number) => document.querySelectorAll('.robot-library-row')[index]! as HTMLElement;

async function dropFolder(files: File[]) {
  drop(files);
  return allianceDialog();
}

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterAll(() => new Promise((resolve) => setTimeout(resolve, 2600)));

describe('per-team alliance at folder import', () => {
  it('asks per team before committing; applying the defaults keeps today’s exact import', async () => {
    render(<App />);
    const dialog = await dropFolder([folderFile('straight_run.ghostauto', '9999', 'Straight.ghostauto')]);
    expect(screen.queryByTestId('field-2d')).toBeNull();
    const group = within(dialog).getByRole('group', { name: 'Team alliance: 9999' });
    expect(within(group).getByRole('radio', { name: 'Blue' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Red' })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(fieldRobots()).toHaveLength(1));
    const robot = fieldRobots()[0]!;
    expect(robot.teamAlliance).toBe('blue');
    expect(robot.trajectory.alliance).toBe('blue');
    expect(robot.trajectory.samples[0]!.x).toBe(2);
  });

  it('marks the chosen team red — its routes land on the red half, the others stay untouched', async () => {
    render(<App />);
    const dialog = await dropFolder([
      folderFile('straight_run.ghostauto', '9999', 'Straight.ghostauto'),
      folderFile('straight_run.ghostauto', '8814', 'Straight.ghostauto'),
    ]);
    expect(within(dialog).getAllByRole('group', { name: /Team alliance: \d+/ })).toHaveLength(2);
    fireEvent.click(within(within(dialog).getByRole('group', { name: 'Team alliance: 8814' })).getByRole('radio', { name: 'Red' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    const red = fieldRobots().find((r) => r.trajectory.teamNumber === '8814')!;
    const blue = fieldRobots().find((r) => r.trajectory.teamNumber === '9999')!;
    expect(red.teamAlliance).toBe('red');
    expect(blue.teamAlliance).toBe('blue');
    expect(red.trajectory.alliance).toBe('blue');
    expect(blue.trajectory.alliance).toBe('blue');
    // Same authored route (first sample x=2): the red team is the 180° symmetry.
    expect(red.trajectory.samples[0]!.x).toBeCloseTo(REBUILT_2026.lengthM - 2, 9);
    expect(blue.trajectory.samples[0]!.x).toBe(2);
  });

  it('cancel aborts the import without adding any robot', async () => {
    render(<App />);
    const dialog = await dropFolder([folderFile('straight_run.ghostauto', '9999', 'Straight.ghostauto')]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryAllByTestId('field-2d')).toHaveLength(0);
  });

  it('Enter at the dialog’s initial focus imports the defaults exactly once', async () => {
    render(<App />);
    const dialog = await dropFolder([folderFile('straight_run.ghostauto', '9999', 'Straight.ghostauto')]);
    // The shared Dialog moves initial focus onto the dialog container itself.
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fieldRobots()).toHaveLength(1);
    expect(fieldRobots()[0]!.teamAlliance).toBe('blue');
    expect(fieldRobots()[0]!.trajectory.samples[0]!.x).toBe(2);
  });

  it('Enter on a focused radio imports the chosen alliance exactly once', async () => {
    render(<App />);
    const dialog = await dropFolder([folderFile('straight_run.ghostauto', '9999', 'Straight.ghostauto')]);
    const red = within(within(dialog).getByRole('group', { name: 'Team alliance: 9999' })).getByRole('radio', { name: 'Red' });
    fireEvent.click(red);
    red.focus();
    fireEvent.keyDown(red, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fieldRobots()).toHaveLength(1);
    expect(fieldRobots()[0]!.teamAlliance).toBe('red');
    expect(fieldRobots()[0]!.trajectory.samples[0]!.x).toBeCloseTo(REBUILT_2026.lengthM - 2, 9);
  });

  it('clicking Import submits the native form exactly once — no double fire', async () => {
    render(<App />);
    const dialog = await dropFolder([folderFile('straight_run.ghostauto', '9999', 'Straight.ghostauto')]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fieldRobots()).toHaveLength(1);
  });

  it('Escape cancels the dialog without adding any robot', async () => {
    render(<App />);
    const dialog = await dropFolder([folderFile('straight_run.ghostauto', '9999', 'Straight.ghostauto')]);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryAllByTestId('field-2d')).toHaveLength(0);
  });
});

describe('per-robot alliance radio on the robot card', () => {
  it('exposes native labelled radios and corrects the team after import (undo/redo follow)', async () => {
    render(<App />);
    drop([pathFile('straight_run.ghostauto'), pathFile('side_lane.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    const row = rowAt(0);
    const group = within(row).getByRole('group', { name: /Team alliance/ });
    const blue = within(group).getByRole('radio', { name: 'Blue' });
    const red = within(group).getByRole('radio', { name: 'Red' });
    expect(blue).not.toBeChecked();
    expect(red).not.toBeChecked();
    const before = fieldRobots()[0]!.trajectory.samples[0]!.x;
    fireEvent.click(red);
    await waitFor(() => expect(fieldRobots()[0]!.teamAlliance).toBe('red'));
    expect(fieldRobots()[0]!.trajectory.samples[0]!.x).toBeCloseTo(REBUILT_2026.lengthM - before, 9);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    await waitFor(() => expect(fieldRobots()[0]!.teamAlliance).toBeUndefined());
    expect(fieldRobots()[0]!.trajectory.samples[0]!.x).toBe(before);
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    await waitFor(() => expect(fieldRobots()[0]!.teamAlliance).toBe('red'));
    expect(fieldRobots()[0]!.trajectory.samples[0]!.x).toBeCloseTo(REBUILT_2026.lengthM - before, 9);
  });
});

describe('conflict detail distinguishes teammates from opponents', () => {
  /** An inline .ghostauto whose states walk start→end along constant y. */
  function walkGhostauto(name: string, from: { x: number; y: number }, to: { x: number; y: number }, durationS = 4): File {
    const steps = 41;
    const states = Array.from({ length: steps }, (_, i) => {
      const t = (i / (steps - 1)) * durationS;
      return {
        t,
        x: from.x + ((to.x - from.x) * i) / (steps - 1),
        y: from.y + ((to.y - from.y) * i) / (steps - 1),
        rotation: 0, vx: 0, vy: 0, omega: 0, moduleStates: [],
      };
    });
    const doc = {
      version: '1.0', name, teamName: 'Team 0001',
      bumperSize: { width: 0.9, height: 0.9 }, bumperOffset: { x: 0, y: 0 }, holonomic: true,
      moduleLocations: [{ x: 0.3, y: 0.3 }, { x: 0.3, y: -0.3 }, { x: -0.3, y: 0.3 }, { x: -0.3, y: -0.3 }],
      states,
    };
    return new File([JSON.stringify(doc)], `${name}.ghostauto`);
  }

  it('badges the same-point teammates and the red-flipped opponent; none before any team is set', async () => {
    const L = REBUILT_2026.lengthM;
    const W = REBUILT_2026.widthM;
    render(<App />);
    // Blue robot A and its twin C start mid-width on the blue wall; B is
    // authored from the far wall — once marked red, its 180° symmetry lands
    // exactly on A's start, an opponents overlap at t=0.
    drop([
      walkGhostauto('a', { x: 2, y: W / 2 }, { x: 4, y: W / 2 }),
      walkGhostauto('b-far', { x: L - 2, y: W / 2 }, { x: L - 4, y: W / 2 }),
      walkGhostauto('c', { x: 2, y: W / 2 }, { x: 4, y: W / 2 }),
    ]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(3));
    // No team flags yet: exactly today’s panel, no relation badges.
    expect(screen.queryByText('teammates', { exact: false })).toBeNull();
    expect(screen.queryByText('opponents', { exact: false })).toBeNull();
    fireEvent.click(within(rowAt(0)).getByRole('radio', { name: 'Blue' }));
    await waitFor(() => expect(fieldRobots()[0]!.teamAlliance).toBe('blue'));
    fireEvent.click(within(rowAt(1)).getByRole('radio', { name: 'Red' }));
    await waitFor(() => expect(fieldRobots()[1]!.teamAlliance).toBe('red'));
    fireEvent.click(within(rowAt(2)).getByRole('radio', { name: 'Blue' }));
    await waitFor(() => expect(screen.getByText('teammates', { exact: false })).toBeInTheDocument());
    // B (red) sits on the same start point as both A and C → two opponent overlaps.
    expect(screen.getAllByText('opponents', { exact: false })).toHaveLength(2);
  });
});

describe('global view switch stays orthogonal to team alliances', () => {
  it('flips the view without touching flags; sessions round-trip both', async () => {
    render(<App />);
    drop([pathFile('straight_run.ghostauto'), pathFile('side_lane.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    fireEvent.click(within(rowAt(0)).getByRole('radio', { name: 'Red' }));
    await waitFor(() => expect(fieldRobots()[0]!.teamAlliance).toBe('red'));
    const redSourceX = fieldRobots()[0]!.trajectory.samples[0]!.x;
    // Global switch to the red view: every frame tag flips, no flag moves, and
    // the red team’s numbers come back to its authored coordinates.
    fireEvent.click(screen.getByRole('button', { name: 'Red', exact: true }));
    await waitFor(() => expect(fieldRobots().every((r) => r.trajectory.alliance === 'red')).toBe(true));
    expect(fieldRobots()[0]!.teamAlliance).toBe('red');
    expect(fieldRobots()[0]!.trajectory.samples[0]!.x).toBeCloseTo(REBUILT_2026.lengthM - redSourceX, 9);
    // Save in the red view and reload: the view, the flags and the blue-frame
    // sources all come back — the red team never flips twice.
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    const saved = vi.mocked(saveText).mock.calls.at(-1)![2];
    const payload = JSON.parse(saved);
    expect(payload.robots.some((r: { teamAlliance?: string }) => r.teamAlliance === 'red')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Blue', exact: true }));
    drop([new File([saved], 'mixed.pb')]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Red', exact: true })).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    const restoredRed = fieldRobots().find((r) => r.teamAlliance === 'red')!;
    expect(restoredRed.trajectory.alliance).toBe('red');
    expect(restoredRed.trajectory.samples[0]!.x).toBeCloseTo(REBUILT_2026.lengthM - redSourceX, 9);
  });
});
