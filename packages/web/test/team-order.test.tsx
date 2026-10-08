import { cleanup, fireEvent, render, renderHook, act } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GEOMETRY, deserializeSession, serializeSession, type SessionTrajectory } from '@pathblender/core';
import { moveTeamOrder } from '../src/team-order';
import { useSessionHistory } from '../src/session-history';
import { RobotList } from '../src/components/RobotList';
import { Timeline } from '../src/components/Timeline';
import { I18nProvider } from '../src/i18n';
import type { TeamOrderUI } from '../src/components/TeamOrderUI';

/** Teams identified by id only — same team numbers on purpose for the
 * duplicate-number case, distinct start delays for the timing-invariance
 * assertions. */
function team(id: string, teamNumber = ''): SessionTrajectory {
  return {
    startDelayS: id.charCodeAt(0), visible: true, color: `#${id}`,
    trajectory: {
      id, name: id, teamName: '', teamNumber,
      source: 'choreo-traj', alliance: 'blue', durationS: 4,
      samples: [{ t: 0, x: 0, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 }, { t: 4, x: 1, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 }],
      geometry: DEFAULT_GEOMETRY, geometrySource: 'default', moduleLocations: [], events: [], warnings: [],
    },
  };
}
const ids = (robots: SessionTrajectory[]) => robots.map((r) => r.trajectory.id);

afterEach(cleanup);

describe('moveTeamOrder', () => {
  it('moves a team before and after a later target', () => {
    const robots = [team('a'), team('b'), team('c'), team('d')];
    expect(ids(moveTeamOrder(robots, 'a', 'c', 'after'))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(moveTeamOrder(robots, 'a', 'd', 'before'))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves a later team up past several teams', () => {
    const robots = [team('a'), team('b'), team('c'), team('d')];
    expect(ids(moveTeamOrder(robots, 'd', 'a', 'before'))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(moveTeamOrder(robots, 'c', 'a', 'before'))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('returns the same array reference when nothing would change', () => {
    const robots = [team('a'), team('b'), team('c')];
    expect(moveTeamOrder(robots, 'a', 'a', 'after')).toBe(robots);
    expect(moveTeamOrder(robots, 'ghost', 'b', 'after')).toBe(robots);
    expect(moveTeamOrder(robots, 'a', 'ghost', 'after')).toBe(robots);
    // Dropping onto the edge a team already occupies is a no-op.
    expect(moveTeamOrder(robots, 'a', 'b', 'before')).toBe(robots);
    expect(moveTeamOrder(robots, 'b', 'a', 'after')).toBe(robots);
    expect(moveTeamOrder(robots, 'a', 'b', 'before')).toBe(robots);
  });

  it('reuses every slot object by reference and never touches timing', () => {
    const robots = [team('a'), team('b'), team('c')];
    const delays = new Map(robots.map((r) => [r.trajectory.id, r.startDelayS]));
    const moved = moveTeamOrder(robots, 'c', 'a', 'before');
    expect(moved).not.toBe(robots);
    expect(moved).toEqual(expect.arrayContaining(robots));
    for (const robot of moved) {
      expect(robots).toContain(robot);
      expect(robot.startDelayS).toBe(delays.get(robot.trajectory.id));
    }
  });

  it('orders teams that share one team number by id, not by number', () => {
    const robots = [team('x', '2910'), team('y', '2910')];
    const moved = moveTeamOrder(robots, 'y', 'x', 'before');
    expect(ids(moved)).toEqual(['y', 'x']);
    expect(moved.every((r) => r.trajectory.teamNumber === '2910')).toBe(true);
  });
});

describe('team order through the session history', () => {
  const init = { id: 'rebuilt-2026', variant: 'welded' as const, style: 'schematic' as const };

  it('is one undo step: undo restores the previous order, redo reapplies', () => {
    const { result } = renderHook(() => useSessionHistory(init));
    act(() => result.current.setRobots([team('a'), team('b'), team('c')]));
    act(() => result.current.setRobots((prev) => moveTeamOrder(prev, 'c', 'a', 'before')));
    expect(ids(result.current.robots)).toEqual(['c', 'a', 'b']);
    act(() => result.current.undo());
    expect(ids(result.current.robots)).toEqual(['a', 'b', 'c']);
    act(() => result.current.redo());
    expect(ids(result.current.robots)).toEqual(['c', 'a', 'b']);
  });

  it('leaves no undo step when the drop lands where the team already sits', () => {
    const { result } = renderHook(() => useSessionHistory(init));
    act(() => result.current.setRobots([team('a'), team('b')]));
    act(() => result.current.setRobots((prev) => moveTeamOrder(prev, 'b', 'a', 'before')));
    expect(ids(result.current.robots)).toEqual(['b', 'a']);
    // A no-op move (a onto the edge after b it already occupies) must not
    // push a step: the next undo still lands on the pre-move order.
    act(() => result.current.setRobots((prev) => moveTeamOrder(prev, 'a', 'b', 'after')));
    expect(ids(result.current.robots)).toEqual(['b', 'a']);
    act(() => result.current.undo());
    expect(ids(result.current.robots)).toEqual(['a', 'b']);
  });
});

describe('session files keep the display order', () => {
  it('round-trips a moved order with ids and timing intact', () => {
    const robots = moveTeamOrder([team('a'), team('b'), team('c')], 'b', 'c', 'after');
    const restored = deserializeSession(serializeSession(robots, 'rebuilt-2026'));
    expect(ids(restored.robots)).toEqual(['a', 'c', 'b']);
    expect(restored.robots.map((r) => r.startDelayS)).toEqual(robots.map((r) => r.startDelayS));
  });

  it('restores an old v1 file in its own file order (no order field exists)', () => {
    const robot = (id: string, name: string) => ({
      id, name, teamName: '', teamNumber: '', source: 'choreo-traj', alliance: 'blue',
      startDelayS: 0, color: '#C5A16A', visible: true, geometry: DEFAULT_GEOMETRY,
      geometrySource: 'default', moduleLocations: [], events: [], samples: [],
    });
    const file = {
      app: 'pathblender', version: 1, fieldId: 'rebuilt-2026', savedAt: '2026-10-01T00:00:00Z',
      // A pre-feature file lists robots in whatever order it was saved with.
      robots: [robot('old-c', 'Third'), robot('old-a', 'First'), robot('old-b', 'Second')],
    };
    const restored = deserializeSession(JSON.stringify(file));
    expect(restored.robots.map((r) => r.trajectory.name)).toEqual(['Third', 'First', 'Second']);
  });
});

/** One workspace state shared by both panels, like App wires them. React
 * state (not a mutated closure) so a move re-renders both lists. */
function Workspace({ initial }: { initial: SessionTrajectory[] }) {
  const playback = { t: 6, setT: vi.fn(), playing: true, setPlaying: vi.fn(), speed: 1, setSpeed: vi.fn() };
  const delays = new Map(initial.map((r) => [r.trajectory.id, r.startDelayS]));
  function Harness() {
    const [robots, setRobots] = useState(initial);
    const onMove = useCallback((id: string, targetId: string, edge: 'before' | 'after') => {
      setRobots((prev) => moveTeamOrder(prev, id, targetId, edge));
    }, []);
    const order: TeamOrderUI = {
      ids: ids(robots),
      onMove,
    };
    return (
      <I18nProvider>
        <RobotList
          teamOrder={order} robots={robots} conflicts={[]} selectedId={null}
          onSelect={() => {}} onImport={() => {}} onUpdate={() => {}}
        />
        <Timeline
          teamOrder={order} robots={robots} autoPeriodS={20} duration={8}
          playback={playback}
        />
      </I18nProvider>
    );
  }
  render(<Harness />);
  return { playback, delays };
}

const MIME = 'application/x-pathblender-team-order';
const dataTransfer = () => ({
  types: [MIME], files: [] as unknown[], dropEffect: 'move', effectAllowed: 'move',
  setData: () => {}, setDragImage: () => {}, getData: () => '',
});

const listIds = () =>
  [...document.querySelectorAll('.robot-library-row')].map((row) => (row as HTMLElement).dataset.teamOrderId);
const timelineIds = () =>
  [...document.querySelectorAll('.timeline-row')].map((row) => (row.firstElementChild as HTMLElement).dataset.teamOrderId ?? row.dataset.teamOrderId);
const rowOf = (id: string, list: 'cards' | 'rows') => {
  const rows = list === 'cards'
    ? [...document.querySelectorAll('.robot-library-row')]
    : [...document.querySelectorAll('.timeline-row')];
  return rows.find((row) => (row as HTMLElement).dataset.teamOrderId === id) as HTMLElement;
};
const handleOf = (id: string, list: 'cards' | 'rows') =>
  rowOf(id, list).querySelector('.team-order-handle') as HTMLElement;

describe('the robot list and timeline share one order', () => {
  it('dragging a card handle reorders both panels and changes no timing or playback state', () => {
    const w = Workspace({ initial: [team('a', '10'), team('b', '20'), team('c', '30')] });
    fireEvent.dragStart(handleOf('a', 'cards'), { dataTransfer: dataTransfer() });
    // jsdom boxes have zero height, so the drop resolves to the 'after' edge.
    fireEvent.dragOver(rowOf('c', 'cards'), { dataTransfer: dataTransfer(), clientY: 0 });
    fireEvent.drop(rowOf('c', 'cards'), { dataTransfer: dataTransfer() });
    expect(listIds()).toEqual(['b', 'c', 'a']);
    expect(timelineIds()).toEqual(['b', 'c', 'a']);
    // Slots kept their own timing through the move…
    expect(listIds().map((id) => w.delays.get(id))).toEqual(['b'.charCodeAt(0), 'c'.charCodeAt(0), 'a'.charCodeAt(0)]);
    // …and playback was not touched by a reorder.
    expect(w.playback.setT).not.toHaveBeenCalled();
    expect(w.playback.setPlaying).not.toHaveBeenCalled();
    expect(w.playback.t).toBe(6);
  });

  it('dragging a timeline handle reorders both panels the same way', () => {
    Workspace({ initial: [team('a', '10'), team('b', '20'), team('c', '30')] });
    fireEvent.dragStart(handleOf('c', 'rows'), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(rowOf('a', 'rows'), { dataTransfer: dataTransfer(), clientY: 0 });
    fireEvent.drop(rowOf('a', 'rows'), { dataTransfer: dataTransfer() });
    // 'after' a (zero-height box) puts c second.
    expect(listIds()).toEqual(['a', 'c', 'b']);
    expect(timelineIds()).toEqual(['a', 'c', 'b']);
  });

  it('ignores a drop that never started as a team drag (file drop isolation)', () => {
    Workspace({ initial: [team('a', '10'), team('b', '20')] });
    fireEvent.drop(rowOf('b', 'cards'), { dataTransfer: { types: ['Files'], files: [], getData: () => '' } });
    expect(listIds()).toEqual(['a', 'b']);
  });

  it('keeps focus on the handle through a keyboard move and announces the position', () => {
    Workspace({ initial: [team('a', '10'), team('b', '20'), team('c', '30')] });
    const handle = handleOf('a', 'cards');
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(listIds()).toEqual(['b', 'a', 'c']);
    expect(timelineIds()).toEqual(['b', 'a', 'c']);
    expect(document.activeElement).toBe(handle);
    expect(handle.getAttribute('aria-label')).toContain('2');
    expect(document.querySelector('.team-order-live')?.textContent).toMatch(/position 2/);
  });

  it('ignores arrow keys at the ends and stays put', () => {
    Workspace({ initial: [team('a', '10'), team('b', '20')] });
    const handle = handleOf('a', 'cards');
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(listIds()).toEqual(['a', 'b']);
    expect(document.querySelector('.team-order-live')).toHaveTextContent('');
  });

  it('keeps hidden teams in the order and draggable', () => {
    const hidden = { ...team('h', '40'), visible: false };
    Workspace({ initial: [team('a', '10'), hidden] });
    const row = rowOf('h', 'cards');
    expect(row.classList.contains('is-hidden')).toBe(true);
    fireEvent.dragStart(handleOf('h', 'cards'), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(rowOf('a', 'cards'), { dataTransfer: dataTransfer(), clientY: 0 });
    fireEvent.drop(rowOf('a', 'cards'), { dataTransfer: dataTransfer() });
    expect(listIds()).toEqual(['a', 'h']);
    expect(timelineIds()).toEqual(['a', 'h']);
  });

  it('renders a disabled handle per panel for a single team', () => {
    Workspace({ initial: [team('a', '10')] });
    const handles = [...document.querySelectorAll('.team-order-handle')] as HTMLButtonElement[];
    expect(handles).toHaveLength(2); // one in the card list, one in the timeline
    expect(handles.every((handle) => handle.disabled)).toBe(true);
  });
});
