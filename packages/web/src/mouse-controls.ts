/**
 * Mouse-controls preferences (user request 2026-10-02, verified against
 * Onshape's production UI 2026-10-03 and SOLIDWORKS' official view-
 * manipulation docs 2026-10-04): the view-manipulation scheme plus
 * Onshape's three view checkboxes. Three schemes ship — the two presets
 * carry bindings taken verbatim from each vendor's own table, and the
 * third (custom, user request 2026-10-07) lets the user pick one action
 * per drag button:
 *
 * - onshape (default): right drag = rotate, Alt+right drag = constrained
 *   rotate, Ctrl+right drag OR middle drag = pan, wheel = zoom (scroll up
 *   zooms IN — Onshape's factory default).
 * - solidworks: middle drag = rotate, Alt+middle drag = ROLL VIEW (spin
 *   in the screen plane — NOT constrained rotate; that was a bug fixed
 *   2026-10-04), Ctrl+middle drag = pan, wheel OR Shift+middle drag =
 *   zoom (scroll up zooms OUT — SOLIDWORKS' factory default).
 * - custom: one user-chosen action per drag button; modifier combos are
 *   NOT assignable — they derive from fixed rules distilled from the two
 *   vendors' own tables (Ctrl+drag always pans, Shift+drag always zooms,
 *   Alt swaps free/constrained rotate on rotate buttons). The wheel is
 *   NOT assignable either — it always zooms. The per-button defaults
 *   mirror the onshape preset, so picking Custom changes nothing until a
 *   button is edited. (The first cut shipped same-day as beta.72 with a
 *   12-slot editable matrix; the user found it too complex and asked for
 *   single-button assignment with auto-derived combos.)
 *
 * Storage/broadcast follows the theme.tsx pattern (localStorage +
 * pref-sync events) so the settings window, the desktop shell and open
 * canvases stay in sync.
 */

import { useEffect, useState } from 'react';
import { broadcastPref, listenPrefs } from './pref-sync';

export type MouseControlsScheme = 'onshape' | 'solidworks' | 'custom';

const STORAGE_KEY = 'pb.mouseControls';
export const MOUSE_SCHEMES: MouseControlsScheme[] = ['onshape', 'solidworks', 'custom'];

function normalize(value: string | null): MouseControlsScheme {
  return value === 'solidworks' || value === 'custom' ? value : 'onshape';
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
 * The custom scheme's per-button assignments: one action per drag button
 * (left/middle/right). Modifier combos are NOT stored — they derive from
 * fixed rules in resolveMouseAction — and the wheel is not assignable
 * either: it always zooms, and only its direction can be reversed.
 */
export type CustomMouseButton = 'left' | 'middle' | 'right';
export type CustomMouseAction = 'rotate' | 'constrained' | 'pan' | 'zoom' | 'roll' | 'none';
export type CustomMouseMap = Record<CustomMouseButton, CustomMouseAction>;

export const CUSTOM_MOUSE_BUTTONS: CustomMouseButton[] = ['left', 'middle', 'right'];

const ACTIONS: CustomMouseAction[] = ['rotate', 'constrained', 'pan', 'zoom', 'roll', 'none'];

/**
 * Custom defaults: the onshape preset's per-button reading (2026-10-07),
 * so picking Custom changes nothing until a button is edited.
 */
export const DEFAULT_CUSTOM_MOUSE_MAP: CustomMouseMap = {
  left: 'none',
  middle: 'pan',
  right: 'rotate',
};

const CUSTOM_STORAGE_KEY = 'pb.customMouseControls';

/**
 * Parse + validate: unknown buttons/actions and malformed JSON fall back
 * to defaults. Also reads the first cut's 12-slot format (beta.72, one
 * `button.modifier` key per combo) by taking each button's plain slot —
 * that build was never tagged or released, so no released migration is
 * owed; this just keeps a same-day experimenter's plain-drag choices.
 */
export function normalizeCustomMouseMap(value: string | null): CustomMouseMap {
  const map: CustomMouseMap = { ...DEFAULT_CUSTOM_MOUSE_MAP };
  if (!value) return map;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return map;
    const record = parsed as Record<string, unknown>;
    for (const button of CUSTOM_MOUSE_BUTTONS) {
      const action = record[button];
      if ((ACTIONS as string[]).includes(action as CustomMouseAction)) {
        map[button] = action as CustomMouseAction;
      }
    }
  } catch {
    // Malformed JSON (never written by this app): keep defaults.
  }
  return map;
}

export function readCustomMouseControls(): CustomMouseMap {
  try {
    return normalizeCustomMouseMap(localStorage.getItem(CUSTOM_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_CUSTOM_MOUSE_MAP };
  }
}

const customListeners = new Set<(map: CustomMouseMap) => void>();

export function writeCustomMouseControls(map: CustomMouseMap): void {
  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage can be unavailable (private mode); the in-memory choice
    // still applies for this session.
  }
  customListeners.forEach((fn) => fn(map));
  broadcastPref('customMouseControls', JSON.stringify(map));
}

/** Live custom map: updates across windows when the preference broadcasts. */
export function useCustomMouseControls(): [CustomMouseMap, (map: CustomMouseMap) => void] {
  const [map, setMap] = useState<CustomMouseMap>(readCustomMouseControls);
  useEffect(() => {
    customListeners.add(setMap);
    const unlisten = listenPrefs((key, value) => {
      if (key === 'customMouseControls') setMap(normalizeCustomMouseMap(value));
    });
    return () => {
      customListeners.delete(setMap);
      unlisten();
    };
  }, []);
  return [map, writeCustomMouseControls];
}

/**
 * What a pressed mouse button does in the 3D view — the pure routing table
 * behind the schemes above (unit-tested; the canvas handlers stay thin).
 * `defaultConstrained` is Onshape's "set default rotation behavior to
 * constrained rotate" checkbox: in the Onshape scheme it swaps which of
 * plain/Alt drags is the turntable-only rotation; in the SOLIDWORKS scheme
 * it only re-tunes plain middle drag (Alt+middle stays Roll View). In the
 * custom scheme it is unused — `custom` carries the per-button map and
 * constrained rotation is a directly assignable action there.
 */
export type ViewMouseAction =
  | { kind: 'orbit'; constrained: boolean }
  | { kind: 'pan' }
  | { kind: 'dragZoom' }
  | { kind: 'roll' }
  | { kind: 'none' };

export function resolveMouseAction(
  scheme: MouseControlsScheme,
  button: number,
  mods: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  defaultConstrained: boolean,
  custom?: CustomMouseMap,
): ViewMouseAction {
  if (scheme === 'custom') {
    const name: CustomMouseButton | null = button === 0 ? 'left' : button === 1 ? 'middle' : button === 2 ? 'right' : null;
    if (!name) return { kind: 'none' };
    const action = (custom ?? DEFAULT_CUSTOM_MOUSE_MAP)[name];
    // Modifier combos are fixed rules, not per-slot choices (user request
    // 2026-10-07: a 12-slot matrix read as too complex). The rules distill
    // what both vendors' own tables agree on or pioneer:
    //   Ctrl + any drag  = pan    — the one binding Onshape and SOLIDWORKS
    //                             share verbatim, and the CAD-wide habit.
    //   Shift + any drag = zoom   — SOLIDWORKS' Shift+middle, generalized.
    //   Alt + drag       = swap free/constrained rotate on rotation
    //                             buttons only — Onshape's Alt+right
    //                             semantics; anything else keeps the plain
    //                             action (Onshape's Alt is rotate-only too).
    // Priority Shift > Ctrl > Alt matches the presets' reading order, and
    // the rules apply unconditionally — including buttons set to "do
    // nothing" — so the rule stays exception-free.
    if (mods.shiftKey) return { kind: 'dragZoom' };
    if (mods.ctrlKey) return { kind: 'pan' };
    if (mods.altKey && action === 'rotate') return { kind: 'orbit', constrained: true };
    if (mods.altKey && action === 'constrained') return { kind: 'orbit', constrained: false };
    switch (action) {
      case 'rotate': return { kind: 'orbit', constrained: false };
      case 'constrained': return { kind: 'orbit', constrained: true };
      case 'pan': return { kind: 'pan' };
      case 'zoom': return { kind: 'dragZoom' };
      case 'roll': return { kind: 'roll' };
      default: return { kind: 'none' };
    }
  }
  if (scheme === 'solidworks') {
    if (button !== 1) return { kind: 'none' };
    if (mods.shiftKey) return { kind: 'dragZoom' };
    if (mods.ctrlKey) return { kind: 'pan' };
    // SOLIDWORKS Roll View: Alt+middle spins the view in the screen plane
    // (the default-constrained checkbox does not touch this binding).
    if (mods.altKey) return { kind: 'roll' };
    return { kind: 'orbit', constrained: defaultConstrained };
  }
  // onshape: Alt swaps plain/constrained rotate.
  const constrained = mods.altKey ? !defaultConstrained : defaultConstrained;
  if (button === 2) {
    if (mods.ctrlKey) return { kind: 'pan' };
    return { kind: 'orbit', constrained };
  }
  if (button === 1) return { kind: 'pan' };
  return { kind: 'none' };
}

/**
 * Wheel direction each scheme ships with, combined with the user's
 * reverse-scroll checkbox: Onshape's factory default zooms IN on scroll
 * up (reverse flag off), SOLIDWORKS' zooms OUT — so the SOLIDWORKS scheme
 * flips the flag. The checkbox then reverses whichever default applies,
 * exactly like both vendors' own "reverse wheel zoom" options.
 */
export function effectiveReverseScroll(scheme: MouseControlsScheme, reversePref: boolean): boolean {
  return scheme === 'solidworks' ? !reversePref : reversePref;
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
