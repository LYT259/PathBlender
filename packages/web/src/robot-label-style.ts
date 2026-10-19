/** Compact 2D/3D label proposal. Values are CSS px, never field meters.
 * Keep both renderers on this scale; palette tokens remain theme-owned. */
export const ROBOT_LABEL_STYLE = {
  maxWidth: 168,
  paddingX: 7,
  paddingY: 5,
  radius: 7,
  identitySize: 13,
  identityLine: 18,
  actionSize: 12,
  actionLine: 16,
  timeSize: 13,
  unitSize: 10,
  unitGap: 2,
  sectionGap: 3,
  rowGap: 3,
  columnGap: 8,
  dotSize: 6,
  dotGap: 6,
  leaderWidth: 1.5,
  leaderUnderlay: 4.5,
  anchorRadius: 3,
} as const;

export const ROBOT_LABEL_FONT = 'ui-sans-serif, system-ui, sans-serif';
export const robotLabelCssVars = Object.fromEntries(
  Object.entries(ROBOT_LABEL_STYLE).map(([key, value]) => [`--label-${key}`, `${value}px`]),
);
