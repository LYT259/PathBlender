import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activeEndT, checkSequenceJoins, checkSequenceTiming, makeSession, parseGhostAuto, samplePoseAt, type SessionTrajectory, type Trajectory } from '@pathblender/core';
import { I18nProvider } from '../src/i18n';
import { SequenceTimelineComposer } from '../src/components/SequenceTimelineComposer';
import { applySequenceSegments, sequenceViewFor, type AutoSequenceSegment } from '../src/auto-sequence-state';
import { canPlaceClip, clipsFor, placeClip, segmentsFromClips, snapClipStart } from '../src/sequence-timeline-clips';

const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
function fixture(id = 'one', duration = 4): SessionTrajectory {
  const trajectory = { ...parseGhostAuto(raw, 'A.ghostauto'), id, teamNumber: id, name: 'A', durationS: duration };
  return { ...makeSession(trajectory), routeId: 'a', routeOptions: [
    { id: 'a', relPath: 'A.ghostauto', trajectory },
    { id: 'b', relPath: 'B.ghostauto', trajectory: { ...trajectory, id: `${id}-b`, name: 'B', durationS: 3 } },
  ] };
}

function Harness({ robot, autoPeriodS = 20, onCommit, onJump = () => undefined }: {
  robot: SessionTrajectory;
  autoPeriodS?: number;
  onCommit?: (robot: SessionTrajectory) => void;
  onJump?: (t: number) => void;
}) {
  const [state, setState] = useState(robot);
  const commit = (segments: AutoSequenceSegment[]) => {
    const next = applySequenceSegments(state, segments);
    setState(next);
    onCommit?.(next);
  };
  return <I18nProvider><SequenceTimelineComposer robots={[state]} selectedId={state.trajectory.id} onSelect={vi.fn()} autoPeriodS={autoPeriodS} open onClose={vi.fn()} onChange={commit} joins={checkSequenceJoins(state)} timing={checkSequenceTiming(state, autoPeriodS)} onJump={onJump} /></I18nProvider>;
}

beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); vi.clearAllMocks(); });
const activeLane = () => document.querySelector('.sequence-track.is-editing .sequence-track-lane') as HTMLElement;
/** Route blocks only — seam badges carry their own names. */
const clips = () => within(activeLane()).queryAllByRole('button', { name: /, \d+\.\d+–/ });
const addB = () => fireEvent.click(screen.getByRole('button', { name: 'Available routes: B' }));
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
    expect(placeClip([first], next)).toEqual([first, next]);
    expect(canPlaceClip([first], { ...next, startS: 6.123455 })).toBe(false);
    expect(canPlaceClip([first], { ...next, startS: -1 })).toBe(false);
    expect(canPlaceClip([first], { ...next, startS: NaN })).toBe(false);
    expect(snapClipStart(6.15, [first], next, .1)).toBe(6.123456);
  });
  it('moves one clip across a neighbour without shifting the neighbour', () => {
    const next = { id: 'b', routeId: 'b', startS: 10, durationS: 3 };
    expect(placeClip([first, next], { ...first, startS: 14 })).toEqual([next, { ...first, startS: 14 }]);
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

describe('timeline composer (real state)', () => {
  it('appends routes, shows waits, rejects overlap without changing the committed arrangement', () => {
    const commits: SessionTrajectory[] = [];
    render(<Harness robot={fixture()} onCommit={(r) => commits.push(r)} />);
    expect(clips()).toHaveLength(1);
    addB();
    expect(clips()).toHaveLength(2);
    // The appended block is selected; move it to 8 s, leaving a 4 s wait.
    setStart('8');
    expect(screen.getByRole('button', { name: 'B, 8.00–11.00 s' })).toBeInTheDocument();
    expect(screen.getByTitle('Wait: 4.00 s')).toBeInTheDocument();
    setStart('3');
    expect(screen.getByRole('status')).toHaveTextContent('Routes cannot overlap');
    expect(startInput()).toHaveValue(8);
    // Every committed step landed on the robot: append, then B start 8.
    expect(commits).toHaveLength(2);
    expect(commits[1]!.sequence!.segments.map((s) => [s.routeId, s.waitBeforeS])).toEqual([['a', 0], ['b', 4]]);
    expect(activeEndT(commits[1]!)).toBe(11);
    expect(commits[1]!.startDelayS).toBe(0);
  });

  it('rejects a non-finite exact start without committing', () => {
    const commits: SessionTrajectory[] = [];
    render(<Harness robot={fixture()} onCommit={(r) => commits.push(r)} />);
    fireEvent.click(clips()[0]!);
    setStart('');
    expect(screen.getByRole('status')).toHaveTextContent('non-negative');
    expect(commits).toHaveLength(0);
    expect(startInput()).toHaveValue(0);
  });

  it('commits a pointer drag exactly once, on release, and keeps the neighbour put', () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true });
    const commits: SessionTrajectory[] = [];
    render(<Harness robot={fixture()} onCommit={(r) => commits.push(r)} />);
    addB();
    const lane = activeLane();
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect);
    // Axis is 20 s over 1000 px → 50 px/s. B starts at 4 s; drag it 3 s right.
    const blockB = screen.getByRole('button', { name: 'B, 4.00–7.00 s' });
    fireEvent.pointerDown(blockB, { pointerId: 1, button: 0, clientX: 200 });
    fireEvent.pointerMove(blockB, { pointerId: 1, clientX: 250 });
    fireEvent.pointerMove(blockB, { pointerId: 1, clientX: 350 });
    fireEvent.pointerUp(blockB, { pointerId: 1, clientX: 350 });
    // Append plus one drag — the moves between down and up never commit.
    expect(commits).toHaveLength(2);
    // A stays at 0–4; B lands at 7–10 and the gap becomes its wait.
    expect(commits[1]!.sequence!.segments.map((s) => [s.routeId, s.waitBeforeS])).toEqual([['a', 0], ['b', 3]]);
    expect(screen.getByRole('button', { name: 'B, 7.00–10.00 s' })).toBeInTheDocument();
  });

  it('supports keyboard placement, blocks removing the last route and resets to the imported route', () => {
    const commits: SessionTrajectory[] = [];
    render(<Harness robot={fixture()} onCommit={(r) => commits.push(r)} />);
    // A legacy robot has nothing to reset — the action stays disabled until
    // a real composition exists, and the only block cannot be removed.
    expect(screen.getByRole('button', { name: 'Reset arrangement' })).toBeDisabled();
    fireEvent.click(clips()[0]!);
    const remove = screen.getByRole('button', { name: 'Remove route' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', 'An auto needs at least one route. Reset to return to the imported route.');
    fireEvent.keyDown(clips()[0]!, { key: 'ArrowRight', shiftKey: true });
    expect(startInput()).toHaveValue(1);
    expect(commits.at(-1)!.sequence!.segments[0]!.waitBeforeS).toBe(1);
    addB();
    fireEvent.click(screen.getByRole('button', { name: 'Reset arrangement' }));
    expect(commits.at(-1)!.sequence).toBeUndefined();
    expect(clips()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Reset arrangement' })).toBeDisabled();
  });

  it('reports a measured seam gap, jumps to it, and warns when the auto outruns the period', () => {
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
    render(<Harness robot={robot} autoPeriodS={6.5} onJump={(t) => jumped.push(t)} />);
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
    render(<Harness robot={robot} />);
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
    const commits: SessionTrajectory[] = [];
    render(<Harness robot={fixture()} onCommit={(r) => commits.push(r)} />);
    const lane = activeLane();
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 1000 } as DOMRect);
    const transfer = { types: ['application/x-pathblender-timeline-route'], setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    const source = screen.getByRole('button', { name: 'Available routes: B' });
    fireEvent.dragStart(source, { dataTransfer: transfer });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperties(drop, { dataTransfer: { value: transfer }, clientX: { value: 400 } });
    fireEvent(lane, drop);
    expect(screen.getByRole('button', { name: 'B, 6.00–9.00 s' })).toBeInTheDocument();
    fireEvent.drop(lane, { dataTransfer: { types: ['text/plain'] } });
    expect(clips()).toHaveLength(2);
    expect(commits).toHaveLength(1);
  });

  it('keeps same-name routes distinguishable and reads Chinese copy from the dictionaries', () => {
    localStorage.setItem('pb.lang', 'zh');
    const robot = fixture();
    robot.routeOptions![1]!.relPath = 'team/right/A.ghostauto';
    render(<Harness robot={robot} />);
    expect(screen.getByRole('heading', { name: '编排时间线' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '可用路线: right/A.ghostauto' })).toBeInTheDocument();
  });
});
