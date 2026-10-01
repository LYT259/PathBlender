/**
 * Season field artwork registry (import side: Vite hashes the files into the
 * bundle). Entries are keyed by field id; seasons that ship separate art per
 * construction variant (2025: AdvantageScopeAssets welded/AndyMark pair)
 * additionally register `id/variant` keys. Resolution order:
 * `id/variant` → `id` → the caller's custom-image URL.
 */
import { CUSTOM_FIELD_ID } from '@pathblender/core';
import field2018 from '../../../assets/fields/powerup2018.png';
import field2019 from '../../../assets/fields/deepspace2019.png';
import field2020 from '../../../assets/fields/infinitercharge2020.png';
import field2022 from '../../../assets/fields/rapidreact2022.png';
import field2023 from '../../../assets/fields/chargedup2023.png';
import field2024 from '../../../assets/fields/crescendo2024.png';
import field2025Welded from '../../../assets/fields/reefscape2025-welded.png';
import field2025AndyMark from '../../../assets/fields/reefscape2025-andymark.png';
import field2026 from '../../../assets/fields/rebuilt2026.png';

export const FIELD_IMAGES: Record<string, string> = {
  'powerup-2018': field2018,
  'deepspace-2019': field2019,
  'infinitercharge-2020': field2020,
  'rapidreact-2022': field2022,
  'chargedup-2023': field2023,
  'crescendo-2024': field2024,
  'reefscape-2025': field2025Welded,
  'reefscape-2025/welded': field2025Welded,
  'reefscape-2025/andymark': field2025AndyMark,
  'rebuilt-2026': field2026,
};

/** Artwork URL for the current field + construction variant. */
export function fieldImageFor(
  fieldId: string,
  variant: 'welded' | 'andymark',
  customImageUrl: string | undefined,
): string | undefined {
  if (fieldId === CUSTOM_FIELD_ID) return customImageUrl;
  return FIELD_IMAGES[`${fieldId}/${variant}`] ?? FIELD_IMAGES[fieldId];
}
