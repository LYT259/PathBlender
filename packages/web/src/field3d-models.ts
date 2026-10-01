/**
 * Official 3D field model registry — deliberately THREE-free so the app
 * shell (which never imports three directly; the 3D canvas is a lazy
 * chunk) can ask "does this season have an official model?" without
 * dragging the 3D library into the main bundle.
 */

export type FieldModelMirror = 'x' | 'z';

/**
 * Official 3D field models (AdvantageScopeAssets, BSD-3) per season and
 * construction variant; 2018–2020 have none — those seasons (and custom
 * fields) offer no 3D view at all (user directive 2026-10-01: no
 * hand-built stand-ins). `mirror` is `configMirrorAxis` of the config.json
 * shipped in each model directory (asserted by test — it cannot drift from
 * the asset); `tagDecal` is the node-name pattern that identifies the
 * model's own tag meshes for the registration test (2022/2023 ship none).
 */
export interface Field3DModelEntry {
  welded: string;
  andymark?: string;
  mirror: FieldModelMirror;
  tagDecal?: RegExp;
}

export const FIELD3D_MODELS: Record<string, Field3DModelEntry> = {
  'rapidreact-2022': { welded: '2022-rapidreact', mirror: 'x' },
  'chargedup-2023': { welded: '2023-chargedup', mirror: 'z' },
  'crescendo-2024': {
    welded: '2024-crescendo',
    mirror: 'z',
    tagDecal: /FE-00083_ID(\d+)/,
  },

  'reefscape-2025': {
    welded: '2025-reefscape-welded',
    andymark: '2025-reefscape-andymark',
    mirror: 'x',
    tagDecal: /FE-00083_ID(\d+)/,
  },
  'rebuilt-2026': {
    welded: '2026-rebuilt',
    mirror: 'z',
    tagDecal: /FE-00083-ID(\d+)-Vinyl/,
  },
};
