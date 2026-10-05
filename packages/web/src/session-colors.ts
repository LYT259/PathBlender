/**
 * Colorblind-palette alignment for robots ENTERING the session state —
 * autosave restore, session-file import, path import, and the welcome
 * example. The toggle effect in App only runs when the preference flips,
 * so robots that arrived while the preference was already on (or was on
 * before this launch) would otherwise keep default-palette colors on
 * screen in colorblind mode. Disabled preferences still pass through the
 * remap once: a colorblind-palette color saved under an enabled
 * preference maps back to its default slot.
 *
 * Idempotent by reference: already-aligned colors return the original
 * robot object, so callers never push a no-op change onto the session
 * history.
 */

import { remapColorblind, type SessionTrajectory } from '@pathblender/core';

export function withColorblindPalette(
  robots: readonly SessionTrajectory[],
  enabled: boolean,
): SessionTrajectory[] {
  return robots.map((robot) => {
    const color = remapColorblind(robot.color, enabled);
    return color === robot.color ? robot : { ...robot, color };
  });
}
