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
beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); });
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
  it('closes the more menu on an outside pointer or Escape', async () => {
    render(<App />);
    fireEvent.drop(window, { dataTransfer: { files: [new File([raw], 'A.ghostauto')] } });
    await waitFor(() => expect(document.querySelector('.workspace-menu')).not.toBeNull());
    const menu = document.querySelector('.workspace-menu') as HTMLDetailsElement;
    menu.open = true; fireEvent.pointerDown(document.body); expect(menu.open).toBe(false);
    menu.open = true; fireEvent.keyDown(document.body, { key: 'Escape' }); expect(menu.open).toBe(false);
  });
});
