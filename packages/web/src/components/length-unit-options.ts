import { LENGTH_UNITS, type LengthUnit } from '../length-units';

/** UI contract for the next functionality pass. Do not persist preview-only
 * values through the existing four-value preference store. */
export type LengthUnitChoice = LengthUnit | 'ft' | 'yd';
export const LENGTH_UNIT_CHOICES = ['cm', 'ft', 'in', 'm', 'yd'] as const;
export const LENGTH_UNIT_PREVIEWS = { ft: '3.04 ft', yd: '1.01 yd' } as const;
export function isSupportedLengthUnit(value: LengthUnitChoice): value is LengthUnit {
  return (LENGTH_UNITS as readonly string[]).includes(value);
}
