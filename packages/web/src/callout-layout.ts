/**
 * Label collision layout for the field views (user report 2026-10-14:
 * robots bunched at a game piece pile drew their labels on top of each
 * other — later-drawn plates simply covered earlier ones, leaving names
 * unreadable).
 *
 * Every robot's single information card (identity, current actions and
 * their countdowns — 2026-10-19, one card and one leader per robot in both
 * 2D and 3D) is placed through placeLabel(): the preferred diagonal first,
 * then the mirrored diagonal, then a vertical slide past whatever is in the
 * way, then a sideways slide along the row. Robots are drawn in list order,
 * so each card treats everything already placed this frame as immovable —
 * deterministic by construction, and the leader line running from each
 * robot's anchor dot keeps ownership readable however far a card had to
 * move. Cross-frame memory and the shared 2D/3D rules live in
 * robot-label-layout.ts.
 */

/** Screen-space rectangle, CSS pixels. */
export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelPlacement {
  /** Top-left of the placed rect, clamped into the canvas. */
  x: number;
  y: number;
  /** Horizontal side actually used: 1 = right of the anchor, -1 = left. */
  side: 1 | -1;
}

export interface PlaceLabelOptions {
  /** The robot's anchor point in screen space. */
  anchor: { x: number; y: number };
  /** Diagonal anchor→label distance; the side picks the direction. */
  offset: number;
  /** Label extent — the card's measured width and height. */
  size: { w: number; h: number };
  /** Side the label would take with nothing in the way. */
  prefer: 1 | -1;
  /** Desired top y, unclamped — where the diagonal puts the label. */
  y0: number;
  canvas: { w: number; h: number };
  /** Canvas-edge breathing room. */
  margin: number;
  /** Gap kept when sliding past an obstacle. */
  gap: number;
  /** Labels already placed this frame; placed labels never cover these. */
  obstacles: LayoutRect[];
  /** Exhaust every candidate on the preferred side (slides included) before
   *  trying the other side. For a label the viewer has already seen on one
   *  side, a vertical slide reads as "the same card moved"; a side swap
   *  reads as a different card (3D browser finding 2026-10-17). */
  stickySide?: boolean;
}

export function rectsIntersect(a: LayoutRect, b: LayoutRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function overlapArea(a: LayoutRect, b: LayoutRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const flip = (side: 1 | -1): 1 | -1 => (side === 1 ? -1 : 1);

/**
 * Place one label near its anchor, preferring the requested diagonal.
 * Candidate order: the preferred diagonal, the mirrored diagonal, then
 * slides above/below every obstacle (closest to the desired y first, ties
 * lower-first) on either side — or, with `stickySide`, every preferred-side
 * candidate before any mirrored one — then sideways slides past each
 * obstacle at the desired height. The first candidate clear of every
 * obstacle wins; when the screen is too crowded for any, the candidate
 * with the smallest total overlap is returned so extreme frames stay as
 * readable as geometry allows.
 */
export function placeLabel(o: PlaceLabelOptions): LabelPlacement {
  const { anchor, offset, size, prefer, y0, canvas, margin, gap, obstacles } = o;
  const xFor = (side: 1 | -1) =>
    clamp(
      anchor.x + side * offset - (side < 0 ? size.w : 0),
      margin,
      Math.max(margin, canvas.w - margin - size.w),
    );
  const yTop = margin;
  const yBottom = Math.max(margin, canvas.h - margin - size.h);
  const clampY = (y: number) => clamp(y, yTop, yBottom);
  const desiredY = clampY(y0);

  // Slide candidates: snug against each obstacle's bottom/top edge.
  const ys = new Set<number>([desiredY]);
  for (const r of obstacles) {
    ys.add(clampY(r.y + r.h + gap));
    ys.add(clampY(r.y - gap - size.h));
  }
  const ordered = [...ys].sort(
    (a, b) => Math.abs(a - desiredY) - Math.abs(b - desiredY) || a - b,
  );

  const candidates: LabelPlacement[] = [];
  if (o.stickySide) {
    for (const side of [prefer, flip(prefer)]) {
      for (const y of ordered) candidates.push({ x: xFor(side), y, side });
    }
  } else {
    candidates.push(
      { x: xFor(prefer), y: desiredY, side: prefer },
      { x: xFor(flip(prefer)), y: desiredY, side: flip(prefer) },
    );
    for (const y of ordered) {
      if (y === desiredY) continue;
      for (const side of [prefer, flip(prefer)]) {
        candidates.push({ x: xFor(side), y, side });
      }
    }
  }
  // Last resort before overlapping: slide sideways past each obstacle at the
  // desired height, nearest the preferred diagonal first. A canvas too short
  // for any vertical slide (a squeezed window) still has room along the row.
  const clampX = (x: number) => clamp(x, margin, Math.max(margin, canvas.w - margin - size.w));
  const xs = new Set<number>();
  for (const r of obstacles) {
    xs.add(clampX(r.x + r.w + gap));
    xs.add(clampX(r.x - gap - size.w));
  }
  const xPreferred = xFor(prefer);
  for (const x of [...xs].sort((a, b) => Math.abs(a - xPreferred) - Math.abs(b - xPreferred) || a - b)) {
    candidates.push({ x, y: desiredY, side: x + size.w / 2 < anchor.x ? -1 : 1 });
  }
  for (const c of candidates) {
    const rect = { x: c.x, y: c.y, w: size.w, h: size.h };
    if (!obstacles.some((r) => rectsIntersect(rect, r))) return c;
  }
  // Every candidate overlaps something (more labels than free screen):
  // minimize covered area, ties by distance from the desired spot, then
  // the preferred side — never left undefined, never outside the canvas.
  const scored = candidates.map((c) => {
    const rect = { x: c.x, y: c.y, w: size.w, h: size.h };
    return { c, area: obstacles.reduce((m, r) => m + overlapArea(rect, r), 0) };
  });
  scored.sort((a, b) => {
    if (Math.abs(a.area - b.area) > 1e-9) return a.area - b.area;
    const da = Math.abs(a.c.y - desiredY);
    const db = Math.abs(b.c.y - desiredY);
    if (Math.abs(da - db) > 1e-9) return da - db;
    if (a.c.side === prefer && b.c.side !== prefer) return -1;
    if (b.c.side === prefer && a.c.side !== prefer) return 1;
    return 0;
  });
  return scored[0]!.c;
}
