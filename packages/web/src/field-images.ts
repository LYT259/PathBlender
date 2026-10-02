/**
 * Season field artwork registry (import side: Vite hashes the files into the
 * bundle). Entries are keyed by field id. Each 2022–2026 season ships two
 * artwork styles — the flat schematic (PathPlanner, default key `id`) and a
 * semi-realistic render (AdvantageScope, key `id/rendered`); 2025's render
 * pair additionally registers `id/rendered/andymark` for its AndyMark sheet.
 * 2018–2020 have a single artwork (the AS render), registered under `id`.
 * Resolution order: `id/rendered/andymark` → `id/rendered` → `id` → the
 * caller's custom-image URL (schematic is the base key, so a missing render
 * falls back to the field's only art).
 */
import { CUSTOM_FIELD_ID, type FieldArtStyle } from '@pathblender/core';
import field2018 from '../../../assets/fields/powerup2018.png';
import field2019 from '../../../assets/fields/deepspace2019.png';
import field2020 from '../../../assets/fields/infinitercharge2020.png';
import field2022 from '../../../assets/fields/rapidreact2022.png';
import field2022R from '../../../assets/fields/rapidreact2022-rendered.png';
import field2023 from '../../../assets/fields/chargedup2023.png';
import field2023R from '../../../assets/fields/chargedup2023-rendered.png';
import field2024 from '../../../assets/fields/crescendo2024.png';
import field2024R from '../../../assets/fields/crescendo2024-rendered.png';
import field2025Schematic from '../../../assets/fields/reefscape2025-schematic.png';
import field2025Welded from '../../../assets/fields/reefscape2025-welded.png';
import field2025AndyMark from '../../../assets/fields/reefscape2025-andymark.png';
import field2026 from '../../../assets/fields/rebuilt2026.png';
import field2026R from '../../../assets/fields/rebuilt2026-rendered.png';

export const FIELD_IMAGES: Record<string, string> = {
  'powerup-2018': field2018,
  'deepspace-2019': field2019,
  'infinitercharge-2020': field2020,
  'rapidreact-2022': field2022,
  'rapidreact-2022/rendered': field2022R,
  'chargedup-2023': field2023,
  'chargedup-2023/rendered': field2023R,
  'crescendo-2024': field2024,
  'crescendo-2024/rendered': field2024R,
  'reefscape-2025': field2025Schematic,
  'reefscape-2025/rendered': field2025Welded,
  'reefscape-2025/rendered/andymark': field2025AndyMark,
  'rebuilt-2026': field2026,
  'rebuilt-2026/rendered': field2026R,
};

/** Artwork URL for the current field + construction variant + style. */
export function fieldImageFor(
  fieldId: string,
  variant: 'welded' | 'andymark',
  style: FieldArtStyle,
  customImageUrl: string | undefined,
): string | undefined {
  if (fieldId === CUSTOM_FIELD_ID) return customImageUrl;
  if (style === 'rendered') {
    const rendered =
      FIELD_IMAGES[`${fieldId}/rendered/${variant}`] ?? FIELD_IMAGES[`${fieldId}/rendered`];
    if (rendered) return rendered;
  }
  return FIELD_IMAGES[fieldId];
}
