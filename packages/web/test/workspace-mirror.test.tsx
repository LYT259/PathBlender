/**
 * Per-team left/right mirror (user-approved, 2026-10-05): the context menu
 * toggles a slot flag, the alliance view derives the reflection — poses,
 * compositions and saved sessions all follow, undo walks it back, and the
 * other teams never move.
 */
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

const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
const drop = (files: File[]) => fireEvent.drop(window, { dataTransfer: { files } });
const fieldRobots = (): SessionTrajectory[] => JSON.parse(screen.getByTestId('field-2d').textContent!);
const rows = () => [...document.querySelectorAll('.robot-library-row')] as HTMLElement[];
const rowFor = async (label: string) => {
  await waitFor(() => expect(rows().some((r) => r.textContent?.includes(label))).toBe(true));
  return rowFor(label);
};
/** Right-click a team row and run a context-menu item by name. */
function menuAction(row: HTMLElement, item: string) {
  fireEvent.contextMenu(row);
  const menu = screen.getByRole('menu');
  const target = [...menu.querySelectorAll('button')].find((b) => b.textContent?.includes(item))!;
  fireEvent.click(target);
}

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterAll(() => new Promise((resolve) => setTimeout(resolve, 2600)));

describe('per-team left/right mirror', () => {
  it('reflects only the mirrored team across the long axis; the other team stays put', async () => {
    render(<App />);
    drop([new File([raw], 'A.ghostauto'), new File([raw], 'B.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    const before = fieldRobots();
    menuAction(rows()[0]!, 'Mirror left/right');
    await waitFor(() => expect(fieldRobots()[0]!.trajectory.samples[0]!.y).toBeCloseTo(REBUILT_2026.widthM - before[0]!.trajectory.samples[0]!.y, 10));
    // Alliance never changes, x survives, and the second team is untouched.
    expect(fieldRobots().every((r) => r.trajectory.alliance === 'blue')).toBe(true);
    expect(fieldRobots()[0]!.trajectory.samples[0]!.x).toBeCloseTo(before[0]!.trajectory.samples[0]!.x, 10);
    expect(fieldRobots()[1]!.trajectory.samples).toEqual(before[1]!.trajectory.samples);
    // The menu shows the checked state.
    fireEvent.contextMenu(rows()[0]!);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Mirror left/right' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('menuitemcheckbox', { name: 'Mirror left/right' }), { key: 'Escape' });
    // Toggling again is an involution.
    menuAction(rows()[0]!, 'Mirror left/right');
    await waitFor(() => expect(fieldRobots()[0]!.trajectory.samples[0]!.y).toBeCloseTo(before[0]!.trajectory.samples[0]!.y, 10));
  });

  it('mirrors a composed robot whole — sequence poses, waits and order follow the reflection', async () => {
    render(<App />);
    const files = ['A', 'B'].map((name) => {
      const file = new File([raw], `${name}.ghostauto`, { type: 'application/json' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `team/${name}.ghostauto` });
      return file;
    });
    drop(files);
    await waitFor(() => expect(rows()).toHaveLength(1));
    // Compose two routes in the composer, save, then mirror the team.
    fireEvent.click(within(rows()[0]!).getByRole('button', { name: 'Arrange timeline' }));
    fireEvent.click(screen.getByRole('button', { name: /^B: / }));
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to playback' }));
    const before = fieldRobots()[0]!;
    menuAction(rows()[0]!, 'Mirror left/right');
    await waitFor(() => expect(fieldRobots()[0]!.trajectory.samples[0]!.y).toBeCloseTo(REBUILT_2026.widthM - before.trajectory.samples[0]!.y, 10));
    // Duration, segment count and per-sample timing survive the reflection.
    expect(fieldRobots()[0]!.trajectory.durationS).toBe(before.trajectory.durationS);
    expect(fieldRobots()[0]!.trajectory.samples.map((s) => s.t)).toEqual(before.trajectory.samples.map((s) => s.t));
  });

  it('mirrors under the red alliance view, persists the flag in a saved session, and undoes', async () => {
    render(<App />);
    drop([new File([raw], 'A.ghostauto'), new File([raw], 'B.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    fireEvent.click(within(screen.getByRole('group', { name: 'alliance' })).getByRole('button', { name: 'Red', exact: true }));
    const redView = fieldRobots();
    menuAction(rows()[0]!, 'Mirror left/right');
    await waitFor(() => expect(fieldRobots()[0]!.trajectory.samples[0]!.y).toBeCloseTo(REBUILT_2026.widthM - redView[0]!.trajectory.samples[0]!.y, 10));
    fireEvent.click(screen.getAllByRole('button', { name: 'Save session', exact: true })[0]!);
    const stored = JSON.parse(vi.mocked(saveText).mock.calls.at(-1)![2]);
    expect(stored.robots[0].mirrored).toBe(true);
    expect(stored.robots[1].mirrored).toBeUndefined();
    // Undo reverts the mirror (and only it — the alliance flip stays).
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    await waitFor(() => expect(fieldRobots()[0]!.trajectory.samples[0]!.y).toBeCloseTo(redView[0]!.trajectory.samples[0]!.y, 10));
  });

  it('removes a team through the context menu without touching its source files or the others', async () => {
    render(<App />);
    drop([new File([raw], 'A.ghostauto'), new File([raw], 'B.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    const before = fieldRobots();
    menuAction(rows()[0]!, 'Remove from session');
    await waitFor(() => expect(fieldRobots()).toHaveLength(1));
    // The second slot's data survives untouched — only the session slot goes.
    expect(fieldRobots()[0]!.trajectory.id).toBe(before[1]!.trajectory.id);
    // The inspector no longer offers removal; the context menu was the path.
    fireEvent.click(within(rows()[0]!).getByRole('button', { name: /#0001, Ghost/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Robot', exact: true }));
    expect(screen.queryByRole('button', { name: 'Remove from session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Robot actions' })).not.toBeInTheDocument();
    // Undo brings the slot back.
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
  });
});
