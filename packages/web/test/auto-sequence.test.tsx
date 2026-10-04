import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeEndT,
  checkSequenceJoins,
  makeSession,
  parseGhostAuto,
  samplePoseAt,
  sampleTrajectory,
  serializeSession,
  type SessionTrajectory,
  type Trajectory,
} from '@pathblender/core';
import { I18nProvider } from '../src/i18n';
import { AutoSequenceEditor } from '../src/components/AutoSequenceEditor';
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

/** A synthetic team with two routes that meet end-to-start (or not). */
function joinedFixture(gapM = 0): SessionTrajectory {
  const endX = 2;
  const a: Trajectory = {
    id: 'a', name: 'A', teamName: 'Team', teamNumber: '0000', source: 'ghostauto', alliance: 'blue',
    samples: [
      { t: 0, x: 0, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
      { t: 2, x: endX, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
    ],
    durationS: 2,
    geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 },
    geometrySource: 'file', moduleLocations: [], events: [], warnings: [],
  };
  const b: Trajectory = { ...a, id: 'b', name: 'B', samples: [
    { t: 0, x: endX + gapM, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
    { t: 2, x: endX + gapM + 2, y: 0, heading: 0, vx: 0, vy: 0, omega: 0 },
  ] };
  const robot = makeSession(a);
  robot.routeId = 'a';
  robot.routeOptions = [
    { id: 'a', relPath: 'team/A.ghostauto', trajectory: a },
    { id: 'b', relPath: 'team/B.ghostauto', trajectory: b },
  ];
  return robot;
}

function Preview({ robot, onState, onJump }: {
  robot: SessionTrajectory;
  onState?: (r: SessionTrajectory) => void;
  onJump?: (t: number) => void;
}) {
  const [state, setState] = useState(robot);
  // Mirror the latest committed state outside the updater: React may call
  // updaters eagerly or twice, so side effects there are not a stable hook.
  const stateRef = useRef(state);
  const commit = (segments: AutoSequenceSegment[]) => {
    const next = applySequenceSegments(stateRef.current, segments);
    stateRef.current = next;
    setState(next);
    onState?.(next);
  };
  const view = sequenceViewFor(state);
  return <I18nProvider>
    <AutoSequenceEditor routes={view.routes} segments={view.segments} joins={checkSequenceJoins(state)} onChange={commit} onJump={onJump} />
  </I18nProvider>;
}

function setStart(index: number, value: string) {
  const input = screen.getByRole('spinbutton', { name: `Start ${index}`, exact: true });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}
function add() { fireEvent.click(screen.getByRole('button', { name: 'Add route', exact: true })); }
const start = (n: number) => screen.getByRole('spinbutton', { name: `Start ${n}`, exact: true });

beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); vi.clearAllMocks(); });

describe('auto sequence editor (real state)', () => {
  it('commits an arrangement to the robot: waits, start delay and end times', () => {
    let robot: SessionTrajectory | undefined;
    render(<Preview robot={fixture()} onState={(r) => { robot = r; }} />);
    add(); add();
    setStart(1, '2');
    setStart(2, '7');
    expect(start(1)).toHaveValue(2);
    expect(screen.getByLabelText('End 1')).toHaveTextContent('6.00');
    expect(start(2)).toHaveValue(7);
    expect(start(3)).toHaveValue(10);
    expect(screen.getByLabelText('End 3')).toHaveTextContent('13.00');
    expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === 'Wait 1.00 s')).toBeInTheDocument();
    expect(robot!.sequence?.segments).toHaveLength(3);
    expect(robot!.startDelayS).toBe(2);
    expect(robot!.sequence!.segments[1]!.waitBeforeS).toBe(1);
    expect(activeEndT(robot!)).toBe(13);
  });

  it('plays the composition through the unified clock', () => {
    let robot: SessionTrajectory | undefined;
    render(<Preview robot={joinedFixture(0)} onState={(r) => { robot = r; }} />);
    add();
    setStart(1, '2');
    setStart(2, '4.5');
    const options = robot!.routeOptions!;
    // A: x 0→2 over 2 s (start 2, end 4); B: x 2→4 (wait 0.5, start 4.5).
    // t=5: inside segment B at local 0.5.
    const expected = sampleTrajectory(options[1]!.trajectory.samples, 0.5)!;
    expect(samplePoseAt(robot!, 5).x).toBeCloseTo(expected.x, 9);
    // t=4.2: the wait between A and B — parked at A's end, not interpolated.
    expect(samplePoseAt(robot!, 4.2).x).toBeCloseTo(2, 9);
    // t=0.5: the start delay — parked at A's start.
    expect(samplePoseAt(robot!, 0.5).x).toBeCloseTo(options[0]!.trajectory.samples[0]!.x, 9);
  });

  it('rejects overlap, negative and empty times without changing the committed arrangement', () => {
    let robot: SessionTrajectory | undefined;
    render(<Preview robot={fixture()} onState={(r) => { robot = r; }} />);
    add();
    setStart(2, '3');
    expect(screen.getByRole('alert')).toHaveTextContent('Earliest start: 4 s.');
    expect(start(2)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('End 2')).toHaveTextContent('7.00');
    fireEvent.keyDown(start(2), { key: 'Escape' });
    expect(start(2)).toHaveValue(4);
    setStart(1, '-1');
    expect(screen.getByRole('alert')).toHaveTextContent('non-negative');
    fireEvent.keyDown(start(1), { key: 'Escape' });
    setStart(1, '');
    expect(screen.getByRole('alert')).toHaveTextContent('non-negative');
    expect(robot!.sequence?.segments).toHaveLength(2);
    expect(robot!.sequence!.segments[0]!.waitBeforeS).toBe(0);
  });

  it('keeps exact imported timing when a rounded value is focused then left untouched', () => {
    render(<Preview robot={fixture('precise', 4.753697)} />);
    add();
    expect(start(2)).toBeValid();
    fireEvent.focus(start(2));
    expect(start(2)).toHaveValue(4.753697);
    fireEvent.blur(start(2));
    expect(start(2)).toBeValid();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(start(2)).toHaveAttribute('min', '4.753697');
    expect(screen.getByText('Continue immediately')).toBeInTheDocument();
  });

  it('changes routes and order while retaining waits and updating end times', () => {
    let robot: SessionTrajectory | undefined;
    render(<Preview robot={fixture()} onState={(r) => { robot = r; }} />);
    add();
    setStart(1, '2');
    setStart(2, '7');
    fireEvent.change(screen.getByRole('combobox', { name: 'Route 1', exact: true }), { target: { value: 'route-c' } });
    expect(start(2)).toHaveValue(6);
    fireEvent.click(screen.getByRole('button', { name: 'Move earlier 2', exact: true }));
    expect(screen.getByRole('combobox', { name: 'Route 1', exact: true })).toHaveValue('route-b');
    expect(start(1)).toHaveValue(2);
    expect(start(2)).toHaveValue(6);
    expect(screen.getByRole('button', { name: 'Move earlier 1', exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move later 2', exact: true })).toBeDisabled();
    expect(robot!.sequence!.segments.map((s) => s.routeId)).toEqual(['route-b', 'route-c']);
    // Waits belong to time slots: the 2 s start delay stays first.
    expect(robot!.sequence!.segments[0]!.waitBeforeS).toBe(2);
  });

  it('returns the slot to its single route when every segment is removed', () => {
    let robot: SessionTrajectory | undefined;
    render(<Preview robot={fixture()} onState={(r) => { robot = r; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove segment 1' }));
    expect(robot!.sequence).toBeUndefined();
    // The editor falls back to the legacy single segment (current route + delay).
    expect(start(1)).toHaveValue(0);
  });

  it('reports real join status: continuous when poses meet, a measured gap when they do not', () => {
    const { container } = render(<Preview robot={joinedFixture(0)} />);
    add();
    expect(within(container).getByText('Join continuous')).toBeInTheDocument();
    expect(within(container).queryByText(/position gap/)).not.toBeInTheDocument();
  });

  it('reports a position gap with its measurement and jumps to the seam', () => {
    const jumped: number[] = [];
    render(<Preview robot={joinedFixture(0.5)} onJump={(t) => jumped.push(t)} />);
    add();
    const badge = screen.getByText(/position gap/);
    expect(badge).toBeInTheDocument();
    fireEvent.click(badge);
    expect(jumped).toEqual([2]);
    expect(screen.getByText(/Fix the join in PathPlanner or Choreo/)).toBeInTheDocument();
  });

  it('keeps same-name routes distinguishable and exposes Chinese copy from the full dictionaries', () => {
    localStorage.setItem('pb.lang', 'zh');
    const robot = fixture();
    robot.routeOptions![1]!.relPath = 'team/right/A.ghostauto';
    render(<Preview robot={robot} />);
    expect(screen.getByRole('heading', { name: '自动组合' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'right/A.ghostauto' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: '开始 1' })).toHaveAttribute('aria-describedby');
  });
});

describe('auto sequence in the workspace', () => {
  function dropFiles(files: File[]) {
    fireEvent.drop(window, { dataTransfer: { files } });
  }

  it('composition saves with the session, disables the left picker, and undoes', async () => {
    render(<App />);
    const files = ['A', 'B'].map((name) => {
      const file = new File([raw], `${name}.ghostauto`, { type: 'application/json' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `team/${name}.ghostauto` });
      return file;
    });
    dropFiles(files);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Robot', exact: true }));
    add(); setStart(1, '2');
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    expect(start(1)).toHaveValue(2);
    // The left single-route picker hands over while a composition exists.
    expect(screen.getByRole('combobox', { name: /Active route for/ })).toBeDisabled();
    // Timeline spans the composition (the clock's total grows past one route).
    expect(document.querySelectorAll('.timeline-row')).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Save session', exact: true })[0]!);
    const saved = JSON.parse(vi.mocked(saveText).mock.calls.at(-1)![2]);
    expect(saved.robots).toHaveLength(1);
    expect(saved.robots[0].sequence.segments).toHaveLength(2);
    expect(saved.robots[0].startDelayS).toBe(2);
    // Undo walks the history back: first the start change, then the added
    // segment — the slot returns to its single route (picker re-enables).
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: /Active route for/ })).toBeEnabled();
  });

  it('restores a saved composition from a session file', async () => {
    const robot = fixture('restored', 4);
    const composed = applySequenceSegments(robot, [
      { id: 's1', routeId: 'route-a', waitBeforeS: 1.5 },
      { id: 's2', routeId: 'route-b', waitBeforeS: 0.5 },
    ]);
    const text = serializeSession([composed], 'reefscape-2025');
    render(<App />);
    dropFiles([new File([text], 'session.pb', { type: 'application/json' })]);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Robot', exact: true }));
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    expect(start(1)).toHaveValue(1.5);
    expect(start(2)).toHaveValue(6);
    expect(screen.getByRole('combobox', { name: /Active route for/ })).toBeDisabled();
  });
});
