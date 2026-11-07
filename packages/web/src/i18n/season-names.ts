/**
 * Built-in season names are product copy and localize here, at the display
 * layer; `FieldPackage.name` stays the official English name (data) and
 * custom field names are user data — never translated, in any language
 * (red book §7.2 v1.21 ⑤).
 */
import type { MessageKey } from './en';

/** Bundled field id → its dictionary key; anything absent is user/unknown data. */
export const SEASON_NAME_KEYS: Readonly<Record<string, MessageKey>> = {
  'rapidreact-2022': 'season.rapidreact2022',
  'chargedup-2023': 'season.chargedup2023',
  'crescendo-2024': 'season.crescendo2024',
  'reefscape-2025': 'season.reefscape2025',
  'rebuilt-2026': 'season.rebuilt2026',
};

/** Display label for a field: translated name + year, or the raw name verbatim. */
export function seasonLabel(
  t: (key: MessageKey) => string,
  field: { id: string; name: string; year: number },
): string {
  const key = SEASON_NAME_KEYS[field.id];
  return key === undefined ? field.name : `${t(key)} ${field.year}`;
}
