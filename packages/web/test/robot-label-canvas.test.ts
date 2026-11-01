import { describe, it, expect } from 'vitest';
import type { ActionGroup } from '@pathblender/core';
import { measureRobotLabel, drawRobotLabel } from '../src/robot-label-canvas';
import { ROBOT_LABEL_STYLE as S } from '../src/robot-label-style';

const colors = { background: '#fff', border: '#ddd', foreground: '#111', alliance: '#00f', path: '#f0f', dim: '#888' };

function context() {
  const text: { value: string; x: number; y: number; fill: unknown }[] = [];
  const state = { font: '', fillStyle: '' as unknown };
  const ctx = new Proxy(state as unknown as CanvasRenderingContext2D, {
    get(target, key) {
      if (key === 'measureText') return (value: string) => ({ width: [...value].length * 7 });
      if (key === 'fillText') return (value: string, x: number, y: number) => text.push({ value, x, y, fill: state.fillStyle });
      if (key in target) return target[key as keyof typeof target];
      return () => undefined;
    },
    set(target, key, value) { (target as Record<string, unknown>)[key as string] = value; return true; },
  });
  return { ctx, text, drawn: () => text.map((t) => t.value) };
}
const groups: ActionGroup[] = [
  { endsAt: 2, actions: [{ name: 'intake', t: 0 }, { name: 'align', t: 0 }] },
  { endsAt: 4, actions: [{ name: 'shoot', t: 1 }] },
];
const more = (n: number) => `+${n} more`;

describe('compact canvas robot cards', () => {
  it('keeps every grouped action and independent countdown, with a localized unit', () => {
    const { ctx, drawn } = context();
    const layout = measureRobotLabel(ctx, '0001', groups, 1, { secondsLabel: '秒' });
    drawRobotLabel(ctx, { x: 0, y: 0, ...layout }, layout, colors);
    expect(drawn()).toEqual(['0001', 'intake', 'align', '1.0', '秒', 'shoot', '3.0', '秒']);
    expect(layout.more).toBeNull();
  });
  it('uses less space for identity-only cards than action cards, and clamps time at zero', () => {
    const { ctx } = context();
    const idle = measureRobotLabel(ctx, '0001', [], 5);
    const active = measureRobotLabel(ctx, '0001', groups, 5);
    expect(idle.w).toBeLessThan(active.w);
    expect(idle.h).toBeLessThan(active.h);
    expect(active.actions.map(a => a.seconds)).toEqual(['0.0', '0.0']);
  });
  it('wraps long identities and action identifiers without dropping any characters', () => {
    const { ctx } = context();
    const identity = 'RobotLongDisplayName0123456789';
    const name = 'deploy_extension_with_a_long_identifier';
    const layout = measureRobotLabel(ctx, identity, [{ endsAt: 2, actions: [{ name, t: 0 }] }], 1);
    expect(layout.w).toBeLessThanOrEqual(168);
    expect(layout.identityLines.join('')).toBe(identity);
    expect(layout.actions[0]!.lines.join('')).toBe(name);
    expect(layout.actions[0]!.lines.length).toBeGreaterThan(1);
    expect(layout.h).toBeGreaterThan(60);
  });

  describe('folding', () => {
    const many: ActionGroup[] = [1, 2, 3, 4, 5, 6].map((i) => ({
      endsAt: i + 3, actions: [{ name: `act${i}`, t: 1 }, { name: `hold${i}`, t: 1 }],
    }));

    it('folds whole trailing groups behind a localized count once the card exceeds the cap', () => {
      const { ctx, drawn } = context();
      const full = measureRobotLabel(ctx, '0001', many, 2, { moreLabel: more });
      const folded = measureRobotLabel(ctx, '0001', many, 2, { moreLabel: more, maxHeight: 132 });
      expect(full.h).toBeGreaterThan(132);
      expect(folded.h).toBeLessThanOrEqual(132);
      // Soonest-ending groups stay; the count names every hidden action.
      const shown = folded.actions.length;
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThan(many.length);
      expect(folded.actions.map((r) => r.group.endsAt)).toEqual(many.slice(0, shown).map((g) => g.endsAt));
      expect(folded.more).not.toBeNull();
      expect(folded.more!.hidden).toBe((many.length - shown) * 2);
      expect(folded.more!.lines).toEqual([`+${(many.length - shown) * 2} more`]);
      // Folding never narrows the card (the leader keeps its docking edge).
      expect(folded.w).toBe(full.w);
      drawRobotLabel(ctx, { x: 0, y: 0, ...folded }, folded, colors);
      expect(drawn()).toContain(`+${(many.length - shown) * 2} more`);
      expect(drawn()).not.toContain('act6');
      expect(drawn()).toContain(`act${shown}`);
      // Every visible countdown still draws.
      expect(drawn().filter((v) => /^\d+\.\d$/.test(v))).toHaveLength(shown);
    });

    it('never folds when everything fits, and folds everything when even one row cannot fit', () => {
      const { ctx } = context();
      expect(measureRobotLabel(ctx, '0001', groups, 1, { maxHeight: 400, moreLabel: more }).more).toBeNull();
      const floor = measureRobotLabel(ctx, '0001', many, 2, { maxHeight: 10, moreLabel: more });
      expect(floor.actions).toHaveLength(0);
      expect(floor.more!.hidden).toBe(12);
      // Identity and the count always draw — the floor is honest, not blank.
      expect(floor.identityLines).toEqual(['0001']);
      expect(floor.h).toBe(S.paddingY + 1 + S.identityLine + S.sectionGap + S.actionLine + S.paddingY + 1);
    });

    it('wraps a long count label inside the locked width instead of spilling out', () => {
      const { ctx } = context();
      const folded = measureRobotLabel(ctx, '1', many, 2, {
        maxHeight: 60, moreLabel: (n) => `還有 ${n} 項動作沒有顯示在這裡`, maxWidth: 70,
      });
      expect(folded.w).toBeLessThanOrEqual(70);
      expect(folded.more!.lines.length).toBeGreaterThan(1);
      // Line breaks consume the whitespace they break on; every glyph survives.
      expect(folded.more!.lines.join('').replace(/\s/g, '')).toBe('還有12項動作沒有顯示在這裡');
    });
  });

  it('keeps an oversized unit inside the card by squeezing the names column, never the border', () => {
    const { ctx, text } = context();
    const unit = 'секунди';
    const layout = measureRobotLabel(ctx, '7', [{ endsAt: 3, actions: [{ name: 'intake', t: 0 }] }], 1, { secondsLabel: unit, maxWidth: 60 });
    drawRobotLabel(ctx, { x: 100, y: 0, ...layout }, layout, colors);
    const inset = S.paddingX + 1;
    for (const entry of text) expect(entry.x).toBeGreaterThanOrEqual(100 + inset);
    expect(layout.actions[0]!.lines.join('')).toBe('intake');
  });

  it('draws the border as one half-pixel-inset path so a 1 px stroke stays crisp', () => {
    const rects: number[][] = [];
    const ctx = new Proxy({ font: '' } as CanvasRenderingContext2D, {
      get(target, key) {
        if (key === 'measureText') return (value: string) => ({ width: [...value].length * 7 });
        if (key === 'roundRect') return (...args: number[]) => rects.push(args);
        if (key in target) return target[key as keyof typeof target];
        return () => undefined;
      },
      set() { return true; },
    });
    const layout = measureRobotLabel(ctx, '0001', [], 0);
    drawRobotLabel(ctx, { x: 20, y: 30, ...layout }, layout, colors);
    expect(rects).toEqual([[20.5, 30.5, layout.w - 1, layout.h - 1, S.radius - 0.5]]);
  });

  it('mirrors the card for a right-to-left UI, like the 3D DOM card under html[dir=rtl]', () => {
    const ctx = new Proxy({ font: '' } as CanvasRenderingContext2D, {
      get(target, key) {
        if (key === 'measureText') return (value: string) => ({ width: [...value].length * 7 });
        if (key in target) return target[key as keyof typeof target];
        return () => undefined;
      },
      set() { return true; },
    });
    const layout = measureRobotLabel(ctx, '0001', groups, 1, { secondsLabel: 'ש׳' });
    for (const rtl of [false, true]) {
      const arcs: number[][] = [];
      const texts: [string, number, number][] = [];
      const ctx2 = new Proxy({ font: '' } as CanvasRenderingContext2D, {
        get(target, key) {
          if (key === 'measureText') return (value: string) => ({ width: [...value].length * 7 });
          if (key === 'arc') return (...args: number[]) => arcs.push(args);
          if (key === 'fillText') return (text: string, x: number, y: number) => texts.push([text, x, y]);
          if (key in target) return target[key as keyof typeof target];
          return () => undefined;
        },
        set() { return true; },
      });
      const rect = { x: 100, y: 0, ...measureRobotLabel(ctx2, '0001', groups, 1, { secondsLabel: 'ש׳' }) };
      drawRobotLabel(ctx2, rect, layout, colors, { rtl });
      const inset = S.paddingX + 1;
      const [dotX] = arcs[0]!;
      const [, identityX] = texts.find(([t]) => t === '0001')!;
      const [, secondsX] = texts.find(([t]) => /^\d+\.\d$/.test(t))!;
      if (rtl) {
        expect(dotX).toBeCloseTo(rect.x + rect.w - inset - S.dotSize / 2);
        expect(identityX).toBeCloseTo(rect.x + rect.w - inset - S.dotSize - S.dotGap);
        expect(secondsX).toBeCloseTo(rect.x + inset); // the LTR time block parks on the left
      } else {
        expect(dotX).toBeCloseTo(rect.x + inset + S.dotSize / 2);
        expect(identityX).toBeCloseTo(rect.x + inset + S.dotSize + S.dotGap);
        expect(secondsX).toBeCloseTo(rect.x + rect.w - inset - layout.actions[0]!.timeWidth);
      }
    }
  });
});
