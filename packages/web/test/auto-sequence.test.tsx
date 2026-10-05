import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeEndT,
  checkSequenceJoins,
  makeSession,
  parseGhostAuto,
  samplePoseAt,
  serializeSession,
  type SessionTrajectory,
  type Trajectory,
} from '@pathblender/core';
import { applySequenceSegments, sequenceViewFor, type AutoSequenceSegment } from '../src/auto-sequence-state';
import { App } from '../src/App';
import { saveText } from '../src/download';

vi.mock('../src/download', () => ({ saveText: vi.fn(async () => true) }));
const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');

function fixture(id = 'robot-a', duration = 4): SessionTrajectory {
  const original = parseGhostAuto(raw, 'A.ghostauto');
  const first = { ...original, id, name: 'A', durationS: duration };
  return {
    ...makeSession(first), routeId: 'route-a',
    routeOptions: [
      { id: 'route-a', relPath: 'team/A.ghostauto', trajectory: first },
      { id: 'route-b', relPath: 'team/B.ghostauto', trajectory: { ...original, id: `${id}-b`, name: 'B', durationS: 3 } },
      { id: 'route-c', relPath: 'team/C.ghostauto', trajectory: { ...original, id: `${id}-c`, name: 'C', durationS: 3 } },
    ],
  };
}

beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); vi.clearAllMocks(); });

describe('auto sequence state', () => {
  it('stores waits and mirrors the first wait onto the start delay', () => {
    const robot = fixture();
    const composed = applySequenceSegments(robot, [
      { id: 's1', routeId: 'route-a', waitBeforeS: 2 },
      { id: 's2', routeId: 'route-b', waitBeforeS: 1 },
    ]);
    expect(composed.sequence!.segments.map((s) => s.waitBeforeS)).toEqual([2, 1]);
    expect(composed.startDelayS).toBe(2);
    expect(activeEndT(composed)).toBe(10); // 2 + 4 + 1 + 3
  });

  it('returns the slot to its single route when every segment is removed', () => {
    const composed = applySequenceSegments(fixture(), [{ id: 's1', routeId: 'route-a', waitBeforeS: 2 }]);
    const reset = applySequenceSegments(composed, []);
    expect(reset.sequence).toBeUndefined();
    // The legacy single-route view shows the current route with its delay.
    const view = sequenceViewFor(reset);
    expect(view.segments).toHaveLength(1);
    expect(view.segments[0]!.routeId).toBe('route-a');
    expect(view.segments[0]!.waitBeforeS).toBe(2);
  });

  it('heals dangling route ids onto the current route instead of dropping the segment', () => {
    const robot = fixture();
    const composed = applySequenceSegments(robot, [
      { id: 's1', routeId: 'route-a', waitBeforeS: 0 },
      { id: 's2', routeId: 'deleted-route', waitBeforeS: 0 },
    ]);
    const view = sequenceViewFor(composed);
    expect(view.segments.map((s) => s.routeId)).toEqual(['route-a', 'route-a']);
  });

  it('clamps negative and non-finite waits defensively on hand-edited files', () => {
    const composed = applySequenceSegments(fixture(), [
      { id: 's1', routeId: 'route-a', waitBeforeS: -3 },
      { id: 's2', routeId: 'route-b', waitBeforeS: NaN },
    ]);
    expect(composed.sequence!.segments.map((s) => s.waitBeforeS)).toEqual([0, 0]);
  });

  it('plays the composition through the unified clock with parked waits', () => {
    let robot = fixture('clock', 4);
    robot = applySequenceSegments(robot, [
      { id: 's1', routeId: 'route-a', waitBeforeS: 2 },
      { id: 's2', routeId: 'route-b', waitBeforeS: 0.5 },
    ]);
    const options = robot.routeOptions!;
    // t=2.5: inside segment A at local 0.5.
    const inside = options[0]!.trajectory.samples.find((s) => s.t === 0.5);
    expect(samplePoseAt(robot, 2.5).x).toBeCloseTo(inside!.x, 9);
    // t=6.2: the wait between A (ends at 6) and B (starts at 6.5) — parked
    // at A's end, not interpolated toward B.
    expect(samplePoseAt(robot, 6.2).x).toBeCloseTo(options[0]!.trajectory.samples.at(-1)!.x, 9);
    // t=0.5: the start delay — parked at A's start.
    expect(samplePoseAt(robot, 0.5).x).toBeCloseTo(options[0]!.trajectory.samples[0]!.x, 9);
  });

  it('reports real join status: continuous when poses meet, a measured gap when they do not', () => {
    const endX = 2;
    const a = {
      ...parseGhostAuto(raw, 'A.ghostauto'), id: 'meet', name: 'A', durationS: 2,
      samples: [
        { t: 0, x: 0, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
        { t: 2, x: endX, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      ],
    };
    const b = { ...a, id: 'meet-b', name: 'B', samples: [
      { t: 0, x: endX, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      { t: 2, x: endX + 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
    ] };
    const meet = makeSession(a);
    meet.routeId = 'route-a';
    meet.routeOptions = [
      { id: 'route-a', relPath: 'team/A.ghostauto', trajectory: a },
      { id: 'route-b', relPath: 'team/B.ghostauto', trajectory: b },
    ];
    const continuous = applySequenceSegments(meet, [
      { id: 's1', routeId: 'route-a', waitBeforeS: 0 },
      { id: 's2', routeId: 'route-b', waitBeforeS: 0 },
    ]);
    expect(checkSequenceJoins(continuous)).toEqual([]);
    // Two independently generated routes that miss each other: small deltas
    // are still measured and reported, never rounded away.
    const gappedRobot = makeSession(a);
    gappedRobot.routeId = 'route-a';
    gappedRobot.routeOptions = [
      { id: 'route-a', relPath: 'team/A.ghostauto', trajectory: a },
      { id: 'route-b', relPath: 'team/B.ghostauto', trajectory: { ...b, samples: b.samples.map((s) => ({ ...s, x: s.x + 0.5 })) } },
    ];
    const gapped = applySequenceSegments(gappedRobot, [
      { id: 's1', routeId: 'route-a', waitBeforeS: 0 },
      { id: 's2', routeId: 'route-b', waitBeforeS: 1 },
    ]);
    const issues = checkSequenceJoins(gapped);
    expect(issues.some((i) => i.kind === 'position')).toBe(true);
    expect(issues.find((i) => i.kind === 'position')!.seamT).toBe(2);
  });
});

describe('auto sequence in the workspace', () => {
  function dropFiles(files: File[]) {
    fireEvent.drop(window, { dataTransfer: { files } });
  }
  const openComposer = () => fireEvent.click(screen.getAllByRole('button', { name: 'Arrange timeline' })[0]!);
  const clipsInComposer = () => within(document.querySelector('.sequence-composer') as HTMLElement).getAllByRole('button', { name: /, \d+\.\d+–/ });
  function setStart(value: string) {
    const input = screen.getByRole('spinbutton', { name: 'Start' });
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  }

  it('composition saves with the session as one draft commit, and undo restores the unapplied draft', async () => {
    render(<App />);
    const files = ['A', 'B'].map((name) => {
      const file = new File([raw], `${name}.ghostauto`, { type: 'application/json' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `team/${name}.ghostauto` });
      return file;
    });
    dropFiles(files);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    openComposer();
    // Library routes live in the composer; clicking one appends to the draft.
    fireEvent.click(screen.getByRole('button', { name: /^B: / }));
    setStart('10.3'); // B: 10.30-13.30, leaving a 2 s wait after A
    fireEvent.click(screen.getByRole('button', { name: 'A, 0.00–8.30 s' }));
    setStart('2'); // A: 2.00-10.30, an exact seam before B
    expect(clipsInComposer()).toHaveLength(2);
    // Edits stay unsaved: the session file still carries no sequence.
    fireEvent.click(screen.getAllByRole('button', { name: 'Save session', exact: true })[0]!);
    const before = JSON.parse(vi.mocked(saveText).mock.calls.at(-1)![2]);
    expect(before.robots[0].sequence).toBeUndefined();
    // Composer Save applies the whole draft as ONE history step.
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Save session', exact: true })[0]!);
    const saved = JSON.parse(vi.mocked(saveText).mock.calls.at(-1)![2]);
    expect(saved.robots).toHaveLength(1);
    expect(saved.robots[0].sequence.segments).toHaveLength(2);
    expect(saved.robots[0].startDelayS).toBe(2);
    const optionIds = saved.robots[0].routeOptions.map((o: { id: string }) => o.id);
    expect(saved.robots[0].sequence.segments.map((s: AutoSequenceSegment) => s.routeId)).toEqual(optionIds);
    // Undo walks back past the Save: the unsaved draft comes back for
    // editing — the composer shows its two clips and offers Save/Cancel
    // again — while the robot itself returns to the single imported route
    // (session file: no sequence). The draft is restored, never applied.
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(clipsInComposer()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Save session', exact: true })[0]!);
    const undone = JSON.parse(vi.mocked(saveText).mock.calls.at(-1)![2]);
    expect(undone.robots[0].sequence).toBeUndefined();
    // Keep undoing through the draft edits (append, B's start, A's start —
    // each its own history step) until the clean single-route draft.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    }
    expect(clipsInComposer()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Save', exact: true })).not.toBeInTheDocument();
  });

  it('undoing a Cancel restores the unsaved draft for editing, never applied', async () => {
    render(<App />);
    const files = ['A', 'B'].map((name) => {
      const file = new File([raw], `${name}.ghostauto`, { type: 'application/json' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `team/${name}.ghostauto` });
      return file;
    });
    dropFiles(files);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    openComposer();
    fireEvent.click(screen.getByRole('button', { name: /^B: / }));
    setStart('9'); // B: 9.00-17.30 in the draft (8.3 would overlap A)
    expect(clipsInComposer()).toHaveLength(2);
    // Cancel discards the draft and leaves the composer: the robot keeps
    // playing its single imported route.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(document.querySelector('.sequence-composer')).toBeNull();
    expect(document.querySelector('.timeline-workspace')).not.toBeNull();
    // Undo brings the editing session back: composer open, draft restored
    // (two clips, Save offered) — and still nothing applied to the robot.
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(document.querySelector('.sequence-composer')).not.toBeNull();
    expect(clipsInComposer()).toHaveLength(2);
    // Redo re-cancels: draft gone, composer closed, robot untouched.
    fireEvent.click(screen.getByRole('button', { name: 'Redo', exact: true }));
    expect(document.querySelector('.sequence-composer')).toBeNull();
    // The restored draft stays editable: undo once more and Save it.
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(clipsInComposer()).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Save', exact: true })).not.toBeInTheDocument();
  });

  it('restores a saved composition from a session file', async () => {
    const a: Trajectory = {
      id: 'restored', name: 'A', teamName: 'Team', teamNumber: '0001', source: 'ghostauto', alliance: 'blue',
      samples: [
        { t: 0, x: 0, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
        { t: 2, x: 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      ],
      durationS: 2,
      geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 },
      geometrySource: 'file', moduleLocations: [], events: [], warnings: [],
    };
    const b: Trajectory = { ...a, id: 'restored-b', name: 'B', samples: [
      { t: 0, x: 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      { t: 2, x: 4, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
    ] };
    const robot = makeSession(a);
    robot.routeId = 'route-a';
    robot.routeOptions = [
      { id: 'route-a', relPath: 'team/A.ghostauto', trajectory: a },
      { id: 'route-b', relPath: 'team/B.ghostauto', trajectory: b },
    ];
    const composed = applySequenceSegments(robot, [
      { id: 's1', routeId: 'route-a', waitBeforeS: 1.5 },
      { id: 's2', routeId: 'route-b', waitBeforeS: 0.5 },
    ]);
    const text = serializeSession([composed], 'reefscape-2025');
    render(<App />);
    dropFiles([new File([text], 'session.pb', { type: 'application/json' })]);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    openComposer();
    expect(screen.getByRole('button', { name: 'A, 1.50–3.50 s' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'B, 4.00–6.00 s' })).toBeInTheDocument();
    // Waits round-trip bit-for-bit through the session file.
    const saved = JSON.parse(text).robots[0];
    expect(saved.sequence.segments.map((s: AutoSequenceSegment) => s.waitBeforeS)).toEqual([1.5, 0.5]);
  });
});
