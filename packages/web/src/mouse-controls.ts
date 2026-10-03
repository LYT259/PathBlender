/**
 * Mouse-controls scheme preference (user request 2026-10-02, modeled on
 * Onshape's web "Mouse controls" setting): which button rotates / pans /
 * zooms in the 3D view. Two schemes ship:
 *
 * - onshape (default): left = rotate, middle = pan, right = drag-zoom,
 *   wheel = zoom, Shift/Ctrl+left = pan.
 * - solidworks: middle = rotate, Ctrl+middle = pan, left = none (a viewer
 *   has no selection — the CAD muscle memory keeps working on the wheel
 *   and middle button), wheel = zoom, Shift/Ctrl+left = pan.
 *
 * Storage/broadcast follows the theme.tsx pattern (localStorage +
 * pref-sync events) so the settings window, the desktop shell and open
 * canvases stay in sync.
 */

import { useEffect, useState } from 'react';
import { broadcastPref, listenPrefs } from './pref-sync';

export type MouseControlsScheme = 'onshape' | 'solidworks';

const STORAGE_KEY = 'pb.mouseControls';
export const MOUSE_SCHEMES: MouseControlsScheme[] = ['onshape', 'solidworks'];

function normalize(value: string | null): MouseControlsScheme {
  return value === 'solidworks' ? 'solidworks' : 'onshape';
}

export function readMouseControls(): MouseControlsScheme {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'onshape';
  }
}

const listeners = new Set<(scheme: MouseControlsScheme) => void>();

export function writeMouseControls(scheme: MouseControlsScheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    // Storage can be unavailable (private mode); the in-memory choice
    // still applies for this session.
  }
  // In-process subscribers first (the web settings dialog shares the
  // window with the canvas — storage events don't fire in the writing
  // window), then the cross-window desktop bridge.
  listeners.forEach((fn) => fn(scheme));
  broadcastPref('mouseControls', scheme);
}

/** Live scheme: updates across windows when the preference broadcasts. */
export function useMouseControls(): [MouseControlsScheme, (s: MouseControlsScheme) => void] {
  const [scheme, setScheme] = useState<MouseControlsScheme>(readMouseControls);
  useEffect(() => {
    listeners.add(setScheme);
    const unlisten = listenPrefs((key, value) => {
      if (key === 'mouseControls') setScheme(normalize(value));
    });
    return () => {
      listeners.delete(setScheme);
      unlisten();
    };
  }, []);
  return [scheme, writeMouseControls];
}
