import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RobotLabels3D, leaderGeometry, type RobotLabel3D, type RobotLabels3DHandle,
} from '../src/components/RobotLabels3D';
import { rectsIntersect } from '../src/callout-layout';

const labels: RobotLabel3D[] = [{
  id: 'robot-a', identity: 'Demo A', alliance: 'blue', pathColor: '#a278b5',
  actions: [
    { endsAt: 4, actions: [{ name: 'intake', t: 0 }, { name: 'align', t: 1 }] },
    { endsAt: 6, actions: [{ name: 'shoot', t: 2 }] },
  ],
}];

const more = (n: number) => `+${n} more`;

afterEach(() => vi.restoreAllMocks());

function placeOf(card: HTMLElement) {
  const m = card.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!;
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** 184×100 cards, 30px rows, 20px count row — the class-aware jsdom stand-in. */
function mockMeasurements(cardH: number, rowH: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(184);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function fn(this: HTMLElement) {
    if (this.classList.contains('robot-label-3d-action')) return rowH;
    if (this.classList.contains('robot-label-3d-more')) return 20;
    return cardH;
  });
}

describe('fixed-size 3D robot information plates', () => {
  it('keeps simultaneous actions and their distinct countdowns visible', () => {
    const { container, rerender } = render(<RobotLabels3D labels={labels} currentT={2} secondsLabel="s" moreLabel={more} />);
    expect(screen.getByText('intake')).toBeInTheDocument();
    expect(screen.getByText('align')).toBeInTheDocument();
    expect(screen.getByText('shoot')).toBeInTheDocument();
    expect([...container.querySelectorAll('.robot-label-3d-time')].map((el) => el.textContent)).toEqual(['2.0s', '4.0s']);
    rerender(<RobotLabels3D labels={labels} currentT={3} secondsLabel="秒" moreLabel={more} />);
    expect([...container.querySelectorAll('.robot-label-3d-time')].map((el) => el.textContent)).toEqual(['1.0秒', '3.0秒']);
    expect(labels[0]!.actions[0]!.endsAt).toBe(4);
  });

  it('clamps a countdown whose end already passed, never showing negatives', () => {
    const { container } = render(<RobotLabels3D labels={labels} currentT={6.4} secondsLabel="s" moreLabel={more} />);
    expect([...container.querySelectorAll('.robot-label-3d-time')].map((el) => el.textContent)).toEqual(['0.0s', '0.0s']);
  });

  it('retains identity without fabricating an action when no event is active', () => {
    const { container } = render(<RobotLabels3D labels={[{ ...labels[0]!, actions: [] }]} currentT={0} secondsLabel="s" moreLabel={more} />);
    expect(screen.getByText('Demo A')).toBeInTheDocument();
    expect(container.querySelector('.robot-label-3d-actions')).toBeNull();
  });

  it('keeps full imported names as text and never evaluates them as markup', () => {
    const identity = '<img src=x onerror=alert(1)> very long robot display name';
    const { container } = render(<RobotLabels3D labels={[{ ...labels[0]!, identity }]} currentT={2} secondsLabel="s" moreLabel={more} />);
    expect(screen.getByText(identity)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('separates nearby plates inside the viewport and hides stale/offscreen anchors', () => {
    mockMeasurements(100, 30);
    const ref = createRef<RobotLabels3DHandle>();
    const { container } = render(<RobotLabels3D ref={ref}
      labels={[...labels, { ...labels[0]!, id: 'robot-b', identity: 'Demo B' }]}
      currentT={2} secondsLabel="s" moreLabel={more} />);
    act(() => ref.current!.place([
      { id: 'robot-a', x: 400, y: 300, visible: true },
      { id: 'robot-b', x: 400, y: 300, visible: true },
    ], { w: 800, h: 450 }));
    const cards = [...container.querySelectorAll<HTMLElement>('.robot-label-3d')];
    const positions = cards.map(placeOf);
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(12);
      expect(p.x + 184).toBeLessThanOrEqual(788);
      expect(p.y).toBeGreaterThanOrEqual(12);
      expect(p.y + 100).toBeLessThanOrEqual(438);
    }
    const [a, b] = positions;
    expect(Math.abs(a!.x - b!.x) >= 184 || Math.abs(a!.y - b!.y) >= 100).toBe(true);
    act(() => ref.current!.place([{ id: 'robot-a', x: 400, y: 300, visible: false }], { w: 800, h: 450 }));
    for (const card of cards) expect(card).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps a plate on its first side while the anchor wanders — orbiting never swaps sides', () => {
    mockMeasurements(100, 30);
    const ref = createRef<RobotLabels3DHandle>();
    render(<RobotLabels3D ref={ref} labels={labels} currentT={2} secondsLabel="s" moreLabel={more} />);
    const card = () => document.querySelector<HTMLElement>('[data-robot-id="robot-a"]')!;
    const placeAt = (x: number) => {
      act(() => ref.current!.place([{ id: 'robot-a', x, y: 300, visible: true }], { w: 800, h: 450 }));
      return placeOf(card());
    };
    // Left half at first sight: the plate sits left of the anchor.
    expect(placeAt(350).x).toBe(136);
    // Across the midline — even well past it — the remembered side wins.
    expect(placeAt(430).x).toBe(216);
    expect(placeAt(560).x).toBe(346);
    // First sight on the right half takes the right side (clamped to the
    // canvas edge here), and keeps it too.
    const fresh = createRef<RobotLabels3DHandle>();
    const { unmount } = render(<RobotLabels3D ref={fresh} labels={[{ ...labels[0]!, id: 'robot-c' }]}
      currentT={2} secondsLabel="s" moreLabel={more} />);
    act(() => fresh.current!.place([{ id: 'robot-c', x: 600, y: 300, visible: true }], { w: 800, h: 450 }));
    const c = () => document.querySelector<HTMLElement>('[data-robot-id="robot-c"]')!;
    expect(placeOf(c()).x).toBe(604);
    act(() => fresh.current!.place([{ id: 'robot-c', x: 250, y: 300, visible: true }], { w: 800, h: 450 }));
    expect(placeOf(c()).x).toBe(250 + 30);
    unmount();
  });

  it('tracks the same plate-to-anchor offset while another plate contests the ideal spot', () => {
    mockMeasurements(100, 30);
    const ref = createRef<RobotLabels3DHandle>();
    render(<RobotLabels3D ref={ref}
      labels={[...labels, { ...labels[0]!, id: 'robot-b', identity: 'Demo B' }]}
      currentT={2} secondsLabel="s" moreLabel={more} />);
    const run = (ax: number, bx: number) => {
      act(() => ref.current!.place([
        { id: 'robot-a', x: ax, y: 300, visible: true },
        { id: 'robot-b', x: bx, y: 320, visible: true },
      ], { w: 800, h: 450 }));
      const a = placeOf(document.querySelector<HTMLElement>('[data-robot-id="robot-a"]')!);
      const b = placeOf(document.querySelector<HTMLElement>('[data-robot-id="robot-b"]')!);
      return { a, b, ax, bx, aOff: { dx: a.x - ax, dy: a.y - 300 }, bOff: { dx: b.x - bx, dy: b.y - 320 } };
    };
    const first = run(400, 430);
    const second = run(406, 436);
    // Neither plate flips sides nor jumps to a different relative slot.
    expect(second.aOff).toEqual(first.aOff);
    expect(second.bOff).toEqual(first.bOff);
    // And the crowded frame stays honest: no plate covers a robot body or
    // another plate, and the second plate keeps off the first one's leader.
    for (const runFrame of [first, second]) {
      const rects = [{ x: runFrame.a.x, y: runFrame.a.y, w: 184, h: 100 }, { x: runFrame.b.x, y: runFrame.b.y, w: 184, h: 100 }];
      for (const anchor of [{ x: runFrame.ax, y: 300 }, { x: runFrame.bx, y: 320 }]) {
        const body = { x: anchor.x - 22, y: anchor.y - 22, w: 44, h: 44 };
        for (const plate of rects) expect(rectsIntersect(plate, body)).toBe(false);
      }
      expect(rectsIntersect(rects[0]!, rects[1]!)).toBe(false);
      const leader = leaderGeometry({ x: runFrame.ax, y: 300 }, rects[0]!);
      for (const segment of leader.segments) expect(rectsIntersect(rects[1]!, segment)).toBe(false);
    }
  });

  it('folds whole trailing rows behind a visible count instead of running past the canvas', () => {
    mockMeasurements(400, 30);
    const ref = createRef<RobotLabels3DHandle>();
    const many: RobotLabel3D[] = [{
      ...labels[0]!,
      actions: [1, 2, 3].map((i) => ({ endsAt: i + 3, actions: [{ name: `act${i}`, t: 1 }, { name: `hold${i}`, t: 1 }] })),
    }];
    const { container } = render(<RobotLabels3D ref={ref} labels={many} currentT={2} secondsLabel="s" moreLabel={more} />);
    const rows = () => [...container.querySelectorAll<HTMLElement>('.robot-label-3d-action')];
    const moreRow = () => container.querySelector<HTMLElement>('.robot-label-3d-more')!;
    expect(moreRow().hidden).toBe(true);

    // 400px card in a 300px viewport: everything folds behind "+6 more".
    act(() => ref.current!.place([{ id: 'robot-a', x: 400, y: 150, visible: true }], { w: 800, h: 300 }));
    for (const row of rows()) expect(row.hidden).toBe(true);
    expect(moreRow().hidden).toBe(false);
    expect(moreRow().textContent).toBe('+6 more');

    // Room returns: the rows come back and the count row steps aside.
    act(() => ref.current!.place([{ id: 'robot-a', x: 400, y: 450, visible: true }], { w: 800, h: 900 }));
    for (const row of rows()) expect(row.hidden).toBe(false);
    expect(moreRow().hidden).toBe(true);

    // A canvas squeezed below the folding floor folds to the canvas itself,
    // never past it (narrow windows wrap the toolbar and eat the canvas).
    act(() => ref.current!.place([{ id: 'robot-a', x: 400, y: 70, visible: true }], { w: 800, h: 140 }));
    for (const row of rows()) expect(row.hidden).toBe(true);
    expect(moreRow().hidden).toBe(false);
  });

  it('rounds natural width upward so locking a fractional width cannot wrap its last glyph', () => {
    mockMeasurements(80, 16);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 91.4 } as DOMRect);
    const ref = createRef<RobotLabels3DHandle>();
    const { container } = render(<RobotLabels3D ref={ref} labels={labels} currentT={2} secondsLabel="s" moreLabel={more} />);
    act(() => ref.current!.place([{ id: 'robot-a', x: 400, y: 300, visible: true }], { w: 800, h: 450 }));
    expect(container.querySelector<HTMLElement>('.robot-label-3d')!.style.width).toBe('92px');
  });

  it('routes leaders: vertical docking under the plate, elbow to a side edge', () => {
    // Straight below: docks into the bottom edge.
    const docked = leaderGeometry({ x: 150, y: 200 }, { x: 60, y: 60, w: 184, h: 100 });
    expect(docked.d).toBe('M 150 200 L 150 160');
    // Off to the side: leaves the nearest vertical edge via a 12px elbow.
    const elbowed = leaderGeometry({ x: 20, y: 200 }, { x: 60, y: 60, w: 184, h: 100 });
    expect(elbowed.d).toBe('M 20 200 L 48 148 L 60 148');
    expect(elbowed.segments).toHaveLength(2);
  });
});
