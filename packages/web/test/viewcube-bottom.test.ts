import { describe, expect, it, vi } from 'vitest';
import { createViewcubeAppearance, drawViewcubeFace, VIEWCUBE_APPEARANCE } from '../src/viewcube-appearance';

function recordingContext() {
  const paints: unknown[][] = [];
  const context = {
    fillStyle: '' as unknown,
    clearRect: (...args: number[]) => { paints.length = 0; paints.push(['clear', ...args]); },
    fillRect: (...args: number[]) => { paints.push(['rect', context.fillStyle, ...args]); },
    createLinearGradient: () => ({ addColorStop: () => {} }),
    beginPath: () => {},
    roundRect: (...args: number[]) => { paints.push(['panel', ...args]); },
    fill: () => { paints.push(['fill', context.fillStyle]); },
    arc: (...args: number[]) => { paints.push(['arc', ...args]); },
    fillText: (...args: unknown[]) => { paints.push(['label', ...args]); },
    save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {},
  };
  return { paints, context: context as unknown as CanvasRenderingContext2D };
}

const plainBottom = [
  ['clear', 0, 0, 512, 512],
  ['rect', '#f3f6f9', 0, 0, 512, 512],
];

describe('passive ViewCube underside', () => {
  it('paints one solid, unlabeled face without reading theme or hover colors', () => {
    const { context, paints } = recordingContext();
    const token = vi.fn(() => '#000000');
    for (const region of [null, { kind: 'face', u: 0, v: 0 }, { kind: 'edge', u: 1, v: 0 }, { kind: 'corner', u: -1, v: -1 }] as const) {
      drawViewcubeFace(context, 'Bottom', region, token, 3, Math.PI);
      expect(paints).toEqual(plainBottom);
    }
    expect(token).not.toHaveBeenCalled();
  });

  it('omits the bottom strip and lower corner pads on every adjoining side', () => {
    const { context, paints } = recordingContext();
    const s = VIEWCUBE_APPEARANCE.textureSize;
    for (const face of [0, 1, 4, 5]) {
      drawViewcubeFace(context, 'Side', null, (_name, fallback) => fallback, face);
      const panels = paints.filter(p => p[0] === 'panel');
      expect(panels).toHaveLength(4); // face panel, two vertical strips, top strip
      expect(panels.some(p => p[2] === s - VIEWCUBE_APPEARANCE.edgeHalfWidth)).toBe(false);
      const corners = paints.filter(p => p[0] === 'arc');
      expect(corners).toHaveLength(2);
      expect(corners.every(p => p[2] === 0)).toBe(true);
      expect(paints.filter(p => p[0] === 'label')).toHaveLength(1);
    }
  });

  it('clears an active hover on lower features and keeps the underside plain after theme/locale changes', () => {
    const contexts: ReturnType<typeof recordingContext>[] = [];
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const record = recordingContext();
      contexts.push(record);
      return record.context;
    });
    let theme = '#ffffff';
    const appearance = createViewcubeAppearance(['L', 'R', 'T', 'B', 'K', 'F'], () => theme);
    try {
      for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
        appearance.setHover([0, 1, 0]);
        expect(appearance.getHover()).toEqual([0, 1, 0]);
        appearance.setHover([x, -1, z]);
        expect(appearance.getHover()).toBeNull();
        expect(contexts[3]!.paints).toEqual(plainBottom);
      }
      theme = '#181617';
      appearance.retint();
      appearance.setLabels(['左', '右', '上', '下', '后', '前']);
      expect(contexts[3]!.paints).toEqual(plainBottom);
      expect(contexts[2]!.paints.some(p => p[0] === 'label' && p[1] === '上')).toBe(true);
    } finally {
      appearance.dispose();
      getContext.mockRestore();
    }
  });
});
