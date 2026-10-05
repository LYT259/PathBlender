import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useMemo, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activeEndT, checkSequenceJoins, checkSequenceTiming, makeSession, parseGhostAuto, samplePoseAt, type SessionTrajectory, type Trajectory } from '@pathblender/core';
import { I18nProvider } from '../src/i18n';
import { SequenceTimelineComposer } from '../src/components/SequenceTimelineComposer';
import { applySequenceSegments, sequenceViewFor, type AutoSequenceSegment } from '../src/auto-sequence-state';
import { canPlaceClip, clipsFor, sameClipLayout, segmentsFromClips, snapClipStart } from '../src/sequence-timeline-clips';

const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
function fixture(id = 'one', duration = 4): SessionTrajectory {
  const trajectory = { ...parseGhostAuto(raw, 'A.ghostauto'), id, teamNumber: id, name: 'A', durationS: duration };
  return { ...makeSession(trajectory), routeId: 'a', routeOptions: [
    { id: 'a', relPath: 'A.ghostauto', trajectory },
    { id: 'b', relPath: 'B.ghostauto', trajectory: { ...trajectory, id: `${id}-b`, name: 'B', durationS: 3 } },
  ] };
}

/**
 * Mirrors App's wiring: edits land on a per-team draft, `hasChanges` is the
 * semantic layout difference from the saved arrangement, Save applies the
 * draft to the robot as one commit and dissolves the draft, Cancel/Reset
 * discard it. Nothing touches `saved` until Save.
 */
function DraftHarness({ robot, autoPeriodS = 20, onCommit, onEvent, onJump = () => undefined, onClose = vi.fn() }: {
  robot: SessionTrajectory;
  autoPeriodS?: number;
  onCommit?: (r: SessionTrajectory) => void;
  onEvent?: (kind: 'save' | 'cancel' | 'reset') => void;
  onJump?: (t: number) => void;
  onClose?: () => void;
}) {
  const [saved, setSaved] = useState(robot);
  const [drafts, setDrafts] = useState<Record<string, AutoSequenceSegment[]>>({});
  const id = robot.trajectory.id;
  const savedView = useMemo(() => sequenceViewFor(saved), [saved]);
  const draftSegments = drafts[id];
  const preview = draftSegments ? applySequenceSegments(saved, draftSegments) : saved;
  const hasChanges = useMemo(() => {
    if (!draftSegments) return false;
    return !sameClipLayout(clipsFor(draftSegments, savedView.routes), clipsFor(savedView.segments, savedView.routes));
  }, [draftSegments, savedView]);
  const drop = (prev: Record<string, AutoSequenceSegment[]>) => {
    const { [id]: _dropped, ...rest } = prev;
    return rest;
  };
  const draftActions = {
    hasChanges,
    canReset: true,
    onReset: () => { onEvent?.('reset'); setDrafts(drop); },
    onSave: () => {
      if (!draftSegments) return;
      onEvent?.('save');
      const next = applySequenceSegments(saved, draftSegments);
      setSaved(next);
      setDrafts(drop);
      onCommit?.(next);
    },
    onCancel: () => { onEvent?.('cancel'); setDrafts(drop); },
  };
  return <I18nProvider><SequenceTimelineComposer robots={[saved]} selectedId={saved.trajectory.id} onSelect={vi.fn()} autoPeriodS={autoPeriodS} open onClose={onClose} draft={draftSegments} draftActions={draftActions} onChange={(segments) => setDrafts((prev) => ({ ...prev, [id]: segments }))} joins={checkSequenceJoins(preview)} timing={checkSequenceTiming(preview, autoPeriodS)} onJump={onJump} /></I18nProvider>;
}

beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); vi.clearAllMocks(); });
const activeLane = () => document.querySelector('.sequence-track.is-editing .sequence-track-lane') as HTMLElement;
/** Route blocks only — seam badges carry their own names. */
const clips = () => within(activeLane()).queryAllByRole('button', { name: /, \d+\.\d+–/ });
const addB = () => fireEvent.click(screen.getByRole('button', { name: /^B: \d+\.\d\d s$/ }));
const saveBtn = () => screen.getByRole('button', { name: 'Save' });
const cancelBtn = () => screen.getByRole('button', { name: 'Cancel' });
const resetBtn = () => screen.getByRole('button', { name: 'Reset arrangement' });
const startInput = () => screen.getByRole('spinbutton', { name: 'Start' });
function setStart(value: string) {
  const input = startInput();
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
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

describe('timeline composer (draft transactions)', () => {
  it('edits land on the draft; the saved arrangement only changes on Save', () => {
    const commits: SessionTrajectory[] = [];
    const events: string[] = [];
    render(<DraftHarness robot={fixture()} onCommit={undefined} onEvent={(k) => events.push(k)} />);
    expect(clips()).toHaveLength(1);
    // Clean state: no Save/Cancel, Reset disabled.
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(resetBtn()).toBeDisabled();
    addB();
    expect(clips()).toHaveLength(2);
    expect(resetBtn()).toBeEnabled();
    // The appended block is selected; move it to 8 s, leaving a 4 s wait.
    setStart('8');
    expect(screen.getByRole('button', { name: 'B, 8.00–11.00 s' })).toBeInTheDocument();
    expect(screen.getByTitle('Wait: 4.00 s')).toBeInTheDocument();
    setStart('3');
    expect(screen.getByRole('status')).toHaveTextContent('Routes cannot overlap');
    expect(startInput()).toHaveValue(8);
    // Nothing was committed yet — the robot still plays its imported route.
    expect(events).toEqual([]);
    // Save applies the whole draft as ONE commit.
    fireEvent.click(saveBtn());
    expect(events).toEqual(['save']);
    expect(clips()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'B, 8.00–11.00 s' })).toBeInTheDocument();
  });

  it('a saved draft plays through the composed sequence with waits and start delay', () => {
    const commits: SessionTrajectory[] = [];
    render(<DraftHarness robot={fixture('compose', 4)} onCommit={(r) => commits.push(r)} />);
    addB();
    setStart('8');
    fireEvent.click(saveBtn());
    expect(commits).toHaveLength(1);
    expect(commits[0]!.sequence!.segments.map((s) => [s.routeId, s.waitBeforeS])).toEqual([['a', 0], ['b', 4]]);
    expect(activeEndT(commits[0]!)).toBe(11);
    expect(commits[0]!.startDelayS).toBe(0);
  });

  it('rejects a non-finite exact start without creating a draft', () => {
    render(<DraftHarness robot={fixture()} />);
    fireEvent.click(clips()[0]!);
    setStart('');
    expect(screen.getByRole('status')).toHaveTextContent('non-negative');
    expect(startInput()).toHaveValue(0);
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('commits a pointer drag into the draft exactly once, on release, and keeps the neighbour put', () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true });
    const events: string[] = [];
    render(<DraftHarness robot={fixture()} onEvent={(k) => events.push(k)} />);
    addB();
    const lane = activeLane();
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect);
    // Axis is 20 s over 1000 px → 50 px/s. B starts at 4 s; drag it 3 s right.
    const blockB = screen.getByRole('button', { name: 'B, 4.00–7.00 s' });
    fireEvent.pointerDown(blockB, { pointerId: 1, button: 0, clientX: 200 });
    fireEvent.pointerMove(blockB, { pointerId: 1, clientX: 250 });
    fireEvent.pointerMove(blockB, { pointerId: 1, clientX: 350 });
    fireEvent.pointerUp(blockB, { pointerId: 1, clientX: 350 });
    // The drag never committed by itself — the draft holds B at 7–10.
    expect(events).toEqual([]);
    expect(screen.getByRole('button', { name: 'B, 7.00–10.00 s' })).toBeInTheDocument();
    expect(screen.getByTitle('Wait: 3.00 s')).toBeInTheDocument();
    fireEvent.click(saveBtn());
    expect(screen.getByRole('button', { name: 'B, 7.00–10.00 s' })).toBeInTheDocument();
  });

  it('dragging a saved clip away and back to its saved time reads as no change', () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true });
    render(<DraftHarness robot={fixture()} />);
    addB();
    setStart('8');
    fireEvent.click(saveBtn()); // saved arrangement: A 0–4, B 8–11
    const lane = activeLane();
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect);
    const blockB = screen.getByRole('button', { name: 'B, 8.00–11.00 s' });
    // Drag B to 10 s and release: the draft holds the move, Save/Cancel appear.
    fireEvent.pointerDown(blockB, { pointerId: 1, button: 0, clientX: 400 });
    fireEvent.pointerMove(blockB, { pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(blockB, { pointerId: 1, clientX: 500 });
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    // Drag it back to its saved start (8 s = 400 px on the 20 s axis).
    const moved = screen.getByRole('button', { name: 'B, 10.00–13.00 s' });
    fireEvent.pointerDown(moved, { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerMove(moved, { pointerId: 1, clientX: 400 });
    fireEvent.pointerUp(moved, { pointerId: 1, clientX: 400 });
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(resetBtn()).toBeDisabled();
  });

  it('Cancel and Reset discard the draft without committing; Save stays after Reset', () => {
    const events: string[] = [];
    render(<DraftHarness robot={fixture()} onEvent={(k) => events.push(k)} />);
    addB();
    setStart('8');
    // Cancel discards and keeps the saved arrangement.
    fireEvent.click(cancelBtn());
    expect(events).toEqual(['cancel']);
    expect(clips()).toHaveLength(1);
    expect(resetBtn()).toBeDisabled();
    // Redo the edit, then Reset: back to the saved single route, still editing.
    addB();
    setStart('8');
    fireEvent.click(resetBtn());
    expect(events).toEqual(['cancel', 'reset']);
    expect(clips()).toHaveLength(1);
    expect(resetBtn()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('supports keyboard placement into the draft, blocks removing the last route and resets cleanly', () => {
    const events: string[] = [];
    render(<DraftHarness robot={fixture()} onEvent={(k) => events.push(k)} />);
    // A legacy robot has nothing to reset until the draft diverges.
    expect(resetBtn()).toBeDisabled();
    fireEvent.click(clips()[0]!);
    const remove = screen.getByRole('button', { name: 'Remove route' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', 'An auto needs at least one route. Reset to return to the imported route.');
    fireEvent.keyDown(clips()[0]!, { key: 'ArrowRight', shiftKey: true });
    expect(startInput()).toHaveValue(1);
    expect(resetBtn()).toBeEnabled();
    fireEvent.click(resetBtn());
    expect(events).toEqual(['reset']);
    expect(clips()).toHaveLength(1);
    expect(resetBtn()).toBeDisabled();
  });

  it('replaces the selected clip\'s route directly, keeping its slot start', () => {
    const commits: SessionTrajectory[] = [];
    render(<DraftHarness robot={fixture('replace', 4)} onCommit={(r) => commits.push(r)} />);
    addB(); // B appended at 4–7 and auto-selected.
    // The library button now offers a replacement of the selected block.
    expect(screen.getByRole('button', { name: /^A: / })).toHaveAttribute('title', 'Replace selected route');
    fireEvent.click(screen.getByRole('button', { name: /^A: / }));
    expect(screen.getByRole('button', { name: 'A, 4.00–8.00 s' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Route replaced');
    fireEvent.click(saveBtn());
    expect(commits[0]!.sequence!.segments.map((s) => s.routeId)).toEqual(['a', 'a']);
    expect(activeEndT(commits[0]!)).toBe(8);
  });

  it('reports a measured seam gap on the draft preview, jumps to it, and warns when the auto outruns the period', () => {
    const endX = 2;
    const a: Trajectory = {
      id: 'one', name: 'A', teamName: 'Team', teamNumber: '0001', source: 'ghostauto', alliance: 'blue',
      samples: [
        { t: 0, x: 0, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
        { t: 2, x: endX, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      ],
      durationS: 2,
      geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 },
      geometrySource: 'file', moduleLocations: [], events: [], warnings: [],
    };
    const b: Trajectory = { ...a, id: 'one-b', name: 'B', samples: [
      { t: 0, x: endX + 0.5, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      { t: 2, x: endX + 0.5 + 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
    ] };
    const robot: SessionTrajectory = { ...makeSession(a), routeId: 'a', routeOptions: [
      { id: 'a', relPath: 'A.ghostauto', trajectory: a },
      { id: 'b', relPath: 'B.ghostauto', trajectory: b },
    ] };
    const jumped: number[] = [];
    render(<DraftHarness robot={robot} autoPeriodS={6.5} onJump={(t) => jumped.push(t)} />);
    addB();
    setStart('8');
    const seam = screen.getByRole('button', { name: /Join continuous: position gap/ });
    expect(seam).toHaveTextContent(/position gap/);
    fireEvent.click(seam);
    expect(jumped).toEqual([2]);
    expect(screen.getByText(/after the 6.5 s autonomous period/)).toBeInTheDocument();
  });

  it('shows a continuous seam check when the join measures within tolerance', () => {
    const endX = 2;
    const a: Trajectory = {
      id: 'one', name: 'A', teamName: 'Team', teamNumber: '0001', source: 'ghostauto', alliance: 'blue',
      samples: [
        { t: 0, x: 0, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
        { t: 2, x: endX, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      ],
      durationS: 2,
      geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 },
      geometrySource: 'file', moduleLocations: [], events: [], warnings: [],
    };
    const b: Trajectory = { ...a, id: 'one-b', name: 'B', samples: [
      { t: 0, x: endX, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      { t: 2, x: endX + 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
    ] };
    const robot: SessionTrajectory = { ...makeSession(a), routeId: 'a', routeOptions: [
      { id: 'a', relPath: 'A.ghostauto', trajectory: a },
      { id: 'b', relPath: 'B.ghostauto', trajectory: b },
    ] };
    render(<DraftHarness robot={robot} />);
    addB();
    expect(screen.getByRole('button', { name: 'Join continuous' })).toBeInTheDocument();
    expect(screen.queryByText(/position gap/)).not.toBeInTheDocument();
  });

  it('keeps the waiting robot parked on the unified clock instead of interpolating', () => {
    let robot = fixture('clock', 4);
    const view = sequenceViewFor(robot);
    const segments: AutoSequenceSegment[] = [
      { id: view.segments[0]!.id, routeId: 'a', waitBeforeS: 2 },
      { id: 's2', routeId: 'b', waitBeforeS: 0.5 },
    ];
    robot = applySequenceSegments(robot, segments);
    // t=2.5: inside A at local 0.5.
    const expected = robot.routeOptions![0]!.trajectory.samples.find((s) => s.t === 0.5);
    expect(samplePoseAt(robot, 2.5).x).toBeCloseTo(expected!.x, 9);
    // t=6.2: the wait between A (ends at 6) and B (starts at 6.5) — parked
    // at A's end, not interpolated toward B.
    const endA = robot.routeOptions![0]!.trajectory.samples.at(-1)!;
    expect(samplePoseAt(robot, 6.2).x).toBeCloseTo(endA.x, 9);
    // t=1: the start delay — parked at A's start.
    expect(samplePoseAt(robot, 1).x).toBeCloseTo(robot.routeOptions![0]!.trajectory.samples[0]!.x, 9);
  });

  it('accepts an internal route drop at the cursor and ignores external drags', () => {
    const events: string[] = [];
    render(<DraftHarness robot={fixture()} onEvent={(k) => events.push(k)} />);
    const lane = activeLane();
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 1000 } as DOMRect);
    const transfer = { types: ['application/x-pathblender-timeline-route'], setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    const source = screen.getByRole('button', { name: 'B: 3.00 s' });
    fireEvent.dragStart(source, { dataTransfer: transfer });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperties(drop, { dataTransfer: { value: transfer }, clientX: { value: 400 } });
    fireEvent(lane, drop);
    expect(screen.getByRole('button', { name: 'B, 6.00–9.00 s' })).toBeInTheDocument();
    fireEvent.drop(lane, { dataTransfer: { types: ['text/plain'] } });
    expect(clips()).toHaveLength(2);
    expect(events).toEqual([]); // still an unsaved draft
  });

  it('keeps same-name routes distinguishable and reads Chinese copy from the dictionaries', () => {
    localStorage.setItem('pb.lang', 'zh');
    const robot = fixture();
    robot.routeOptions![1]!.relPath = 'team/right/A.ghostauto';
    render(<DraftHarness robot={robot} />);
    expect(screen.getByRole('heading', { name: '编排时间线' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'right/A.ghostauto: 3.00 s' })).toBeInTheDocument();
  });

  it('blurs a pending start-time edit into the draft and closes on a pointer down outside the surface', () => {
    const events: string[] = [];
    const onClose = vi.fn();
    render(<DraftHarness robot={fixture()} onEvent={(k) => events.push(k)} onClose={onClose} />);
    addB();
    // Type a new start without blurring — the outside click must commit it
    // to the draft before the unmount would swallow the typed value. The
    // field owns focus while a user types into it.
    startInput().focus();
    fireEvent.change(startInput(), { target: { value: '8' } });
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]); // Save was not pressed: nothing applied
    // The draft survives the close — the typed start is still on the lane
    // (B parked 4 s after A ends), waiting for Save or Cancel.
    expect(screen.getByRole('button', { name: 'B, 8.00–11.00 s' })).toBeInTheDocument();
  });

  it('stays open while the pointer stays inside the editing surface', () => {
    const onClose = vi.fn();
    render(<DraftHarness robot={fixture()} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'B: 3.00 s' }));
    fireEvent.pointerDown(activeLane());
    expect(onClose).not.toHaveBeenCalled();
  });
});
