import { useCallback, useReducer, useRef } from 'react';
import type { Alliance, FieldArtStyle, FieldPackage, SessionTrajectory } from '@pathblender/core';

type RobotUpdate = SessionTrajectory[] | ((previous: SessionTrajectory[]) => SessionTrajectory[]);
interface Scene {
  alliance: Alliance;
  fieldId: string;
  fieldVariant: 'welded' | 'andymark';
  fieldStyle: FieldArtStyle;
  customField?: FieldPackage;
  customImageUrl?: string;
}
interface Snapshot extends Scene { robots: SessionTrajectory[] }
interface History {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
  group?: number;
}
type Action = { type: 'change'; update: (previous: Snapshot) => Snapshot; group?: number } | { type: 'undo' | 'redo' };
const LIMIT = 20;

function reduce(state: History, action: Action): History {
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state;
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    return next ? { past: [...state.past, state.present].slice(-LIMIT), present: next, future: state.future.slice(1) } : state;
  }
  if (action.type !== 'change') return state;
  const next = action.update(state.present);
  const previous = state.present;
  const sameRobots = next.robots.length === previous.robots.length && next.robots.every((robot, i) => robot === previous.robots[i]);
  if (sameRobots && next.alliance === previous.alliance && next.fieldId === previous.fieldId && next.fieldVariant === previous.fieldVariant && next.fieldStyle === previous.fieldStyle && next.customField === previous.customField && next.customImageUrl === previous.customImageUrl) return state;
  // A continuous waypoint drag is one change; unrelated commands never merge.
  const continuous = action.group != null && action.group === state.group;
  return { past: continuous ? state.past : [...state.past, previous].slice(-LIMIT), present: next, future: [], group: action.group };
}

/** Undo restores field and robots together, including whole-session imports. */
export function useSessionHistory(initial: { id: string; variant: 'welded' | 'andymark'; style: FieldArtStyle }) {
  const [state, dispatch] = useReducer(reduce, { past: [], present: { robots: [], alliance: 'blue' as Alliance, fieldId: initial.id, fieldVariant: initial.variant, fieldStyle: initial.style }, future: [] });
  const groupSequence = useRef(0);
  const activeGroup = useRef<number | undefined>(undefined);
  const beginEdit = useCallback(() => { activeGroup.current = ++groupSequence.current; }, []);
  const endEdit = useCallback(() => { activeGroup.current = undefined; }, []);
  const setRobots = useCallback((update: RobotUpdate) => dispatch({ type: 'change', update: (previous) => ({ ...previous, robots: typeof update === 'function' ? update(previous.robots) : update }), group: activeGroup.current }), []);
  const setScene = useCallback((patch: Partial<Snapshot>) => dispatch({ type: 'change', update: (previous) => ({ ...previous, ...patch }) }), []);
  const undo = useCallback(() => { activeGroup.current = undefined; dispatch({ type: 'undo' }); }, []);
  const redo = useCallback(() => { activeGroup.current = undefined; dispatch({ type: 'redo' }); }, []);
  return { ...state.present, setRobots, setScene, beginEdit, endEdit, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
