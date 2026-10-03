/**
 * Mouse-controls preferences (user request 2026-10-02, verified against
 * Onshape's production UI 2026-10-03): the view-manipulation scheme plus
 * Onshape's three view checkboxes. Two schemes ship, with bindings taken
 * verbatim from Onshape's own settings table:
 *
 * - onshape (default): right drag = rotate, Alt+right drag = constrained
 *   rotate, Ctrl+right drag OR middle drag = pan, wheel = zoom.
 * - solidworks: middle drag = rotate, Alt+middle drag = constrained
 *   rotate, Ctrl+middle drag = pan, wheel OR Shift+middle drag = zoom.
 *   (Also how the real SOLIDWORKS desktop works.)
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

/**
 * What a pressed mouse button does in the 3D view — the pure routing table
 * behind the schemes above (unit-tested; the canvas handlers stay thin).
 * `defaultConstrained` is Onshape's "set default rotation behavior to
 * constrained rotate" checkbox: it swaps which of plain/Alt drags is the
 * turntable-only rotation.
 */
export type ViewMouseAction =
  | { kind: 'orbit'; constrained: boolean }
  | { kind: 'pan' }
  | { kind: 'dragZoom' }
  | { kind: 'none' };

export function resolveMouseAction(
  scheme: MouseControlsScheme,
  button: number,
  mods: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  defaultConstrained: boolean,
): ViewMouseAction {
  const constrained = mods.altKey ? !defaultConstrained : defaultConstrained;
  if (scheme === 'solidworks') {
    if (button !== 1) return { kind: 'none' };
    if (mods.shiftKey) return { kind: 'dragZoom' };
    if (mods.ctrlKey) return { kind: 'pan' };
    return { kind: 'orbit', constrained };
  }
  // onshape
  if (button === 2) {
    if (mods.ctrlKey) return { kind: 'pan' };
    return { kind: 'orbit', constrained };
  }
  if (button === 1) return { kind: 'pan' };
  return { kind: 'none' };
}

/** Onshape's three view checkboxes as boolean prefs ('on'/'off' storage). */
type BoolPrefKey = 'reverseScroll' | 'defaultConstrained' | 'penAsMouse';

function booleanPref(storageKey: string, prefKey: BoolPrefKey, fallback: boolean) {
  const subs = new Set<(value: boolean) => void>();
  const read = (): boolean => {
    try {
      const value = localStorage.getItem(storageKey);
      return value === null ? fallback : value === 'on';
    } catch {
      return fallback;
    }
  };
  const write = (value: boolean): void => {
    try {
      localStorage.setItem(storageKey, value ? 'on' : 'off');
    } catch {
      // Storage unavailable (private mode); in-memory only.
    }
    subs.forEach((fn) => fn(value));
    broadcastPref(prefKey, value ? 'on' : 'off');
  };
  const use = (): [boolean, (value: boolean) => void] => {
    const [state, setState] = useState<boolean>(read);
    useEffect(() => {
      subs.add(setState);
      const unlisten = listenPrefs((key, value) => {
        if (key === prefKey) setState(value === 'on');
      });
      return () => {
        subs.delete(setState);
        unlisten();
      };
    }, []);
    return [state, write];
  };
  return { read, write, use };
}

/** Wheel zooms the opposite way (Onshape's factory default: off). */
export const reverseScrollPref = booleanPref('pb.reverseScroll', 'reverseScroll', false);
/** Plain drag becomes turntable-only rotation; Alt drags are free. */
export const defaultConstrainedPref = booleanPref('pb.defaultConstrained', 'defaultConstrained', false);
/** Pen/stylus input drives the view like a mouse (default on — our viewer has
 * no pen-specific gesture yet, so a pen already works as a mouse). */
export const penAsMousePref = booleanPref('pb.penAsMouse', 'penAsMouse', true);

export const useReverseScrollZoom = reverseScrollPref.use;
export const useDefaultConstrained = defaultConstrainedPref.use;
export const usePenAsMouse = penAsMousePref.use;
