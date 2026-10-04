/**
 * Length-unit preference (user request 2026-10-02, ft/yd made real
 * 2026-10-04): the checks panel and other linear readouts format meters
 * into the user's unit. Inches is the default (user directive 2026-10-04:
 * the official FRC game manual states its rule values in inches) — the
 * core model is still meters, and the WPILib/Choreo/PathPlanner files we
 * read are meters, so only the display converts (1 in = 0.0254 m is
 * exact); internal coordinates stay in meters regardless of the unit.
 *
 * Picker order is fixed: cm, ft, in, m, yd (millimeters deliberately not
 * offered). Conversions are exact: 1 in = 0.0254 m, 1 ft = 0.3048 m,
 * 1 yd = 0.9144 m.
 *
 * 'ftin' (feet+inches mixed, e.g. 3′0.5″) is a LEGACY stored value from
 * before the five-unit picker: it is still honored on read and formats
 * exactly as it used to — never re-interpreted as decimal feet — but it
 * is not in the picker; saving any current unit replaces it.
 */

import { useEffect, useState } from 'react';
import { broadcastPref, listenPrefs } from './pref-sync';

export type LengthUnit = 'cm' | 'ft' | 'in' | 'm' | 'yd' | 'ftin';

const STORAGE_KEY = 'pb.lengthUnit';
/** Picker choices, in display order. */
export const LENGTH_UNITS: LengthUnit[] = ['cm', 'ft', 'in', 'm', 'yd'];

/** Exact conversion factors (meters per unit are the definitions). */
const IN_PER_M = 1 / 0.0254;
const FT_PER_M = 1 / 0.3048;
const YD_PER_M = 1 / 0.9144;

function normalize(value: string | null): LengthUnit {
  return ([...LENGTH_UNITS, 'ftin'] as string[]).includes(value ?? '') ? (value as LengthUnit) : 'in';
}

export function readLengthUnit(): LengthUnit {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'in';
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

/** Short unit suffix for the current scheme ('m', 'cm', 'in', 'ft', 'yd', 'ft/in'). */
export function lengthUnitSuffix(unit: LengthUnit): string {
  return unit === 'ftin' ? 'ft/in' : unit;
}

/**
 * The numeric part of formatLength without the unit suffix, for compact
 * pair readouts like '35.4×35.4 in' (the unit is appended once by the
 * caller). Same conversions and precision as formatLength.
 */
export function formatLengthNumber(meters: number, unit: LengthUnit): string {
  const v = Math.abs(meters);
  switch (unit) {
    case 'm':
      return v.toFixed(2);
    case 'cm':
      return (v * 100).toFixed(1);
    case 'in':
      return (v * IN_PER_M).toFixed(1);
    case 'ft':
      return (v * FT_PER_M).toFixed(2);
    case 'yd':
      return (v * YD_PER_M).toFixed(2);
    case 'ftin': {
      const totalIn = v * IN_PER_M;
      const ft = Math.floor(totalIn / 12);
      const inch = totalIn - ft * 12;
      return ft > 0 ? `${ft}′${inch.toFixed(1)}″` : `${inch.toFixed(1)}″`;
    }
  }
}

/**
 * Format a length in meters as a display string in `unit`, e.g.
 * 0.927 → '0.93 m' | '92.7 cm' | '36.5 in' | '3.04 ft' | '1.01 yd' | '3′0.5″'.
 * Negative values (penetration depths) format their magnitude with a
 * leading minus.
 */
export function formatLength(meters: number, unit: LengthUnit): string {
  const sign = meters < 0 ? '-' : '';
  switch (unit) {
    case 'ftin':
      return `${sign}${formatLengthNumber(meters, unit)}`;
    default:
      return `${sign}${formatLengthNumber(meters, unit)} ${unit}`;
  }
}

/** Example line for the settings page, in the chosen unit. */
export function lengthUnitExample(unit: LengthUnit): string {
  return formatLength(0.927, unit);
}
