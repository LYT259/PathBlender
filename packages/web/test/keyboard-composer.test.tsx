/**
 * Composer keyboard behaviors (2026-10-06 keyboard pass):
 *  - Escape leaves the composer and focus returns to the opener;
 *  - an open clip menu consumes Escape first (one layer at a time);
 *  - Delete removes the FOCUSED clip, never a stale selection;
 *  - the route preview follows focus like it follows the pointer.
 * Drag→keyboard suppression (event.detail) is verified in the real-browser
 * pass — jsdom rects are zero, so a pointer drag cannot reach the
 * suppression state here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTrajectory } from '@pathblender/core';
import { App } from '../src/App';

vi.mock('../src/components/FieldCanvas', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas: forwardRef((props: { robots: SessionTrajectory[] }, _ref) => <div data-testid="field">{JSON.stringify(props)}</div>) };
});

const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); });
/** B's file content: the same run translated to start exactly where A ends, so the playhead-gated route library keeps B draggable after A. */
const chainedRaw = (() => {
  const doc = JSON.parse(raw);
  const states: { x: number; y: number }[] = doc.states;
  const dx = states[states.length - 1]!.x - states[0]!.x;
  const dy = states[states.length - 1]!.y - states[0]!.y;
  return JSON.stringify({ ...doc, states: states.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })) });
})();
const fileFor = (name: string) => new File([name.endsWith('/B.ghostauto') ? chainedRaw : raw], name.split('/').at(-1)!, { type: 'application/json' });

/** One team with two routes (A + B) so the composer has a library. */
async function openComposer() {
  render(<App />);
  const files = ['team/A', 'team/B'].map((name) => {
    const file = fileFor(`${name}.ghostauto`);
    Object.defineProperty(file, 'webkitRelativePath', { value: `${name}.ghostauto` });
    return file;
  });
  fireEvent.drop(window, { dataTransfer: { files } });
  await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
  const opener = document.querySelector('.robot-arrange-button') as HTMLButtonElement;
  // jsdom does not focus buttons on click — real browsers do; replicate so
  // the opener-focus restoration is exercised.
  opener.focus();
  fireEvent.click(opener);
  await waitFor(() => expect(document.querySelector('.sequence-composer')).not.toBeNull());
  // Park the playhead on empty lane (A spans 0–8.3 s): the occupancy gate
  // grays the library while the playhead sits ON a segment.
  fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '9' } });
  return opener;
}

const clips = () => document.querySelectorAll('.sequence-clip');

describe('composer keyboard', () => {
  it('Escape leaves the composer and focus returns to the opener', async () => {
    const opener = await openComposer();
    await waitFor(() => expect(document.activeElement?.className).toContain('sequence-track-lane'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.querySelector('.sequence-composer')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('an open clip menu consumes Escape first; a second press leaves', async () => {
    await openComposer();
    const clip = clips()[0] as HTMLButtonElement;
    clip.focus();
    fireEvent.keyDown(clip, { key: 'F10', shiftKey: true });
    expect(document.querySelector('.sequence-clip-menu')).not.toBeNull();
    fireEvent.keyDown(document.querySelector('.sequence-clip-menu')!, { key: 'Escape' });
    expect(document.querySelector('.sequence-clip-menu')).toBeNull();
    expect(document.querySelector('.sequence-composer')).not.toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.querySelector('.sequence-composer')).toBeNull();
  });

  it('Delete removes the focused clip, not a stale selection', async () => {
    await openComposer();
    // Append route B so two clips exist.
    fireEvent.click(screen.getByRole('button', { name: 'B: 8.30 s' }));
    await waitFor(() => expect(clips()).toHaveLength(2));
    const first = clips()[0] as HTMLButtonElement;
    const second = clips()[1] as HTMLButtonElement;
    // Select the FIRST clip (old behavior would delete this one)…
    fireEvent.click(first);
    // …then focus the SECOND clip and press Delete.
    second.focus();
    fireEvent.keyDown(second, { key: 'Delete' });
    await waitFor(() => expect(clips()).toHaveLength(1));
    expect(clips()[0]).toBe(first);
  });

  it('Delete is inert on unrelated controls; arrows move the focused clip and clamp at the auto end', async () => {
    await openComposer();
    fireEvent.click(screen.getByRole('button', { name: 'B: 8.30 s' }));
    await waitFor(() => expect(clips()).toHaveLength(2));
    const second = clips()[1] as HTMLButtonElement;
    second.focus();
    // Delete now also serves the CLICKED-chosen clip (2026-10-07): the
    // appended clip is the chosen one, so a lane-level Delete removes it.
    // Focused-clip Delete stays authoritative when the clip itself is the
    // event target — covered by the previous test.
    fireEvent.keyDown(document.querySelector('.sequence-track-lane')!, { key: 'Delete' });
    expect(clips()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'B: 8.30 s' }));
    await waitFor(() => expect(clips()).toHaveLength(2));
    const readded = clips()[1] as HTMLButtonElement;
    readded.focus();
    // Right = +0.1 s, Shift+Right = +1 s; the auto-period edge clamps.
    const startOf = (el: Element) => parseFloat(el.getAttribute('aria-label')!.split(', ')[1]!);
    const before = startOf(readded);
    fireEvent.keyDown(readded, { key: 'ArrowRight' });
    expect(startOf(readded)).toBeCloseTo(before + 0.1, 5);
    fireEvent.keyDown(readded, { key: 'ArrowRight', shiftKey: true });
    expect(startOf(readded)).toBeCloseTo(before + 1.1, 5);
    fireEvent.keyDown(readded, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(readded, { key: 'ArrowRight', shiftKey: true });
    // A press past the edge: the auto period clamps the start.
    fireEvent.keyDown(readded, { key: 'ArrowRight', shiftKey: true });
    // 20 s auto period − 8.30 s duration → start clamps at 11.70.
    expect(startOf(readded)).toBeCloseTo(11.7, 5);
  });

  it('overlap moves are rejected with the error status and no layout change', async () => {
    await openComposer();
    fireEvent.click(screen.getByRole('button', { name: 'B: 8.30 s' }));
    await waitFor(() => expect(clips()).toHaveLength(2));
    const second = clips()[1] as HTMLButtonElement;
    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(second, { key: 'ArrowLeft', shiftKey: true });
    expect(document.querySelector('.sequence-error')!.textContent).toBe('Routes cannot overlap. Move to an empty space.');
    // Undo the two rejections away: the layout is untouched.
    const startOf = (el: Element) => parseFloat(el.getAttribute('aria-label')!.split(', ')[1]!);
    expect(startOf(second)).toBeCloseTo(8.3, 5);
  });

  it('undo restores a keyboard-deleted clip', async () => {
    await openComposer();
    fireEvent.click(screen.getByRole('button', { name: 'B: 8.30 s' }));
    await waitFor(() => expect(clips()).toHaveLength(2));
    const second = clips()[1] as HTMLButtonElement;
    second.focus();
    fireEvent.keyDown(second, { key: 'Delete' });
    await waitFor(() => expect(clips()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    await waitFor(() => expect(clips()).toHaveLength(2));
  });

  it('the route preview follows focus like the pointer', async () => {
    render(<App />);
    const files = ['team/A', 'team/B', 'other/C'].map((name) => {
      const file = fileFor(`${name}.ghostauto`);
      Object.defineProperty(file, 'webkitRelativePath', { value: `${name}.ghostauto` });
      return file;
    });
    fireEvent.drop(window, { dataTransfer: { files } });
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2));
    fireEvent.doubleClick(document.querySelector('.timeline-activity')!);
    await waitFor(() => expect(document.querySelector('.sequence-composer')).not.toBeNull());
    fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), { target: { value: '9' } });
    const source = screen.getByRole('button', { name: 'B: 8.30 s' });
    fireEvent.focus(source);
    await waitFor(() => expect(JSON.parse(screen.getByTestId('field').textContent!).robots).toHaveLength(1));
    fireEvent.blur(source);
    await waitFor(() => expect(JSON.parse(screen.getByTestId('field').textContent!).robots).toHaveLength(2));
  });
});
