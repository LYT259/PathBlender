import type { ActionGroup } from '@pathblender/core';
import { ROBOT_LABEL_FONT, ROBOT_LABEL_STYLE as S } from './robot-label-style';
import type { LayoutRect } from './callout-layout';

const font = (size: number, weight = 400) => `${weight} ${size}px ${ROBOT_LABEL_FONT}`;

/** Wrap whole words when possible; long imported identifiers wrap without
 * losing characters. Measurement is supplied by the actual canvas font.
 * Boundary (documented, not hidden): breaks fall between code points, so a
 * combining mark or a ZWJ emoji sequence can split across lines when a
 * single run is wider than the card; nothing is ever dropped. */
function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const token of paragraph.split(/(\s+)/)) {
      if (measure(line + token) <= maxWidth) { line += token; continue; }
      if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
      for (const char of token.trimStart()) {
        if (line && measure(line + char) > maxWidth) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export interface RobotLabelMeasureOptions {
  secondsLabel?: string;
  maxWidth?: number;
  /** Fold trailing action rows behind a "+n" count once the card would be
   *  taller than this (same threshold as 3D: robot-label-layout.ts). */
  maxHeight?: number;
  /** Formats the folded action count — the localized `sequence.moreActions`. */
  moreLabel?: (n: number) => string;
}

export interface RobotLabelRow {
  group: ActionGroup;
  seconds: string;
  secondsWidth: number;
  unitWidth: number;
  timeWidth: number;
  nameWidth: number;
  lines: string[];
  top: number;
}

export interface RobotLabelLayout {
  w: number;
  h: number;
  identityLines: string[];
  /** Rows actually drawn — folding keeps the soonest-ending groups. */
  actions: RobotLabelRow[];
  /** The "+n" count row when trailing groups are folded; null when all fit. */
  more: { lines: string[]; top: number; hidden: number } | null;
  secondsLabel: string;
}

const defaultMore = (n: number) => `+${n}`;

/** The card's content layout is independent of robot pose and field zoom.
 *  Width comes from the full content so folding never narrows the card (the
 *  leader keeps docking to the same edge); only the trailing groups fold. */
export function measureRobotLabel(
  ctx: CanvasRenderingContext2D,
  identity: string,
  groups: readonly ActionGroup[],
  currentT: number,
  o: RobotLabelMeasureOptions = {},
): RobotLabelLayout {
  const secondsLabel = o.secondsLabel ?? 's';
  const maxWidth = o.maxWidth ?? S.maxWidth;
  const moreLabel = o.moreLabel ?? defaultMore;
  const inset = S.paddingX + 1;
  const measure = (text: string) => ctx.measureText(text).width;

  ctx.font = font(S.identitySize, 700);
  const headerWidth = measure(identity) + S.dotSize + S.dotGap;
  const rows = groups.map((group) => {
    const seconds = Math.max(0, group.endsAt - currentT).toFixed(1);
    ctx.font = font(S.timeSize, 600);
    const secondsWidth = measure(seconds);
    ctx.font = font(S.unitSize);
    const unitWidth = measure(secondsLabel);
    const timeWidth = secondsWidth + S.unitGap + unitWidth;
    ctx.font = font(S.actionSize);
    const nameWidth = Math.max(0, ...group.actions.map((a) => measure(a.name)));
    return { group, seconds, secondsWidth, unitWidth, timeWidth, nameWidth };
  });
  const w = Math.min(maxWidth, Math.max(headerWidth, ...rows.map((r) => r.nameWidth + S.columnGap + r.timeWidth)) + 2 * inset);
  ctx.font = font(S.identitySize, 700);
  const identityLines = wrapText(identity, Math.max(1, w - 2 * inset - S.dotSize - S.dotGap), measure);
  ctx.font = font(S.actionSize);
  const wrapped = rows.map((row) => ({
    ...row,
    lines: row.group.actions.flatMap((a) => wrapText(a.name, Math.max(1, w - 2 * inset - S.columnGap - row.timeWidth), measure)),
  }));

  // Lay out the first `visible` rows plus (optionally) the count row; the
  // fold search below calls this with shrinking `visible` until it fits.
  const layout = (visible: number, hidden: number) => {
    let y = S.paddingY + 1 + identityLines.length * S.identityLine;
    const shown = wrapped.slice(0, visible);
    if (shown.length || hidden > 0) y += S.sectionGap;
    const actions: RobotLabelRow[] = shown.map((row, index) => {
      if (index) y += S.rowGap;
      const top = y;
      y += Math.max(1, row.lines.length) * S.actionLine;
      return { ...row, top };
    });
    let more: RobotLabelLayout['more'] = null;
    if (hidden > 0) {
      if (actions.length) y += S.rowGap;
      const lines = wrapText(moreLabel(hidden), Math.max(1, w - 2 * inset), measure);
      more = { lines, top: y, hidden };
      y += Math.max(1, lines.length) * S.actionLine;
    }
    return { actions, more, h: y + S.paddingY + 1 };
  };

  let result = layout(wrapped.length, 0);
  if (o.maxHeight !== undefined && result.h > o.maxHeight && wrapped.length > 0) {
    // Whole trailing groups fold, soonest-ending stay; the count names every
    // action hidden (never a silent drop). All-folded is the floor: identity
    // and the count always draw, even when they alone exceed the cap.
    for (let visible = wrapped.length - 1; visible >= 0; visible--) {
      const hidden = wrapped.slice(visible).reduce((m, row) => m + row.group.actions.length, 0);
      result = layout(visible, hidden);
      if (result.h <= o.maxHeight) break;
    }
  }
  return { w, h: result.h, identityLines, actions: result.actions, more: result.more, secondsLabel };
}

export interface RobotLabelColors {
  background: string;
  border: string;
  foreground: string;
  alliance: string;
  path: string;
  /** Secondary ink for the folded count row; falls back to the foreground. */
  dim?: string;
}

export interface RobotLabelDrawOptions {
  /** Mirror the card for a right-to-left UI (html[dir=rtl]) exactly as the
   *  3D DOM card does: route dot and text start at the right, the LTR time
   *  block sits at the left. Direction is set explicitly so the live canvas
   *  (which inherits the document's direction) and a detached export canvas
   *  (which does not) paint the same bidi result. */
  rtl?: boolean;
}

export function drawRobotLabel(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  layout: RobotLabelLayout,
  colors: RobotLabelColors,
  options: RobotLabelDrawOptions = {},
) {
  const { x, y, w, h } = rect;
  const inset = S.paddingX + 1;
  const rtl = options.rtl === true;
  // One path, inset half a pixel: the 1 px stroke then covers one device row
  // (crisp, like the DOM card's border) and its outer edge lands exactly on
  // the rect the leader docks to; the fill underneath closes the ring.
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, Math.max(0, S.radius - 0.5));
  ctx.fillStyle = colors.background;
  ctx.fill();
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Reading-side edge for text and the dot; the opposite inset for the time.
  const textX = rtl ? x + w - inset : x + inset;
  const textAlign: CanvasTextAlign = rtl ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  const headerY = y + S.paddingY + 1;
  ctx.fillStyle = colors.path;
  ctx.beginPath();
  ctx.arc(rtl ? textX - S.dotSize / 2 : textX + S.dotSize / 2, headerY + layout.identityLines.length * S.identityLine / 2, S.dotSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = textAlign;
  ctx.fillStyle = colors.alliance;
  ctx.font = font(S.identitySize, 700);
  const identityX = rtl ? textX - S.dotSize - S.dotGap : textX + S.dotSize + S.dotGap;
  layout.identityLines.forEach((line, i) => ctx.fillText(line, identityX, headerY + (i + .5) * S.identityLine));
  ctx.fillStyle = colors.foreground;
  for (const row of layout.actions) {
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = textAlign;
    ctx.font = font(S.actionSize);
    row.lines.forEach((line, i) => ctx.fillText(line, textX, y + row.top + (i + .5) * S.actionLine));
    // The time block always reads left-to-right (digits then unit, like the
    // DOM's dir="ltr" span) on the side opposite the names, and never starts
    // outside the content box: an oversized unit squeezes the names instead.
    const timeX = rtl ? x + inset : Math.max(x + inset, x + w - inset - row.timeWidth);
    const timeY = y + row.top + S.actionLine / 2;
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.font = font(S.timeSize, 600);
    ctx.fillText(row.seconds, timeX, timeY);
    ctx.font = font(S.unitSize);
    ctx.fillText(layout.secondsLabel, timeX + row.secondsWidth + S.unitGap, timeY);
  }
  if (layout.more) {
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = textAlign;
    ctx.fillStyle = colors.dim ?? colors.foreground;
    ctx.font = font(S.actionSize);
    const top = layout.more.top;
    layout.more.lines.forEach((line, i) => ctx.fillText(line, textX, y + top + (i + .5) * S.actionLine));
  }
}
