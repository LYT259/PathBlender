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
import { REBUILT_2026, DEFAULT_GEOMETRY, makeSession, serializeSession, type SessionTrajectory } from '@pathblender/core';
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
    // Save moved to the File menu (2026-10-06): trigger the same handler via ⌘S.
    fireEvent.keyDown(window, { key: 's', metaKey: true });
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

describe('always-visible mirror button (2026-10-05)', () => {
  /** The per-card mirror button of one robot row. */
  const mirrorButton = (row: HTMLElement) => within(row).getByRole('button', { name: 'Mirror left/right' });
  const sessionRobot = (id: string, teamNumber: string, colorIndex: number, y = 2): SessionTrajectory =>
    makeSession({
      id,
      name: `Route ${teamNumber}`,
      teamName: '',
      teamNumber,
      source: 'choreo-traj',
      alliance: 'blue',
      durationS: 8,
      samples: [0, 8].map((t) => ({ t, x: 2 + t, y, heading: 0, vx: 1, vy: 0, omega: 0 })),
      geometry: DEFAULT_GEOMETRY,
      geometrySource: 'default',
      moduleLocations: [],
      events: [],
      warnings: [],
    }, colorIndex);

  it('toggling the button twice reflects the team and restores the exact poses', async () => {
    render(<App />);
    drop([new File([raw], 'A.ghostauto'), new File([raw], 'B.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    const before = fieldRobots();
    expect(mirrorButton(rows()[0]!)).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(mirrorButton(rows()[0]!));
    await waitFor(() => expect(fieldRobots()[0]!.trajectory.samples[0]!.y).toBeCloseTo(REBUILT_2026.widthM - before[0]!.trajectory.samples[0]!.y, 10));
    expect(mirrorButton(rows()[0]!)).toHaveAttribute('aria-pressed', 'true');
    // Toggling again is an involution — down to the last sample.
    fireEvent.click(mirrorButton(rows()[0]!));
    await waitFor(() => expect(fieldRobots()[0]!.trajectory.samples).toEqual(before[0]!.trajectory.samples));
    expect(mirrorButton(rows()[0]!)).toHaveAttribute('aria-pressed', 'false');
  });

  it('mirrors only the team whose button was clicked', async () => {
    render(<App />);
    drop([new File([raw], 'A.ghostauto'), new File([raw], 'B.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    const before = fieldRobots();
    fireEvent.click(mirrorButton(rows()[0]!));
    await waitFor(() => expect(fieldRobots()[0]!.trajectory.samples[0]!.y).toBeCloseTo(REBUILT_2026.widthM - before[0]!.trajectory.samples[0]!.y, 10));
    // Alliance never changes, x survives, and the second team is untouched.
    expect(fieldRobots().every((r) => r.trajectory.alliance === 'blue')).toBe(true);
    expect(fieldRobots()[0]!.trajectory.samples[0]!.x).toBeCloseTo(before[0]!.trajectory.samples[0]!.x, 10);
    expect(fieldRobots()[1]!.trajectory.samples).toEqual(before[1]!.trajectory.samples);
    expect(mirrorButton(rows()[1]!)).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the context menu and the visible button on the same state', async () => {
    render(<App />);
    drop([new File([raw], 'A.ghostauto'), new File([raw], 'B.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    // Button → menu: mirroring through the button shows the menu checked.
    fireEvent.click(mirrorButton(rows()[0]!));
    fireEvent.contextMenu(rows()[0]!);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Mirror left/right' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('menuitemcheckbox', { name: 'Mirror left/right' }), { key: 'Escape' });
    // Menu → button: mirroring the other team from its menu presses its button.
    menuAction(rows()[1]!, 'Mirror left/right');
    await waitFor(() => expect(mirrorButton(rows()[1]!)).toHaveAttribute('aria-pressed', 'true'));
    expect(mirrorButton(rows()[0]!)).toHaveAttribute('aria-pressed', 'true');
  });

  it('mirrors an unselected team without stealing the selection or opening the composer', async () => {
    render(<App />);
    drop([new File([raw], 'A.ghostauto'), new File([raw], 'B.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    fireEvent.click(within(rows()[0]!).getByRole('button', { name: /#0001, Ghost/ }));
    // The button targets its own team: the selection stays on team 0001 and
    // no composer opens for the mirrored team.
    fireEvent.click(mirrorButton(rows()[1]!));
    await waitFor(() => expect(mirrorButton(rows()[1]!)).toHaveAttribute('aria-pressed', 'true'));
    expect(within(rows()[0]!).getByRole('button', { name: /#0001, Ghost/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(rows()[1]!).getByRole('button', { name: /#0001, Ghost/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Back to playback' })).not.toBeInTheDocument();
  });

  it('pauses playback and keeps the playhead where it was', async () => {
    render(<App />);
    drop([new File([raw], 'A.ghostauto'), new File([raw], 'B.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    const before = fieldRobots();
    const clock = () => screen.getByRole('slider', { name: 'Playback position' }).getAttribute('aria-valuetext')!;
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play', exact: true }));
    expect(screen.getByRole('button', { name: 'Pause', exact: true })).toBeInTheDocument();
    const playhead = clock();
    expect(playhead).toMatch(/^2\.00 \//);
    // The click pauses; the playhead never moves and the pose still reflects.
    fireEvent.click(mirrorButton(rows()[0]!));
    await waitFor(() => expect(fieldRobots()[0]!.trajectory.samples[0]!.y).toBeCloseTo(REBUILT_2026.widthM - before[0]!.trajectory.samples[0]!.y, 10));
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeInTheDocument();
    expect(clock()).toBe(playhead);
  });

  it('undoes a mirror made through the visible button', async () => {
    render(<App />);
    drop([new File([raw], 'A.ghostauto'), new File([raw], 'B.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    const before = fieldRobots();
    fireEvent.click(mirrorButton(rows()[0]!));
    await waitFor(() => expect(fieldRobots()[0]!.trajectory.samples[0]!.y).toBeCloseTo(REBUILT_2026.widthM - before[0]!.trajectory.samples[0]!.y, 10));
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    await waitFor(() => expect(fieldRobots()[0]!.trajectory.samples).toEqual(before[0]!.trajectory.samples));
    expect(mirrorButton(rows()[0]!)).toHaveAttribute('aria-pressed', 'false');
  });

  it('restores a saved session with the mirrored team shown as pressed', async () => {
    const a = { ...sessionRobot('robot-a', '0001', 0), mirrored: true };
    const b = sessionRobot('robot-b', '0002', 1, 6);
    localStorage.setItem('pb.autosave.v1', JSON.stringify(JSON.parse(serializeSession([a, b], 'rebuilt-2026'))));
    render(<App />);
    await screen.findByRole('button', { name: /#0002, Choreo/ });
    expect(mirrorButton(rows()[0]!)).toHaveAttribute('aria-pressed', 'true');
    expect(mirrorButton(rows()[1]!)).toHaveAttribute('aria-pressed', 'false');
    // The restored flag drives the same derivation: the pose is reflected.
    expect(fieldRobots()[0]!.trajectory.samples[0]!.y).toBeCloseTo(REBUILT_2026.widthM - 2, 10);
  });
});
