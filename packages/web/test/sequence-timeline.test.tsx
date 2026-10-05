import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activeEndT, checkSequenceJoins, makeSession, parseGhostAuto, samplePoseAt, type SessionTrajectory, type Trajectory } from '@pathblender/core';
import { I18nProvider } from '../src/i18n';
import { SequenceTimelineComposer } from '../src/components/SequenceTimelineComposer';
import { applySequenceSegments, sequenceViewFor, type AutoSequenceSegment } from '../src/auto-sequence-state';
import { canPlaceClip, clipsFor, sameClipLayout, segmentsFromClips, snapClipStart, boundedClipStart, clipGaps } from '../src/sequence-timeline-clips';

const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
function fixture(id = 'one', duration = 4): SessionTrajectory {
  const trajectory = { ...parseGhostAuto(raw, 'A.ghostauto'), id, teamNumber: id, name: 'A', durationS: duration };
  return { ...makeSession(trajectory), routeId: 'a', routeOptions: [
    { id: 'a', relPath: 'A.ghostauto', trajectory },
    { id: 'b', relPath: 'B.ghostauto', trajectory: { ...trajectory, id: `${id}-b`, name: 'B', durationS: 3 } },
  ] };
}


function LiveHarness({ robot = fixture(), autoPeriodS = 20, onCommit = () => {}, onClose = vi.fn() }: {
  robot?: SessionTrajectory; autoPeriodS?: number; onCommit?: (r: SessionTrajectory) => void; onClose?: () => void;
}) {
  const [saved, setSaved] = useState(robot);
  const [playing, setPlaying] = useState(false);
  return <I18nProvider><SequenceTimelineComposer robots={[saved]} selectedId={saved.trajectory.id} onSelect={vi.fn()} autoPeriodS={autoPeriodS}
    open onClose={onClose} onChange={(segments) => { const next = applySequenceSegments(saved, segments); setSaved(next); onCommit(next); }}
    joins={checkSequenceJoins(saved)} onJump={vi.fn()} playback={{ t: 0, setT: vi.fn(), playing, setPlaying, speed: 1, setSpeed: vi.fn() }} /></I18nProvider>;
}
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('pb.lang', 'en'); vi.clearAllMocks();
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
const activeLane = () => document.querySelector('.sequence-track.is-editing .sequence-track-lane') as HTMLElement;
const clips = () => within(activeLane()).queryAllByRole('button', { name: /, \d+\.\d+–/ });
const addB = () => fireEvent.click(screen.getByRole('button', { name: /^B: \d+\.\d\d s$/ }));
function geometry() {
  vi.spyOn(activeLane(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 100, right: 1000, bottom: 194, width: 1000, height: 94, x: 0, y: 100, toJSON: () => {} });
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
  it('semantic layout equality ignores ids and segment order but sees route and start changes', () => {
    expect(sameClipLayout([{ id: 'x', routeId: 'a', startS: 1 }, { id: 'y', routeId: 'b', startS: 5 }], [{ id: 'p', routeId: 'b', startS: 5 }, { id: 'q', routeId: 'a', startS: 1 }])).toBe(true);
    expect(sameClipLayout([{ id: 'x', routeId: 'a', startS: 1 }], [{ id: 'q', routeId: 'b', startS: 1 }])).toBe(false);
    expect(sameClipLayout([{ id: 'x', routeId: 'a', startS: 1 }], [{ id: 'q', routeId: 'a', startS: 1.000001 }])).toBe(true);
    expect(sameClipLayout([{ id: 'x', routeId: 'a', startS: 1 }], [{ id: 'q', routeId: 'a', startS: 1.1 }])).toBe(false);
  });
  it('round-trips segments through clips without rounding waits or durations', () => {
    const robot = fixture('rt', 4.753697);
    const segments: AutoSequenceSegment[] = [
      { id: 's1', routeId: 'a', waitBeforeS: 1.5 },
      { id: 's2', routeId: 'b', waitBeforeS: 0.5000001 },
    ];
    const view = sequenceViewFor(applySequenceSegments(robot, segments));
    const roundTripped = segmentsFromClips(clipsFor(view.segments, view.routes));
    expect(roundTripped.map((s) => [s.id, s.routeId])).toEqual(segments.map((s) => [s.id, s.routeId]));
    // Waits are recomputed from clip boundaries; floating point may move the
    // last digit, imported durations stay bit-exact.
    expect(roundTripped[0]!.waitBeforeS).toBeCloseTo(1.5, 12);
    expect(roundTripped[1]!.waitBeforeS).toBeCloseTo(0.5000001, 12);
    expect(clipsFor(view.segments, view.routes).map((c) => c.durationS)).toEqual([4.753697, 3]);
  });
});


describe('live arrangement editing', () => {
  it('clicks append even when another clip is selected, and commits immediately', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />);
    fireEvent.click(clips()[0]!); addB(); addB();
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
  it('cancels a source dragged outside the lane without adding a route', () => {
    const commit = vi.fn(); render(<LiveHarness onCommit={commit} />); geometry();
    drag(screen.getByRole('button', { name: 'B: 3.00 s' }), 20, 500, 30, 300);
    expect(commit).not.toHaveBeenCalled(); expect(clips()).toHaveLength(1);
  });
  it.each([15, 20])('clamps a moved route to the %s-second season boundary', (limit) => {
    const commit = vi.fn(); render(<LiveHarness autoPeriodS={limit} onCommit={commit} />); geometry();
    drag(clips()[0]!, 0, 2000);
    expect(activeEndT(commit.mock.calls[0]![0])).toBe(limit);
    expect(document.querySelector('.sequence-timing-warning')).toBeNull();
  });
  it('rejects an append that cannot fit, a numeric overrun, and overlap', () => {
    const commit = vi.fn(); render(<LiveHarness autoPeriodS={6} onCommit={commit} />);
    addB(); expect(commit).not.toHaveBeenCalled();
    fireEvent.click(clips()[0]!);
    const input = screen.getByRole('spinbutton', { name: 'Start' });
    fireEvent.change(input, { target: { value: '5' } }); fireEvent.blur(input);
    expect(commit).not.toHaveBeenCalled();
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
