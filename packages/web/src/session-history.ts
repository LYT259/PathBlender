import { useCallback, useReducer, useRef } from 'react';
import type { Alliance, FieldArtStyle, FieldPackage, SessionTrajectory } from '@pathblender/core';
import type { AutoSequenceSegment } from './auto-sequence-state';

type RobotUpdate = SessionTrajectory[] | ((previous: SessionTrajectory[]) => SessionTrajectory[]);
/** Per-team unsaved arrangement drafts, keyed by trajectory id. Only DIRTY teams appear. */
export type SequenceDrafts = Record<string, AutoSequenceSegment[]>;
interface Scene {
  alliance: Alliance;
  fieldId: string;
  fieldVariant: 'welded' | 'andymark';
  fieldStyle: FieldArtStyle;
  customField?: FieldPackage;
  customImageUrl?: string;
}
interface Snapshot extends Scene {
  robots: SessionTrajectory[];
  /**
   * Unsaved composer drafts ride the history so undo/redo can restore them:
   * undoing a Cancel brings the unsaved draft back for editing (user decision
   * 2026-10-05) without ever applying it to playback, and undoing a Save
   * returns both the robots and the draft. Drafts are session-state only —
   * they are deliberately absent from autosave and session files, which
   * persist saved arrangements alone.
   */
  drafts: SequenceDrafts;
  composerOpen: boolean;
}
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
  if (sameRobots && next.alliance === previous.alliance && next.fieldId === previous.fieldId && next.fieldVariant === previous.fieldVariant && next.fieldStyle === previous.fieldStyle && next.customField === previous.customField && next.customImageUrl === previous.customImageUrl && next.drafts === previous.drafts && next.composerOpen === previous.composerOpen) return state;
  // A continuous waypoint drag is one change; unrelated commands never merge.
  const continuous = action.group != null && action.group === state.group;
  return { past: continuous ? state.past : [...state.past, previous].slice(-LIMIT), present: next, future: [], group: action.group };
}

/** Undo restores field, robots, unsaved drafts and composer state together. */
export function useSessionHistory(initial: { id: string; variant: 'welded' | 'andymark'; style: FieldArtStyle }) {
  const [state, dispatch] = useReducer(reduce, { past: [], present: { robots: [], alliance: 'blue' as Alliance, fieldId: initial.id, fieldVariant: initial.variant, fieldStyle: initial.style, drafts: {}, composerOpen: false }, future: [] });
  const groupSequence = useRef(0);
  const activeGroup = useRef<number | undefined>(undefined);
  const beginEdit = useCallback(() => { activeGroup.current = ++groupSequence.current; }, []);
  const endEdit = useCallback(() => { activeGroup.current = undefined; }, []);
  const setRobots = useCallback((update: RobotUpdate) => dispatch({ type: 'change', update: (previous) => ({ ...previous, robots: typeof update === 'function' ? update(previous.robots) : update }), group: activeGroup.current }), []);
  const setScene = useCallback((patch: Partial<Snapshot>) => dispatch({ type: 'change', update: (previous) => ({ ...previous, ...patch }) }), []);
  const setDrafts = useCallback((update: SequenceDrafts | ((previous: SequenceDrafts) => SequenceDrafts)) => dispatch({ type: 'change', update: (previous) => ({ ...previous, drafts: typeof update === 'function' ? update(previous.drafts) : update }) }), []);
  const setComposerOpen = useCallback((open: boolean) => dispatch({ type: 'change', update: (previous) => ({ ...previous, composerOpen: open }) }), []);
  /**
   * One history step spanning several snapshot fields — Save (apply the draft
   * to the robots AND drop it) and slot removal (robots AND its draft) must
   * not split, or undo would land halfway through a transaction.
   */
  const change = useCallback((update: (previous: Snapshot) => Snapshot) => dispatch({ type: 'change', update }), []);
  const undo = useCallback(() => { activeGroup.current = undefined; dispatch({ type: 'undo' }); }, []);
  const redo = useCallback(() => { activeGroup.current = undefined; dispatch({ type: 'redo' }); }, []);
  return { ...state.present, setRobots, setScene, setDrafts, setComposerOpen, change, beginEdit, endEdit, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
