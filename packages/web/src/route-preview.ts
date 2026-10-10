import { useEffect, useState } from 'react';
import type { SessionTrajectory } from '@pathblender/core';
import { sequenceViewFor } from './auto-sequence-state';

/** A render-only route view. Never sent to session history, exports or autosave. */
export function previewRouteFor(robot: SessionTrajectory | undefined, routeId: string): SessionTrajectory | undefined {
  if (!robot) return;
  const route = sequenceViewFor(robot).routes.find((option) => option.id === routeId);
  if (!route) return;
  return { ...robot, sequence: undefined, startDelayS: 0, visible: true, routeId,
    trajectory: { ...route.trajectory, id: robot.trajectory.id, teamNumber: robot.trajectory.teamNumber,
      teamName: robot.trajectory.teamName, displayName: robot.trajectory.displayName } };
}

/** Independent preview clock: the main clock remains frozen at its old time. */
export function useRoutePreviewClock(robot: SessionTrajectory | undefined): number {
  const [frame, setFrame] = useState<{ robot: SessionTrajectory; t: number } | null>(null);
  useEffect(() => {
    if (!robot || robot.trajectory.durationS <= 0) return;
    let raf = 0;
    let start: number | undefined;
    const tick = (now: number) => {
      start ??= now;
      setFrame({ robot, t: ((now - start) / 1000) % robot.trajectory.durationS });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [robot]);
  return frame?.robot === robot ? frame?.t ?? 0 : 0;
}
