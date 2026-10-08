import type { SessionTrajectory } from '@pathblender/core';

/**
 * Team display order (2026-10-08): the order teams appear in — robot list,
 * timeline rows, every team enumeration — IS the session's robots array
 * order. No parallel `order` field exists anywhere: serializeSession writes
 * the array in order (so .pb files, autosave and undo/redo all persist the
 * order for free), old files restore in their file order, and identity is
 * always the trajectory id, never an index. This helper is the single place
 * that reshuffles the array, so "display order" can never drift from
 * "storage order".
 *
 * Slot objects are reused by reference — a move clones the array but never
 * the robots, so the history reducer's per-index reference check both spots
 * the change and suppresses the undo step when a drop lands where the team
 * already sits (adjacent-edge no-ops return the input reference unchanged).
 */
export function moveTeamOrder(
  robots: readonly SessionTrajectory[],
  id: string,
  targetId: string,
  edge: 'before' | 'after',
): SessionTrajectory[] {
  if (id === targetId) return robots as SessionTrajectory[];
  const from = robots.findIndex((r) => r.trajectory.id === id);
  if (from < 0 || !robots.some((r) => r.trajectory.id === targetId)) return robots as SessionTrajectory[];
  const next = robots.filter((_, i) => i !== from);
  // With the moved slot filtered out, re-locate the target by id: its index
  // shifted by one when it sat after the moved slot, and both edges are an
  // insert at that live index (+1 for 'after').
  const at = next.findIndex((r) => r.trajectory.id === targetId) + (edge === 'after' ? 1 : 0);
  // Inserting at the slot's own former index reproduces the array verbatim
  // (dropping a team onto the edge it already occupies) — hand back the same
  // reference so no layer below records a phantom change.
  if (at === from) return robots as SessionTrajectory[];
  next.splice(at, 0, robots[from]!);
  return next;
}
