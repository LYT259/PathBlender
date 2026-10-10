import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REBUILT_2026, activeEndT, checkSequenceJoins, makeSession, parseGhostAuto, samplePoseAt, type SessionTrajectory, type Trajectory } from '@pathblender/core';
import { I18nProvider } from '../src/i18n';
import { SequenceTimelineComposer } from '../src/components/SequenceTimelineComposer';
import { applySequenceSegments, sequenceViewFor, type AutoSequenceSegment } from '../src/auto-sequence-state';
import { canPlaceClip, clipsFor, sameClipLayout, segmentsFromClips, snapClipStart, boundedClipStart, clipGaps } from '../src/sequence-timeline-clips';
import { expectComboboxValue, pickComboboxValue } from './combobox';

const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
/** Samples of the base route translated `times` legs down the chain: the
 * copy starts exactly where the previous leg ends, so the playhead-gated
 * library keeps B draggable after A and C draggable after B. */
function shiftedToChain(base: Trajectory, times = 1): Trajectory['samples'] {
  const first = base.samples[0]!;
  const last = base.samples.at(-1)!;
  return base.samples.map((s) => ({
    ...s,
    x: s.x + (last.x - first.x) * times,
    y: s.y + (last.y - first.y) * times,
    heading: s.heading + (last.heading - first.heading) * times,
  }));
}
function fixture(id = 'one', duration = 4): SessionTrajectory {
  const trajectory = { ...parseGhostAuto(raw, 'A.ghostauto'), id, teamNumber: id, name: 'A', durationS: duration };
  // A: (2,2)→(11.96,2); B starts at A's end; C starts at B's end. The
  // original A is the blocked case at every anchor.
  return { ...makeSession(trajectory), routeId: 'a', routeOptions: [
    { id: 'a', relPath: 'A.ghostauto', trajectory },
    { id: 'b', relPath: 'B.ghostauto', trajectory: { ...trajectory, id: `${id}-b`, name: 'B', durationS: 3, samples: shiftedToChain(trajectory) } },
    { id: 'c', relPath: 'C.ghostauto', trajectory: { ...trajectory, id: `${id}-c`, name: 'C', durationS: 3, samples: shiftedToChain(trajectory, 2) } },
  ] };
}


function LiveHarness({ robot = fixture(), autoPeriodS = 20, onCommit = () => {}, onClose = vi.fn(), t = 5, setT = vi.fn() }: {
  robot?: SessionTrajectory; autoPeriodS?: number; onCommit?: (r: SessionTrajectory) => void; onClose?: () => void; t?: number; setT?: (v: number) => void;
}) {
  const [saved, setSaved] = useState(robot);
  const [playing, setPlaying] = useState(false);
  // Stateful playhead: scrub and append-advance move it for real, like App.
  const [now, setNow] = useState(t);
  return <I18nProvider><SequenceTimelineComposer robots={[saved]} selectedId={saved.trajectory.id} onSelect={vi.fn()} autoPeriodS={autoPeriodS}
    open onClose={onClose} onChange={(segments) => { const next = applySequenceSegments(saved, segments); setSaved(next); onCommit(next); }}
    joins={checkSequenceJoins(saved)} onJump={vi.fn()} playback={{ t: now, setT: (v) => { setNow(v); setT(v); }, playing, setPlaying, speed: 1, setSpeed: vi.fn() }} /></I18nProvider>;
}
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('pb.lang', 'en'); vi.clearAllMocks();
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
const activeLane = () => document.querySelector('.sequence-track.is-editing .sequence-track-lane') as HTMLElement;
const clips = () => within(activeLane()).queryAllByRole('button', { name: /, \d+\.\d+–/ });
// Default playhead t=5 sits on EMPTY lane (A spans 0–4 s): the occupancy
// gate grays the whole library while the playhead is ON a segment.
const addB = () => fireEvent.click(screen.getByRole('button', { name: /^B: \d+\.\d\d s$/ }));
const addC = () => fireEvent.click(screen.getByRole('button', { name: /^C: \d+\.\d\d s$/ }));
function geometry() {
  vi.spyOn(activeLane(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 100, right: 1000, bottom: 194, width: 1000, height: 94, x: 0, y: 100, toJSON: () => {} });
}
/** The route library sits above the lanes — the drop zone that deletes a
 *  dragged-out clip (user 2026-10-10). */
function libraryGeometry() {
  vi.spyOn(document.querySelector('.sequence-route-library') as HTMLElement, 'getBoundingClientRect')
    .mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 90, width: 1000, height: 90, x: 0, y: 0, toJSON: () => {} });
}
function drag(element: HTMLElement, fromX: number, toX: number, sourceY = 130, targetY = 130) {
  fireEvent.pointerDown(element, { button: 0, clientX: fromX, clientY: sourceY });
  fireEvent.pointerMove(element, { clientX: toX, clientY: targetY });
  fireEvent.pointerUp(element, { clientX: toX, clientY: targetY });
}
describe('timeline placement helpers', () => {
  const first = { id: 'a', routeId: 'a', startS: 2, durationS: 4.123456 };
  it('preserves imported duration, rejects overlap and allows exact seams', () => {
    const next = { id: 'b', routeId: 'b', startS: 6.123456, durationS: 3 };
    expect(canPlaceClip([first], { ...next, startS: 6.123455 })).toBe(false);
    expect(canPlaceClip([first], { ...next, startS: -1 })).toBe(false);
    expect(canPlaceClip([first], { ...next, startS: NaN })).toBe(false);
    expect(snapClipStart(6.15, [first], next, .1)).toBe(6.123456);
  });
  it('moves one clip across a neighbour without shifting the neighbour', () => {
    const next = { id: 'b', routeId: 'b', startS: 10, durationS: 3 };
    expect(snapClipStart(6.15, [first], next, .1)).toBe(6.123456);
  });
  it('semantic layout equality ignores ids and segment order but sees route, start and cut changes', () => {
    expect(sameClipLayout([{ id: 'x', routeId: 'a', startS: 1, durationS: 4 }, { id: 'y', routeId: 'b', startS: 5, durationS: 3 }], [{ id: 'p', routeId: 'b', startS: 5, durationS: 3 }, { id: 'q', routeId: 'a', startS: 1, durationS: 4 }])).toBe(true);
    expect(sameClipLayout([{ id: 'x', routeId: 'a', startS: 1, durationS: 4 }], [{ id: 'q', routeId: 'b', startS: 1, durationS: 4 }])).toBe(false);
    expect(sameClipLayout([{ id: 'x', routeId: 'a', startS: 1, durationS: 4 }], [{ id: 'q', routeId: 'a', startS: 1.000001, durationS: 4 }])).toBe(true);
    expect(sameClipLayout([{ id: 'x', routeId: 'a', startS: 1, durationS: 4 }], [{ id: 'q', routeId: 'a', startS: 1.1, durationS: 4 }])).toBe(false);
    // A partial-execution cut is a real arrangement change (user 2026-10-08).
    expect(sameClipLayout([{ id: 'x', routeId: 'a', startS: 1, durationS: 4 }], [{ id: 'q', routeId: 'a', startS: 1, durationS: 2 }])).toBe(false);
  });
  it('round-trips segments through clips without rounding waits or durations', () => {
    const robot = fixture('rt', 4.753697);
    const segments: AutoSequenceSegment[] = [
      { id: 's1', routeId: 'a', waitBeforeS: 1.5 },
      { id: 's2', routeId: 'b', waitBeforeS: 0.5000001, playS: 2 },
    ];
    const view = sequenceViewFor(applySequenceSegments(robot, segments));
    const roundTripped = segmentsFromClips(clipsFor(view.segments, view.routes));
    expect(roundTripped.map((s) => [s.id, s.routeId])).toEqual(segments.map((s) => [s.id, s.routeId]));
    // Waits are recomputed from clip boundaries; floating point may move the
    // last digit, imported durations stay bit-exact.
    expect(roundTripped[0]!.waitBeforeS).toBeCloseTo(1.5, 12);
    expect(roundTripped[1]!.waitBeforeS).toBeCloseTo(0.5000001, 12);
    // A partial-execution cut rides the round trip (user 2026-10-08).
    expect(roundTripped[1]!.playS).toBe(2);
    expect(clipsFor(view.segments, view.routes).map((c) => c.durationS)).toEqual([4.753697, 2]);
  });
});


describe('live arrangement editing', () => {
  it('clicks append even when another clip is selected, and commits immediately', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />);
    fireEvent.click(clips()[0]!);
    // Append advances the playhead to the new end, so C stays draggable —
    // chaining needs no scrub between appends.
    addB(); addC();
    expect(clips()).toHaveLength(3);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(activeEndT(commit.mock.calls[1]![0])).toBe(10);
    expect(clips()[0]!.querySelector('small')).toHaveTextContent('4.00s');
  });
  it('drops a library route at the pointer time, and a following click does not append twice', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />); geometry();
    const source = screen.getByRole('button', { name: 'B: 3.00 s' });
    drag(source, 20, 500, 30);
    fireEvent.click(source, { detail: 1 });
    expect(screen.getByRole('button', { name: 'B, 10.00–13.00 s' })).toBeInTheDocument();
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('snaps a library drop released below every lane into the editing lane at the pointer time (user 2026-10-10)', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />); geometry();
    // The screenshot case: the pointer released below the whole timeline —
    // the drag carries the EDITING robot's own library, so the release
    // snaps the route back into that lane at the pointer's time.
    drag(screen.getByRole('button', { name: 'B: 3.00 s' }), 20, 500, 30, 300);
    expect(screen.getByRole('button', { name: 'B, 10.00–13.00 s' })).toBeInTheDocument();
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('clamps a library drop past the lane left edge to a 0 s start (user 2026-10-10)', () => {
    const commit = vi.fn(); render(<LiveHarness robot={applySequenceSegments(fixture(), [])} onCommit={commit} />); geometry();
    const source = screen.getByRole('button', { name: 'B: 3.00 s' });
    fireEvent.pointerDown(source, { button: 0, clientX: 20, clientY: 30 });
    // 44 px left of the lane's left edge, inside the row band: the ghost
    // already sits at 0 s while the pointer is still outside the lane.
    fireEvent.pointerMove(source, { clientX: -44, clientY: 130 });
    const ghost = document.querySelector('.sequence-ghost');
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveTextContent('B');
    fireEvent.pointerUp(source, { clientX: -44, clientY: 130 });
    expect(screen.getByRole('button', { name: 'B, 0.00–3.00 s' })).toBeInTheDocument();
    expect(commit).toHaveBeenCalledTimes(1);
    // Starts AT the match beginning: the first wait is exactly zero.
    expect(sequenceViewFor(commit.mock.calls[0]![0]).segments[0]!.waitBeforeS).toBe(0);
  });
  it('snaps a library drop past the right edge against the auto end — a drop never fails (user 2026-10-10)', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />); geometry();
    // Nearest-edge snap: past the right edge the route butts against the
    // auto end (B, 3 s → 17–20) — the same end clamp a placed clip gets.
    drag(screen.getByRole('button', { name: 'B: 3.00 s' }), 20, 1100, 30);
    expect(screen.getByRole('button', { name: 'B, 17.00–20.00 s' })).toBeInTheDocument();
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('right-snaps an exact-fit route flush at 0 when the auto equals the route length', () => {
    const commit = vi.fn(); render(<LiveHarness robot={applySequenceSegments(fixture(), [])} autoPeriodS={3} onCommit={commit} />); geometry();
    drag(screen.getByRole('button', { name: 'B: 3.00 s' }), 20, 1200, 30);
    expect(screen.getByRole('button', { name: 'B, 0.00–3.00 s' })).toBeInTheDocument();
    expect(clips()[0]!.querySelector('small')).toHaveTextContent('3.00s'); // full length, no cut
  });
  it.each([15, 20])('clamps a moved route to the %s-second season boundary', (limit) => {
    const commit = vi.fn(); render(<LiveHarness autoPeriodS={limit} onCommit={commit} />); geometry();
    drag(clips()[0]!, 0, 2000);
    expect(activeEndT(commit.mock.calls[0]![0])).toBe(limit);
    expect(document.querySelector('.sequence-timing-warning')).toBeNull();
  });
  it('truncates an append that cannot fit to the remaining auto time', () => {
    const commit = vi.fn(); render(<LiveHarness autoPeriodS={6} onCommit={commit} />);
    addB(); // B (3 s) appended at 4 s with 2 s left — plays its first 2 s
    expect(commit).toHaveBeenCalledTimes(1);
    expect(clips()).toHaveLength(2);
    expect(activeEndT(commit.mock.calls[0]![0])).toBe(6);
    expect(clips()[1]!.querySelector('small')).toHaveTextContent('2.00s');
    fireEvent.click(clips()[0]!);
    const input = screen.getByRole('spinbutton', { name: 'Start' });
    fireEvent.change(input, { target: { value: '5' } }); fireEvent.blur(input);
    expect(commit).toHaveBeenCalledTimes(1); // numeric overrun still refused
  });
  it('drops an over-long route cut to what fits below the season boundary', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />); geometry();
    // Pointer at t=19.1: B (3 s) is cut to 0.9 s and lands 19.1–20.
    drag(screen.getByRole('button', { name: 'B: 3.00 s' }), 20, 955, 30);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(activeEndT(commit.mock.calls[0]![0])).toBe(20);
  });
  it('shows only the file name in the selected-route bar (user 2026-10-10)', () => {
    const base = fixture();
    const robot = { ...base, routeOptions: base.routeOptions.map((option) => option.id === 'b' ? { ...option, relPath: '8814/FCeSt.traj' } : option) };
    const commit = vi.fn(); render(<LiveHarness robot={robot} onCommit={commit} />);
    fireEvent.click(screen.getByRole('button', { name: 'FCeSt: 3.00 s' }));
    fireEvent.click(clips()[1]!); // choose the placed FCeSt leg
    const bar = document.querySelector('.sequence-selected-route')!;
    expect(bar).toHaveTextContent('FCeSt.traj');
    expect(bar).not.toHaveTextContent('8814');
  });
  it('edits any linked placement field and the others follow (user 2026-10-10)', () => {
    const robot = applySequenceSegments(fixture(), [
      { id: 'first', routeId: 'a', waitBeforeS: 0 },  // 0–4
      { id: 'middle', routeId: 'b', waitBeforeS: 2 }, // 6–9
      { id: 'last', routeId: 'a', waitBeforeS: 5 },   // 14–18
    ]);
    const commit = vi.fn(); render(<LiveHarness robot={robot} onCommit={commit} />);
    const field = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
    fireEvent.click(clips()[1]!); // middle: waits 2 s after the first, 5 s before the last
    expect(field('After previous').value).toBe('2.0');
    expect(field('Start').value).toBe('6.0');
    expect(field('End').value).toBe('9.0');
    expect(field('Before next').value).toBe('5.0');
    // Editing the after-previous wait repositions the leg; every field follows.
    fireEvent.change(field('After previous'), { target: { value: '3' } }); fireEvent.blur(field('After previous'));
    expect(field('After previous').value).toBe('3.0');
    expect(field('Start').value).toBe('7.0');
    expect(field('End').value).toBe('10.0');
    expect(field('Before next').value).toBe('4.0');
    // Editing the end repositions through the same linkage.
    fireEvent.change(field('End'), { target: { value: '12' } }); fireEvent.blur(field('End'));
    expect(field('Start').value).toBe('9.0');
    expect(field('End').value).toBe('12.0');
    expect(field('Before next').value).toBe('2.0');
    // Editing the before-next wait anchors on the next leg's start.
    fireEvent.change(field('Before next'), { target: { value: '1' } }); fireEvent.blur(field('Before next'));
    expect(field('Start').value).toBe('10.0');
    expect(field('After previous').value).toBe('6.0');
    // A placement that cannot work reverts the box and commits nothing.
    const calls = commit.mock.calls.length;
    fireEvent.change(field('End'), { target: { value: '25' } }); fireEvent.blur(field('End'));
    expect(field('End').value).toBe('13.0');
    expect(commit.mock.calls.length).toBe(calls);
    // First/last legs show only the neighbour side that exists.
    fireEvent.click(clips()[0]!);
    expect(screen.queryByRole('spinbutton', { name: 'After previous' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Before next' })).not.toBeNull();
    fireEvent.click(clips()[2]!);
    expect(screen.queryByRole('spinbutton', { name: 'After previous' })).not.toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Before next' })).toBeNull();
  });
  it('shows both gaps while dragging, updates before release and commits only once', () => {
    const robot = applySequenceSegments(fixture(), [
      { id: 'first', routeId: 'a', waitBeforeS: 0 },
      { id: 'middle', routeId: 'b', waitBeforeS: 2 },
      { id: 'last', routeId: 'a', waitBeforeS: 5 },
    ]);
    const commit = vi.fn(); render(<LiveHarness robot={robot} onCommit={commit} />); geometry();
    const middle = clips()[1]!;
    fireEvent.pointerDown(middle, { button: 0, clientX: 300, clientY: 130 });
    fireEvent.pointerMove(middle, { clientX: 400, clientY: 130 });
    expect(document.querySelector('.sequence-gap-guide.previous')).toHaveTextContent('4.00s');
    expect(document.querySelector('.sequence-gap-guide.next')).toHaveTextContent('3.00s');
    expect(commit).not.toHaveBeenCalled();
    fireEvent.pointerMove(middle, { clientX: 450, clientY: 130 });
    expect(document.querySelector('.sequence-gap-guide.previous')).toHaveTextContent('5.00s');
    expect(document.querySelector('.sequence-gap-guide.next')).toHaveTextContent('2.00s');
    fireEvent.pointerUp(middle);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('rejects an overlapping drop and cancels a move with Escape', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />); geometry();
    drag(screen.getByRole('button', { name: 'B: 3.00 s' }), 20, 50, 30);
    expect(commit).not.toHaveBeenCalled();
    fireEvent.pointerDown(clips()[0]!, { button: 0, clientX: 0, clientY: 130 });
    fireEvent.pointerMove(clips()[0]!, { clientX: 500, clientY: 130 });
    fireEvent.keyDown(clips()[0]!, { key: 'Escape' }); fireEvent.pointerUp(clips()[0]!);
    expect(commit).not.toHaveBeenCalled();
  });
  it('removes via context menu and Backspace, including the final route', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />); addB();
    fireEvent.contextMenu(clips()[1]!, { clientX: 300, clientY: 130 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove route' }));
    expect(clips()).toHaveLength(1);
    fireEvent.click(clips()[0]!); fireEvent.keyDown(clips()[0]!, { key: 'Backspace' });
    expect(clips()).toHaveLength(0);
    expect(activeEndT(commit.mock.calls.at(-1)![0])).toBe(0);
  });
  it('keeps Backspace in numeric inputs local and plays without closing the composer', () => {
    const close = vi.fn(); render(<LiveHarness onClose={close} />); fireEvent.click(clips()[0]!);
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Start' }), { key: 'Backspace' });
    expect(clips()).toHaveLength(1);
    const play = screen.getByRole('button', { name: 'Play' }); fireEvent.pointerDown(play); fireEvent.click(play);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument(); expect(close).not.toHaveBeenCalled();
  });
});

describe('bounded timing and live gap arithmetic', () => {
  it('keeps exact imported duration at a fractional season boundary', () => {
    const clip = { id: 'a', routeId: 'a', startS: 0, durationS: 4.753697 };
    const startS = boundedClipStart(25, [], clip, .1, 15);
    expect(startS + clip.durationS).toBe(15);
    expect(canPlaceClip([], { ...clip, startS }, 15)).toBe(true);
    expect(canPlaceClip([], { ...clip, startS: startS + .001 }, 15)).toBe(false);
  });
  it('reports negative overlap, exact joins and no nonexistent neighbours', () => {
    const a = { id: 'a', routeId: 'a', startS: 0, durationS: 4 };
    const b = { id: 'b', routeId: 'b', startS: 3, durationS: 2 };
    expect(clipGaps([a], b)).toEqual([{ fromS: 4, toS: 3, side: 'previous' }]);
    expect(clipGaps([a], { ...b, startS: 4 })).toEqual([{ fromS: 4, toS: 4, side: 'previous' }]);
    expect(clipGaps([], a)).toEqual([]);
  });
});

describe('playhead-gated route library', () => {
  const sources = () => [...document.querySelectorAll('.sequence-route-source')] as HTMLButtonElement[];
  const labels = () => sources().map((b) => b.getAttribute('aria-label')!.split(':')[0]);
  it('gates the FIRST leg by the ALLIANCE ZONE when the season defines one', () => {
    // Empty arrangement + 2026 zone (4.0284 m from the wall): A starts at
    // x=2 (inside), B/C start at the far end of the translated chain —
    // gray, with the zone reason, and un-addable (user 2026-10-08).
    const empty = applySequenceSegments(fixture(), []);
    localStorage.setItem('pb.lengthUnit', 'm');
    render(<I18nProvider><SequenceTimelineComposer robots={[empty]} selectedId={empty.trajectory.id} onSelect={vi.fn()}
      autoPeriodS={20} startZone={[{ xMinM: 0, xMaxM: 4.0284, yMinM: 0, yMaxM: 8.07 }]} open onClose={vi.fn()} onChange={vi.fn()} onJump={vi.fn()} /></I18nProvider>);
    expect(labels()).toEqual(['A', 'B', 'C']);
    const [a, b] = sources();
    expect(a).not.toHaveAttribute('aria-disabled');
    expect(b).toHaveAttribute('aria-disabled', 'true');
    expect(b!.getAttribute('aria-label')).toContain('legal starting area');
    const commit = vi.fn();
    // The grayed route refuses both gestures (drag: nothing lands).
    drag(b!, 20, 500, 30);
    expect(commit).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.sequence-clip')).toHaveLength(0);
  });
  it('hands the first-leg gate back to continuity once a leg exists', () => {
    // Same zone, but A is placed (0–4 s) and the playhead sits past it:
    // B (chained to A) is offered again — the zone only governs leg #1.
    const placed = applySequenceSegments(fixture(), [{ id: 's1', routeId: 'a', waitBeforeS: 0 }]);
    localStorage.setItem('pb.lengthUnit', 'm');
    render(<I18nProvider><SequenceTimelineComposer robots={[placed]} selectedId={placed.trajectory.id} onSelect={vi.fn()}
      autoPeriodS={20} startZone={[{ xMinM: 0, xMaxM: 4.0284, yMinM: 0, yMaxM: 8.07 }]} open onClose={vi.fn()} onChange={vi.fn()} onJump={vi.fn()}
      playback={{ t: 5, setT: vi.fn(), playing: false, setPlaying: vi.fn(), speed: 1, setSpeed: vi.fn() }} /></I18nProvider>);
    const [b, a] = sources();
    expect(labels()).toEqual(['B', 'A', 'C']);
    expect(b).not.toHaveAttribute('aria-disabled');
    expect(a).toHaveAttribute('aria-disabled', 'true');
  });
  it('grays, disables and demotes routes that do not continue the playhead segment', () => {
    // Playhead past A (0–4 s): B starts at A's end and stays draggable; A
    // itself (and anything starting elsewhere) is disabled, explains its
    // measured gap, and sorts after the draggable routes.
    localStorage.setItem('pb.lengthUnit', 'm');
    render(<LiveHarness t={5} />);
    expect(labels()).toEqual(['B', 'A', 'C']);
    const [b, a] = sources();
    expect(b).not.toHaveAttribute('aria-disabled');
    expect(a).toHaveAttribute('aria-disabled', 'true');
    expect(a!.getAttribute('aria-label')).toContain('position gap 9.96 m');
    expect(a!.getAttribute('aria-label')).toContain('heading gap 0.0°');
  });
  it('refuses adds from a grayed route — click and drag both commit nothing', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} t={5} />); geometry();
    const a = sources().find((b) => b.getAttribute('aria-label')?.startsWith('A: '))!;
    fireEvent.click(a);
    drag(a, 20, 500, 30);
    expect(commit).not.toHaveBeenCalled();
    expect(document.querySelector('.sequence-ghost')).toBeNull();
  });
  it('admits cm-scale chain gaps like real Choreo legs leave — the strict seam grade stays on the badges', () => {
    // Real hand-chained legs seam at 0.003–0.077 m / ≤1° (both example
    // libraries); the library gate refuses only teleports (user 2026-10-08:
    // an 0.077 m leg was refused by the 0.01 m gate).
    const base = fixture();
    const shift = (o: (typeof base.routeOptions)[number]) => ({
      ...o,
      trajectory: {
        ...o.trajectory,
        samples: o.trajectory.samples.map((s) => ({ ...s, x: s.x + 0.077, y: s.y - 0.02, heading: s.heading + Math.PI / 180 })),
      },
    });
    const gapped = { ...base, routeOptions: base.routeOptions.map((o) => o.id === 'b' ? shift(o) : o) };
    localStorage.setItem('pb.lengthUnit', 'm');
    render(<LiveHarness robot={gapped} t={5} />);
    const [b, a] = sources();
    // B now seams 0.08 m / 1° off A's end — drivable, so still offered.
    expect(labels()).toEqual(['B', 'A', 'C']);
    expect(b).not.toHaveAttribute('aria-disabled');
    expect(b!.getAttribute('aria-label')).not.toContain('position gap');
    // True teleports stay refused with their measured gap.
    expect(a).toHaveAttribute('aria-disabled', 'true');
    expect(a!.getAttribute('aria-label')).toContain('position gap 9.96 m');
  });
  it('pins the 6 in / 5° drivable-chain gate — different-spot starts stay refused', () => {
    // User decision 2026-10-08: 0.1524 m / 5°. Both refusals below mirror
    // real library pairs a 0.5 m / 15° gate would have admitted: L2→L12
    // seams 0.459 m at 0.2°, L13→M2 seams 0.266 m at 11.3°.
    const shift = (o: ReturnType<typeof fixture>['routeOptions'][number], dx: number, dh: number) => ({
      ...o,
      trajectory: {
        ...o.trajectory,
        samples: o.trajectory.samples.map((s) => ({ ...s, x: s.x + dx, heading: s.heading + dh })),
      },
    });
    localStorage.setItem('pb.lengthUnit', 'm');
    const gapped = (dx: number, dh: number) => ({ ...fixture(), routeOptions: fixture().routeOptions.map((o) => o.id === 'b' ? shift(o, dx, dh) : o) });
    let view = render(<LiveHarness robot={gapped(0.459, 0)} t={5} />);
    const bOf = () => sources().find((s) => s.getAttribute('aria-label')!.startsWith('B: '))!;
    expect(bOf()).toHaveAttribute('aria-disabled', 'true');
    expect(bOf().getAttribute('aria-label')).toContain('position gap 0.46 m');
    view.unmount();
    view = render(<LiveHarness robot={gapped(0.03, 11.3 * Math.PI / 180)} t={5} />);
    expect(bOf()).toHaveAttribute('aria-disabled', 'true');
    expect(bOf().getAttribute('aria-label')).toContain('heading gap 11.3°');
    view.unmount();
    // Just inside the gate (0.15 m < 6 in) the route stays drivable.
    view = render(<LiveHarness robot={gapped(0.15, 0)} t={5} />);
    expect(bOf()).not.toHaveAttribute('aria-disabled');
  });
  it('keeps every route available before the first segment starts', () => {
    const robot = applySequenceSegments(fixture(), [{ id: 'late', routeId: 'a', waitBeforeS: 2 }]);
    render(<LiveHarness robot={robot} t={1} />);
    expect(labels()).toEqual(['A', 'B', 'C']);
    expect(sources().every((b) => b.getAttribute('aria-disabled') !== 'true')).toBe(true);
  });
});

describe('lane scrub, chosen-delete, drag badge and occupancy gating', () => {
  const sources = () => [...document.querySelectorAll('.sequence-route-source')] as HTMLButtonElement[];
  const labels = () => sources().map((b) => b.getAttribute('aria-label')!.split(':')[0]);

  it('presses and drags empty lane space to scrub the playhead, clamped to the axis', () => {
    const setT = vi.fn(); render(<LiveHarness t={5} setT={setT} />); geometry();
    const lane = activeLane();
    // A press jumps straight to the pressed time.
    fireEvent.pointerDown(lane, { button: 0, clientX: 500, clientY: 130 });
    expect(setT).toHaveBeenLastCalledWith(10);
    // Dragging scrubs continuously; beyond the lane clamps to the season.
    fireEvent.pointerMove(lane, { clientX: 250, clientY: 130 });
    expect(setT).toHaveBeenLastCalledWith(5);
    fireEvent.pointerMove(lane, { clientX: 2000, clientY: 130 });
    expect(setT).toHaveBeenLastCalledWith(20);
    fireEvent.pointerMove(lane, { clientX: -80, clientY: 130 });
    expect(setT).toHaveBeenLastCalledWith(0);
    fireEvent.pointerUp(lane, { clientX: -80, clientY: 130 });
    // A clip press is a move gesture, never a scrub.
    const before = setT.mock.calls.length;
    fireEvent.pointerDown(clips()[0]!, { button: 0, clientX: 200, clientY: 130 });
    fireEvent.pointerUp(clips()[0]!, { clientX: 200, clientY: 130 });
    expect(setT.mock.calls.length).toBe(before);
  });

  it('Delete removes the CLICKED (chosen) clip even though the click did not focus it', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />);
    fireEvent.click(clips()[0]!); // jsdom clicks do not focus — same as desktop WebKit
    expect(document.activeElement).not.toBe(clips()[0]!);
    fireEvent.keyDown(activeLane(), { key: 'Delete' });
    expect(clips()).toHaveLength(0);
    expect(activeEndT(commit.mock.calls[0]![0])).toBe(0);
  });

  it('flies the badge off the lane and snaps the release back into the editing lane (user 2026-10-10)', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />); geometry();
    const source = screen.getByRole('button', { name: 'B: 3.00 s' });
    fireEvent.pointerDown(source, { button: 0, clientX: 20, clientY: 30 });
    // Off the lane the drag stays FREE: the route rides the pointer as the
    // badge — up and down at will — and no in-lane ghost pins it.
    fireEvent.pointerMove(source, { clientX: 300, clientY: 250 });
    expect(document.querySelector('.sequence-ghost')).toBeNull();
    const badge = document.querySelector('.sequence-drag-badge')!;
    expect(badge.textContent).toContain('B');
    expect(badge.textContent).toContain('3.00s');
    // Inside the lane the ghost takes over and the badge hides — ghost +
    // badge together would read as two copies of the same path.
    fireEvent.pointerMove(source, { clientX: 500, clientY: 130 });
    expect(document.querySelector('.sequence-ghost')).not.toBeNull();
    expect(document.querySelector('.sequence-drag-badge')).toBeNull();
    // Past the RIGHT edge the ghost shows the end-aligned slot: a drop never
    // fails — releasing there butts the route against the auto end.
    fireEvent.pointerMove(source, { clientX: 1100, clientY: 130 });
    expect(document.querySelector('.sequence-ghost')).not.toBeNull();
    fireEvent.pointerUp(source, { clientX: 1100, clientY: 130 });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'B, 17.00–20.00 s' })).toBeInTheDocument();
    // Releasing OFF the lane snaps the route back into it at the pointer's time.
    fireEvent.pointerDown(source, { button: 0, clientX: 20, clientY: 30 });
    fireEvent.pointerMove(source, { clientX: 500, clientY: 250 });
    fireEvent.pointerUp(source, { clientX: 500, clientY: 250 });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'B, 10.00–13.00 s' })).toBeInTheDocument();
    expect(document.querySelector('.sequence-drag-badge')).toBeNull();
  });
  it('dragging a placed clip out onto the library removes it — same flying badge (user 2026-10-10)', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />); geometry(); libraryGeometry();
    const clip = clips()[0]!;
    fireEvent.pointerDown(clip, { button: 0, clientX: 300, clientY: 130 });
    // Off the lane the SAME free-flight badge rides the pointer — no ghost.
    fireEvent.pointerMove(clip, { clientX: 300, clientY: 40 });
    expect(document.querySelector('.sequence-ghost')).toBeNull();
    const badge = document.querySelector('.sequence-drag-badge')!;
    expect(badge.textContent).toContain('A');
    fireEvent.pointerUp(clip, { clientX: 300, clientY: 40 });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(clips()).toHaveLength(0);
  });
  it('dragging a placed clip off the lane and releasing elsewhere puts it back unchanged', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />); geometry(); libraryGeometry();
    const clip = clips()[0]!;
    fireEvent.pointerDown(clip, { button: 0, clientX: 300, clientY: 130 });
    fireEvent.pointerMove(clip, { clientX: 500, clientY: 300 });
    expect(document.querySelector('.sequence-drag-badge')).not.toBeNull();
    fireEvent.pointerUp(clip, { clientX: 500, clientY: 300 });
    expect(commit).not.toHaveBeenCalled();
    expect(clips()).toHaveLength(1);
  });
  it('releasing a freshly dragged library route back onto the library cancels the add', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />); geometry(); libraryGeometry();
    drag(screen.getByRole('button', { name: 'B: 3.00 s' }), 20, 300, 30, 40);
    expect(commit).not.toHaveBeenCalled(); expect(clips()).toHaveLength(1);
  });

  it('grays the whole library while the playhead sits on an occupied stretch, restoring at the seam', () => {
    // t = 2 is inside A (0–4 s): nowhere to drop at the playhead.
    const commit = vi.fn(); const { unmount } = render(<LiveHarness onCommit={commit} t={2} />);
    expect(labels()).toEqual(['A', 'B', 'C']); // all blocked → stable original order
    expect(sources().every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(sources()[0]!.getAttribute('aria-label')).toContain('occupied stretch');
    fireEvent.click(sources()[1]!);
    expect(commit).not.toHaveBeenCalled();
    // t = 4 is exactly A's end: a seam is free space — pose gating takes over again.
    unmount();
    const seam = vi.fn(); render(<LiveHarness onCommit={seam} t={4} />);
    expect(labels()).toEqual(['B', 'A', 'C']);
    expect(seam).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: /^B: \d+\.\d\d s$/ })[0]!);
    expect(seam).toHaveBeenCalledTimes(1);
  });
});

describe('scrub hardening: window-driven drag, reference lane and ruler surfaces', () => {
  const referenceLane = () => document.querySelector('.sequence-track:not(.is-editing) .sequence-track-lane') as HTMLElement;
  const axisRuler = () => document.querySelector('.sequence-axis > div') as HTMLElement;
  function mockRect(el: Element, left = 0, width = 1000) {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left, top: 100, right: left + width, bottom: 194, width, height: 94, x: left, y: 100, toJSON: () => {} });
  }

  it('keeps scrubbing from window pointermove — no pointer capture required', () => {
    const setT = vi.fn(); render(<LiveHarness t={5} setT={setT} />); geometry();
    fireEvent.pointerDown(activeLane(), { button: 0, clientX: 500, clientY: 130 });
    expect(setT).toHaveBeenLastCalledWith(10);
    // A move dispatched straight at the window (capture lost, pointer off
    // the composer) still drives the scrub.
    fireEvent.pointerMove(window, { clientX: 250, clientY: 400 });
    expect(setT).toHaveBeenLastCalledWith(5);
    fireEvent.pointerUp(window, { clientX: 250, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 900, clientY: 400 });
    expect(setT).toHaveBeenLastCalledWith(5); // gesture ended — no further moves
  });

  it('scrubs from a reference lane and from the second ruler', () => {
    const other = fixture('two', 4);
    const setT = vi.fn();
    render(<I18nProvider><SequenceTimelineComposer robots={[fixture(), other]} selectedId={undefined} onSelect={vi.fn()}
      autoPeriodS={20} open onClose={vi.fn()} onChange={vi.fn()} onJump={vi.fn()}
      playback={{ t: 5, setT, playing: false, setPlaying: vi.fn(), speed: 1, setSpeed: vi.fn() }} /></I18nProvider>);
    geometry(); // editing lane (first track) rect for move()
    const ref = referenceLane(); mockRect(ref);
    fireEvent.pointerDown(ref, { button: 0, clientX: 300, clientY: 130 });
    expect(setT).toHaveBeenLastCalledWith(6);
    fireEvent.pointerUp(ref, { clientX: 300, clientY: 130 });
    const ruler = axisRuler(); mockRect(ruler);
    fireEvent.pointerDown(ruler, { button: 0, clientX: 900, clientY: 8 });
    expect(setT).toHaveBeenLastCalledWith(18);
    fireEvent.pointerUp(ruler, { clientX: 900, clientY: 8 });
  });
});

describe('grayed routes still preview; entering edit never pauses; range follows inside', () => {
  const sources = () => [...document.querySelectorAll('.sequence-route-source')] as HTMLButtonElement[];

  it('hovers and focuses a BLOCKED route to preview it, while adds stay refused', () => {
    const preview = vi.fn();
    render(<I18nProvider><SequenceTimelineComposer robots={[fixture()]} selectedId={undefined} onSelect={vi.fn()}
      autoPeriodS={20} open onClose={vi.fn()} onChange={vi.fn()} onPreviewRoute={preview} onJump={vi.fn()}
      playback={{ t: 2, setT: vi.fn(), playing: false, setPlaying: vi.fn(), speed: 1, setSpeed: vi.fn() }} /></I18nProvider>);
    // t=2 sits inside A (0–4 s): every route is occupancy-grayed.
    const grayed = sources()[0]!;
    expect(grayed.getAttribute('aria-disabled')).toBe('true');
    fireEvent.pointerEnter(grayed);
    expect(preview).toHaveBeenLastCalledWith(expect.any(String));
    fireEvent.pointerLeave(grayed);
    expect(preview).toHaveBeenLastCalledWith(null);
    fireEvent.focus(grayed);
    expect(preview).toHaveBeenLastCalledWith(expect.any(String));
    fireEvent.blur(grayed);
    expect(preview).toHaveBeenLastCalledWith(null);
    // Grayed stays un-addable by keyboard and pointer.
    fireEvent.click(grayed);
    expect(document.querySelectorAll('.sequence-clip')).toHaveLength(1);
  });

  it('previews another team\'s placed leg through that team\'s own library', () => {
    // Editing team one; hovering team two's lane still identifies the route
    // (user 2026-10-08) — App resolves it through team two's library.
    const preview = vi.fn();
    render(<I18nProvider><SequenceTimelineComposer robots={[fixture('one'), fixture('two')]} selectedId="one" onSelect={vi.fn()}
      autoPeriodS={20} open onClose={vi.fn()} onChange={vi.fn()} onPreviewRoute={preview} onJump={vi.fn()} /></I18nProvider>);
    const refClip = document.querySelector('.sequence-track:not(.is-editing) .sequence-clip') as HTMLElement;
    fireEvent.pointerEnter(refClip);
    expect(preview).toHaveBeenLastCalledWith(expect.any(String), 'two');
    fireEvent.pointerLeave(refClip);
    expect(preview).toHaveBeenLastCalledWith(null);
  });

  it('shows the playback-range selector, wired to the shared state', () => {
    const change = vi.fn();
    render(<I18nProvider><SequenceTimelineComposer robots={[fixture()]} selectedId={undefined} onSelect={vi.fn()}
      autoPeriodS={20} open onClose={vi.fn()} onChange={vi.fn()} playbackRange="paths" onPlaybackRangeChange={change} onJump={vi.fn()}
      playback={{ t: 0, setT: vi.fn(), playing: false, setPlaying: vi.fn(), speed: 1, setSpeed: vi.fn() }} playbackEndS={7} /></I18nProvider>);
    const select = screen.getByRole('combobox', { name: 'Playback range' });
    expectComboboxValue(select, 'paths');
    pickComboboxValue(select, 'full');
    expect(change).toHaveBeenCalledWith('full');
  });
});

describe('route library "group by start" order (user 2026-10-09)', () => {
  // One route per 2026 start class, two per class to prove within-group
  // filename order. All three starts are inside the 2026 alliance zone so
  // they share the draggable partition; names deliberately anti-alphabetical
  // (Z* sorts before A* by filename) so grouped order cannot pass by accident.
  const regions = REBUILT_2026.startRegions;
  const zone = [{ xMinM: 0, xMaxM: 4.0284, yMinM: 0, yMaxM: 8.07 }];
  const samplesFrom = (x: number, y: number): Trajectory['samples'] => [
    { t: 0, x, y, heading: 0, vx: 0, vy: 0, omega: 0 },
    { t: 2, x: x + 0.5, y, heading: 0, vx: 0, vy: 0, omega: 0 },
  ];
  const bare = (): Trajectory => ({ ...parseGhostAuto(raw, 'base.ghostauto'), durationS: 2 });
  function groupedFixture(): SessionTrajectory {
    const defs = [
      { id: 'z-trench', relPath: 'Z-trench.ghostauto', x: 3.9, y: 7.5 },   // in-zone slice of the upper arm
      { id: 'a-trench', relPath: 'A-trench.ghostauto', x: 3.53, y: 7.66 },
      { id: 'z-hub', relPath: 'Z-hub.ghostauto', x: 3.55, y: 4.02 },       // pushed against the hub face
      { id: 'a-hub', relPath: 'A-hub.ghostauto', x: 3.63, y: 4.01 },
      { id: 'z-other', relPath: 'Z-other.ghostauto', x: 2.2, y: 2.0 },
      { id: 'a-other', relPath: 'A-other.ghostauto', x: 1.2, y: 5.6 },
    ];
    // The app's library arrives filename-sorted (sortRoutes); mirror that
    // so within-group order reflects the real contract.
    const options = [...defs].sort((a, b) => a.relPath.localeCompare(b.relPath)).map((d) => ({
      id: d.id,
      relPath: d.relPath,
      trajectory: { ...bare(), id: d.id, name: d.relPath.replace('.ghostauto', ''), durationS: 2, samples: samplesFrom(d.x, d.y) },
    }));
    const st = makeSession(options[0]!.trajectory);
    st.routeId = options[0]!.id;
    st.routeOptions = options;
    return st;
  }
  const captions = () => [...document.querySelectorAll('.sequence-group-tag')].map((n) => n.textContent);
  const labels = () => [...document.querySelectorAll('.sequence-route-source')].map((b) => b.getAttribute('aria-label')!.split(':')[0]);

  it('clusters routes under Trench / Hub / Other captions, filename order inside', () => {
    localStorage.setItem('pb.routeOrder', 'start');
    localStorage.setItem('pb.lengthUnit', 'm');
    const robot = applySequenceSegments(groupedFixture(), []);
    render(<I18nProvider><SequenceTimelineComposer robots={[robot]} selectedId={robot.trajectory.id} onSelect={vi.fn()}
      autoPeriodS={20} startZone={zone} startRegions={regions} open onClose={vi.fn()} onChange={vi.fn()} onJump={vi.fn()} /></I18nProvider>);
    expect(labels()).toEqual(['A-trench', 'Z-trench', 'A-hub', 'Z-hub', 'A-other', 'Z-other']);
    expect(captions()).toEqual(['Trench', 'Hub', 'Other']);
  });

  it('stays plain alphabetical (no captions, no toggle) by default and without regions', () => {
    localStorage.removeItem('pb.routeOrder');
    localStorage.setItem('pb.lengthUnit', 'm');
    const robot = applySequenceSegments(groupedFixture(), []);
    const { rerender } = render(<I18nProvider><SequenceTimelineComposer robots={[robot]} selectedId={robot.trajectory.id} onSelect={vi.fn()}
      autoPeriodS={20} startZone={zone} startRegions={regions} open onClose={vi.fn()} onChange={vi.fn()} onJump={vi.fn()} /></I18nProvider>);
    expect(labels()).toEqual(['A-hub', 'A-other', 'A-trench', 'Z-hub', 'Z-other', 'Z-trench']);
    expect(captions()).toEqual([]);
    // The toggle only exists in seasons with start classes.
    rerender(<I18nProvider><SequenceTimelineComposer robots={[robot]} selectedId={robot.trajectory.id} onSelect={vi.fn()}
      autoPeriodS={20} startZone={zone} open onClose={vi.fn()} onChange={vi.fn()} onJump={vi.fn()} /></I18nProvider>);
    expect(document.querySelector('.sequence-order')).toBeNull();
  });

  it('never gives a named class to an out-of-zone start — L1-style under-arm and L10-style far-side hub all read as Other', () => {
    localStorage.setItem('pb.routeOrder', 'start');
    localStorage.setItem('pb.lengthUnit', 'm');
    const robot = applySequenceSegments(groupedFixture(), []);
    // Two real out-of-zone starts: under the upper trench arm (11019 L1)
    // and past the hub on the neutral side (11019 L10). Both classify
    // geometrically, but neither may legally start the auto.
    robot.routeOptions = [...robot.routeOptions, {
      id: 'l1', relPath: 'L1-underarm.ghostauto',
      trajectory: { ...bare(), id: 'l1', name: 'L1-underarm', durationS: 2, samples: samplesFrom(4.42, 7.62) },
    }, {
      id: 'l10', relPath: 'L10-farside.ghostauto',
      trajectory: { ...bare(), id: 'l10', name: 'L10-farside', durationS: 2, samples: samplesFrom(5.8, 4.65) },
    }].sort((a, b) => a.relPath.localeCompare(b.relPath));
    render(<I18nProvider><SequenceTimelineComposer robots={[robot]} selectedId={robot.trajectory.id} onSelect={vi.fn()}
      autoPeriodS={20} startZone={zone} startRegions={regions} open onClose={vi.fn()} onChange={vi.fn()} onJump={vi.fn()} /></I18nProvider>);
    // Captions never name Trench/Hub for the illegal pair — they land in
    // the Other bucket across both partitions.
    expect(captions()).toEqual(['Trench', 'Hub', 'Other']);
    expect(labels().filter((l) => l.startsWith('L1-underarm') || l.startsWith('L10-farside'))).toHaveLength(2);
  });

  it('drops the grouping (and the toggle) once the playhead reaches the first leg — continuity owns the library', () => {
    localStorage.setItem('pb.routeOrder', 'start');
    localStorage.setItem('pb.lengthUnit', 'm');
    const placed = applySequenceSegments(groupedFixture(), [{ id: 's1', routeId: 'a-hub', waitBeforeS: 0 }]);
    render(<I18nProvider><SequenceTimelineComposer robots={[placed]} selectedId={placed.trajectory.id} onSelect={vi.fn()}
      autoPeriodS={20} startZone={zone} startRegions={regions} open onClose={vi.fn()} onChange={vi.fn()} onJump={vi.fn()}
      playback={{ t: 5, setT: vi.fn(), playing: false, setPlaying: vi.fn(), speed: 1, setSpeed: vi.fn() }} /></I18nProvider>);
    expect(captions()).toEqual([]);
    expect(document.querySelector('.sequence-order')).toBeNull();
    expect(labels()).toEqual(['A-hub', 'A-other', 'A-trench', 'Z-hub', 'Z-other', 'Z-trench']);
  });

  it('still groups with a leg placed while the playhead is before it (user screenshot 2026-10-10)', () => {
    // 11019-with-L3-at-1.04 s state: the playhead (0.59 s) precedes the
    // first route, so the picker is still answering "where does the auto
    // start" — grouping and captions stay, and each group captions once.
    localStorage.setItem('pb.routeOrder', 'start');
    localStorage.setItem('pb.lengthUnit', 'm');
    const placed = applySequenceSegments(groupedFixture(), [{ id: 's1', routeId: 'a-hub', waitBeforeS: 1.04 }]);
    render(<I18nProvider><SequenceTimelineComposer robots={[placed]} selectedId={placed.trajectory.id} onSelect={vi.fn()}
      autoPeriodS={20} startZone={zone} startRegions={regions} open onClose={vi.fn()} onChange={vi.fn()} onJump={vi.fn()}
      playback={{ t: 0.59, setT: vi.fn(), playing: false, setPlaying: vi.fn(), speed: 1, setSpeed: vi.fn() }} /></I18nProvider>);
    expect(captions()).toEqual(['Trench', 'Hub', 'Other']);
    expect(labels()).toEqual(['A-trench', 'Z-trench', 'A-hub', 'Z-hub', 'A-other', 'Z-other']);
    expect(document.querySelector('.sequence-order')).not.toBeNull();
  });

  it('persists the user\u2019s order choice across launches', () => {
    localStorage.removeItem('pb.routeOrder');
    localStorage.setItem('pb.lengthUnit', 'm');
    const robot = applySequenceSegments(groupedFixture(), []);
    render(<I18nProvider><SequenceTimelineComposer robots={[robot]} selectedId={robot.trajectory.id} onSelect={vi.fn()}
      autoPeriodS={20} startZone={zone} startRegions={regions} open onClose={vi.fn()} onChange={vi.fn()} onJump={vi.fn()} /></I18nProvider>);
    const order = document.querySelector('.sequence-order')!;
    expectComboboxValue(order, 'name');
    pickComboboxValue(order, 'start');
    expect(labels()).toEqual(['A-trench', 'Z-trench', 'A-hub', 'Z-hub', 'A-other', 'Z-other']);
    expect(localStorage.getItem('pb.routeOrder')).toBe('start');
  });
});
