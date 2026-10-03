/**
 * Length-unit preference (user request 2026-10-02): the checks panel and
 * other linear readouts format meters into the user's unit. Meters is the
 * default — the WPILib/Choreo/PathPlanner ecosystem speaks meters, and the
 * core model is meters, so the default display needs no conversion.
 * Formatting keeps 2 significant decimals (enough for robot-scale gaps).
 */

import { useEffect, useState } from 'react';
import { broadcastPref, listenPrefs } from './pref-sync';

export type LengthUnit = 'm' | 'cm' | 'in' | 'ftin';

const STORAGE_KEY = 'pb.lengthUnit';
export const LENGTH_UNITS: LengthUnit[] = ['m', 'cm', 'in', 'ftin'];

const IN_PER_M = 39.3700787;

function normalize(value: string | null): LengthUnit {
  return (LENGTH_UNITS as string[]).includes(value ?? '') ? (value as LengthUnit) : 'm';
}

export function readLengthUnit(): LengthUnit {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'm';
  }
}

const listeners = new Set<(unit: LengthUnit) => void>();

export function writeLengthUnit(unit: LengthUnit): void {
  try {
    localStorage.setItem(STORAGE_KEY, unit);
  } catch {
    // See mouse-controls.ts — session-only fallback.
  }
  // In-process subscribers first (the web settings dialog shares the
  // window with the canvas), then the cross-window desktop bridge.
  listeners.forEach((fn) => fn(unit));
  broadcastPref('lengthUnit', unit);
}

/** Live unit: updates across windows when the preference broadcasts. */
export function useLengthUnit(): [LengthUnit, (u: LengthUnit) => void] {
  const [unit, setUnit] = useState<LengthUnit>(readLengthUnit);
  useEffect(() => {
    listeners.add(setUnit);
    const unlisten = listenPrefs((key, value) => {
      if (key === 'lengthUnit') setUnit(normalize(value));
    });
    return () => {
      listeners.delete(setUnit);
      unlisten();
    };
  }, []);
  return [unit, writeLengthUnit];
}

/** Short unit suffix for the current scheme ('m', 'cm', 'in', 'ft/in'). */
export function lengthUnitSuffix(unit: LengthUnit): string {
  return unit === 'ftin' ? 'ft/in' : unit;
}

/**
 * Format a length in meters as a display string in `unit`, e.g.
 * 0.927 → '0.93 m' | '92.7 cm' | '36.5 in' | '3′0.5″'.
 * Negative values (penetration depths) format their magnitude with a
 * leading minus.
 */
export function formatLength(meters: number, unit: LengthUnit): string {
  const sign = meters < 0 ? '-' : '';
  const v = Math.abs(meters);
  switch (unit) {
    case 'm':
      return `${sign}${v.toFixed(2)} m`;
    case 'cm':
      return `${sign}${(v * 100).toFixed(1)} cm`;
    case 'in':
      return `${sign}${(v * IN_PER_M).toFixed(1)} in`;
    case 'ftin': {
      const totalIn = v * IN_PER_M;
      const ft = Math.floor(totalIn / 12);
      const inch = totalIn - ft * 12;
      // 0.93 m is 3′0.5″; under a foot the feet part drops (0′ looks odd).
      return ft > 0 ? `${sign}${ft}′${inch.toFixed(1)}″` : `${sign}${inch.toFixed(1)}″`;
    }
  }
}

/** Example line for the settings page, in the chosen unit. */
export function lengthUnitExample(unit: LengthUnit): string {
  return formatLength(0.927, unit);
}
