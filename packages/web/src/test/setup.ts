import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom lacks ResizeObserver; observe as a no-op (canvas size falls back
// to the wrap element's clientWidth/Height, which stays 0 in jsdom).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom has no canvas 2D implementation; return a permissive stub so
// FieldCanvas renders in tests without crashing.
if (typeof HTMLCanvasElement !== 'undefined') {
  const ctxStub = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'canvas') return {};
        // measureText must return metrics, not undefined — the team-number
        // rail sizing reads `.width` off it.
        if (prop === 'measureText') return () => ({ width: 0 });
        // Every method call (fillRect, setTransform, beginPath…) is a no-op.
        return () => undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  // Only 2D is stubbed. Advertising a fake WebGL context makes the idle 3D
  // prewarm fetch GLB files in jsdom, causing timing-dependent rejections.
  HTMLCanvasElement.prototype.getContext = ((kind: string) => kind === '2d' ? ctxStub : null) as unknown as HTMLCanvasElement['getContext'];
}

// jsdom in vitest may not provide storage; use a plain map when absent.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
}
