import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTrajectory } from '@pathblender/core';
import { App } from '../src/App';
vi.mock('../src/components/FieldCanvas', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas: forwardRef((props: { robots: SessionTrajectory[]; currentT: number }, _ref) => <div data-testid="field">{JSON.stringify(props)}</div>) };
});
const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
/** stop_and_score crosses straight_run's lane at (7.5, 2): committed 0 s
 * starts collide there (~3.8–5.3 s), but once straight_run slips to a 10 s
 * start their parked poses and driven legs never meet — the pair a live
 * drag rehearsal can actually clear. */
const crossRaw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/stop_and_score.ghostauto'), 'utf8');
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('pb.lang', 'en');
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
const field = () => JSON.parse(screen.getByTestId('field').textContent!);
/** B's file content: the same run translated to start exactly where A ends, so the playhead-gated route library keeps B draggable after A. */
const chainedRaw = (() => {
  const doc = JSON.parse(raw);
  const states: { x: number; y: number }[] = doc.states;
  const dx = states[states.length - 1]!.x - states[0]!.x;
  const dy = states[states.length - 1]!.y - states[0]!.y;
  return JSON.stringify({ ...doc, states: states.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })) });
})();
describe('composer hover preview in the real app', () => {
  it('temporarily isolates the hovered route and leaves saved composition, history and playback position intact', async () => {
    render(<App />);
    const files = ['team/A', 'team/B', 'other/C'].map((name) => {
      const file = new File([name === 'team/B' ? chainedRaw : raw], `${name.split('/')[1]}.ghostauto`, { type: 'application/json' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `${name}.ghostauto` }); return file;
    });
    fireEvent.drop(window, { dataTransfer: { files } });
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2));
    fireEvent.doubleClick(document.querySelector('.timeline-activity')!);
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '9' } });
    const before = field();
    const autosaved = JSON.parse(localStorage.getItem('pb.autosave.v1')!);
    const source = screen.getByRole('button', { name: 'B: 8.30 s' });
    fireEvent.pointerEnter(source);
    expect(field().robots).toHaveLength(1);
    expect(field().currentT).toBe(0);
    expect(field().robots[0].startDelayS).toBe(0);
    expect(JSON.parse(localStorage.getItem('pb.autosave.v1')!).robots).toEqual(autosaved.robots);
    fireEvent.pointerLeave(source);
    expect(field()).toEqual(before);
    const undo = screen.getByRole('button', { name: 'Undo', exact: true });
    fireEvent.pointerDown(undo); fireEvent.click(undo);
    expect(document.querySelector('.sequence-composer')).toBeNull();
  });
  it('previews a placed leg when its clip is hovered or focused, and restores on leave', async () => {
    render(<App />);
    const files = ['team/A', 'other/B'].map((name) => {
      const file = new File([raw], `${name.split('/')[1]}.ghostauto`, { type: 'application/json' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `${name}.ghostauto` }); return file;
    });
    fireEvent.drop(window, { dataTransfer: { files } });
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2));
    fireEvent.doubleClick(document.querySelector('.timeline-activity')!);
    await waitFor(() => expect(document.querySelector('.sequence-composer')).not.toBeNull());
    const before = field();
    expect(before.robots).toHaveLength(2);
    const clip = document.querySelector('.sequence-track.is-editing .sequence-clip')!;
    fireEvent.pointerEnter(clip);
    expect(field().robots).toHaveLength(1);
    expect(field().robots[0].sequence).toBeUndefined();
    fireEvent.pointerLeave(clip);
    expect(field()).toEqual(before);
    // Keyboard parity: focus previews the leg exactly like a hover.
    fireEvent.focus(clip);
    expect(field().robots).toHaveLength(1);
    fireEvent.blur(clip);
    expect(field()).toEqual(before);
    // A clip on a reference track (another robot) previews through THAT
    // team's own library (user 2026-10-08) and restores on leave.
    const referenceClip = document.querySelector('.sequence-track:not(.is-editing) .sequence-clip')!;
    fireEvent.pointerEnter(referenceClip);
    expect(field().robots).toHaveLength(1);
    expect(field().robots[0].sequence).toBeUndefined();
    fireEvent.pointerLeave(referenceClip);
    expect(field()).toEqual(before);
  });
  it('takes an empty-arrangement robot off the field — no sprite, no phantom collision', async () => {
    // User 2026-10-08: with every leg removed the robot is not "parked",
    // it is not running an auto — 2D/3D show nothing and the 0-second
    // parked-vs-parked collision disappears.
    render(<App />);
    const files = ['team/A', 'other/B'].map((name) => {
      const file = new File([raw], `${name.split('/')[1]}.ghostauto`, { type: 'application/json' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `${name}.ghostauto` }); return file;
    });
    fireEvent.drop(window, { dataTransfer: { files } });
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2));
    fireEvent.doubleClick(document.querySelector('.timeline-activity')!);
    await waitFor(() => expect(document.querySelector('.sequence-composer')).not.toBeNull());
    // Remove the only leg of the edited robot, then leave the composer.
    const clip = document.querySelector('.sequence-track.is-editing .sequence-clip')!;
    fireEvent.click(clip);
    fireEvent.keyDown(document.querySelector('.sequence-track.is-editing .sequence-track-lane')!, { key: 'Delete' });
    await waitFor(() => expect(document.querySelectorAll('.sequence-clip')).toHaveLength(1)); // the other team's remains
    fireEvent.click(screen.getByRole('button', { name: 'Back to playback' }));
    await waitFor(() => expect(document.querySelector('.sequence-composer')).toBeNull());
    expect(field().robots).toHaveLength(1);
    expect(field().conflicts).toHaveLength(0);
    // Its sidebar row stays (the arrangement is still editable) and is
    // marked as the empty one.
    expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2);
  });

  it('unhides a robot when the user switches to it — selection is the intent to look', async () => {
    // User 2026-10-08: with every robot hidden, selecting one from the
    // list must bring it back (the click used to appear to do nothing).
    render(<App />);
    const files = ['team/A', 'other/B'].map((name) => {
      const file = new File([raw], `${name.split('/')[1]}.ghostauto`, { type: 'application/json' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `${name}.ghostauto` }); return file;
    });
    fireEvent.drop(window, { dataTransfer: { files } });
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2));
    expect(field().robots).toHaveLength(2);
    // Both imports carry no team digits, so both rows read #0001 — select
    // structurally: the second row's eye, then the second row's card.
    const rows = () => [...document.querySelectorAll('.robot-library-row')];
    const rowButtons = (row: Element) => [...row.querySelectorAll('button')] as HTMLButtonElement[];
    fireEvent.click(rowButtons(rows()[1]!).find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Hide'))!);
    await waitFor(() => expect(field().robots).toHaveLength(1));
    // Selecting B unhides it again.
    fireEvent.click(rowButtons(rows()[1]!).find((b) => b.getAttribute('aria-pressed') !== null)!);
    await waitFor(() => expect(field().robots).toHaveLength(2));
  });
  it('the ⋯ more menu is gone — A-B compare and help live on the toolbar (2026-10-10)', async () => {
    render(<App />);
    fireEvent.drop(window, { dataTransfer: { files: [new File([raw], 'A.ghostauto')] } });
    await waitFor(() => expect(document.querySelector('.workspace-menu')).toBeNull());
  });
});

describe('composer drag what-if in the real app (user 2026-10-11)', () => {
  /** straight_run (edited robot) + stop_and_score crossing its lane — the
   *  committed 0 s/0 s layout collides, a 10 s start clears it. */
  const importPair = async () => {
    render(<App />);
    const files = (['team/A', 'other/B'] as const).map((name) => {
      const file = new File([name === 'other/B' ? crossRaw : raw], `${name.split('/')[1]}.ghostauto`, { type: 'application/json' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `${name}.ghostauto` }); return file;
    });
    fireEvent.drop(window, { dataTransfer: { files } });
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2));
  };
  const openComposer = async () => {
    fireEvent.doubleClick(document.querySelector('.timeline-activity')!);
    await waitFor(() => expect(document.querySelector('.sequence-composer')).not.toBeNull());
  };
  const lane = () => document.querySelector('.sequence-track.is-editing .sequence-track-lane') as HTMLElement;
  const clip = () => document.querySelector('.sequence-track.is-editing .sequence-clip') as HTMLElement;
  const badges = () => document.querySelectorAll('.robot-library-conflict');
  const autosavedRobots = () => JSON.parse(localStorage.getItem('pb.autosave.v1')!).robots;
  // REBUILT 2026 auto is 20 s over 1000 px = 50 px/s: clientX 10 → 510 is
  // exactly +10.0 s on the 0.1 s snap grid (candidate 10.0–18.3 s, legal).
  const mockLane = () => vi.spyOn(lane(), 'getBoundingClientRect')
    .mockReturnValue({ left: 0, top: 100, right: 1000, bottom: 194, width: 1000, height: 94, x: 0, y: 100, toJSON: () => {} });
  const dragTo10s = () => {
    fireEvent.pointerDown(clip(), { button: 0, clientX: 10, clientY: 130 });
    fireEvent.pointerMove(clip(), { clientX: 510, clientY: 130 });
  };
  const undoButton = () => screen.getByRole('button', { name: 'Undo', exact: true });

  it('rehearses the candidate on the field and in the collision badges mid-drag, commits only on release', async () => {
    await importPair();
    await waitFor(() => expect(badges()).toHaveLength(2)); // both rows collide at 0 s
    await openComposer();
    mockLane();
    const ids = field().robots.map((r: SessionTrajectory) => r.trajectory.id).sort();
    const autosavedBefore = autosavedRobots();
    dragTo10s();
    // Mid-drag: every unhidden robot stays on the field, the dragged one
    // already runs its candidate 10 s start — the collision is rehearsed away.
    expect(field().robots.map((r: SessionTrajectory) => r.trajectory.id).sort()).toEqual(ids);
    const dragged = field().robots.find((r: SessionTrajectory) => r.startDelayS > 0)!;
    expect(dragged.startDelayS).toBeCloseTo(10, 5);
    expect(badges()).toHaveLength(0);
    // …but nothing has persisted: autosave still holds the committed layout.
    expect(autosavedRobots()).toEqual(autosavedBefore);
    fireEvent.pointerUp(clip(), { clientX: 510, clientY: 130 });
    // Release commits through the normal path: badges stay clear, the edit
    // lands in history (one Undo restores the collision), autosave follows.
    expect(badges()).toHaveLength(0);
    await waitFor(() => expect(autosavedRobots()).not.toEqual(autosavedBefore));
    expect(autosavedRobots().some((r: SessionTrajectory) => Math.abs(r.startDelayS - 10) < 1e-9)).toBe(true);
    fireEvent.pointerDown(undoButton()); fireEvent.click(undoButton());
    await waitFor(() => expect(badges()).toHaveLength(2));
    expect(document.querySelector('.sequence-composer')).not.toBeNull(); // the edit was undone, not the composer
  });

  it('Escape mid-drag restores the committed arrangement — no history entry, no autosave write', async () => {
    await importPair();
    await waitFor(() => expect(badges()).toHaveLength(2));
    await openComposer();
    mockLane();
    const before = field();
    const autosavedBefore = autosavedRobots();
    dragTo10s();
    expect(badges()).toHaveLength(0); // the rehearsal really happened
    expect(field().robots.some((r: SessionTrajectory) => r.startDelayS > 0)).toBe(true);
    fireEvent.keyDown(clip(), { key: 'Escape' });
    // Next render is the committed layout again, badges and all.
    expect(field()).toEqual(before);
    expect(badges()).toHaveLength(2);
    expect(autosavedRobots()).toEqual(autosavedBefore);
    // A late pointer-up after the cancel must not commit the ghost.
    fireEvent.pointerUp(clip(), { clientX: 510, clientY: 130 });
    expect(field()).toEqual(before);
    // History holds no phantom edit: one Undo closes the composer (the same
    // state as if the drag never happened), it does not revert an arrangement.
    fireEvent.pointerDown(undoButton()); fireEvent.click(undoButton());
    expect(document.querySelector('.sequence-composer')).toBeNull();
    expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2);
  });

  it('pressing a placed clip retires the hover preview immediately, before any movement', async () => {
    await importPair();
    await openComposer();
    mockLane();
    const before = field();
    expect(before.robots).toHaveLength(2);
    fireEvent.pointerEnter(clip());
    expect(field().robots).toHaveLength(1); // isolated hover preview
    fireEvent.pointerDown(clip(), { button: 0, clientX: 10, clientY: 130 });
    expect(field()).toEqual(before); // preview dead, nothing dragged yet
    fireEvent.pointerUp(clip(), { clientX: 10, clientY: 130 });
    expect(field()).toEqual(before);
  });

  it('keeps hidden robots out of the field and the checks while rehearsing', async () => {
    await importPair();
    const rows = () => [...document.querySelectorAll('.robot-library-row')];
    const rowButtons = (row: Element) => [...row.querySelectorAll('button')] as HTMLButtonElement[];
    fireEvent.click(rowButtons(rows()[1]!).find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Hide'))!);
    await waitFor(() => expect(field().robots).toHaveLength(1));
    await openComposer(); // opens the first (visible) robot
    mockLane();
    dragTo10s();
    // The rehearsal is live for the visible robot…
    expect(field().robots).toHaveLength(1);
    expect(field().robots[0]!.startDelayS).toBeCloseTo(10, 5);
    // …while the hidden one neither renders nor collides — no badge appears.
    expect(badges()).toHaveLength(0);
    fireEvent.pointerUp(clip(), { clientX: 510, clientY: 130 });
    expect(field().robots).toHaveLength(1);
    expect(badges()).toHaveLength(0);
  });
});
