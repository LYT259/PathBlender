import { describe, expect, it } from 'vitest';
import { resolveMouseAction } from '../src/mouse-controls';

const none = { ctrlKey: false, shiftKey: false, altKey: false };
const alt = { ctrlKey: false, shiftKey: false, altKey: true };
const ctrl = { ctrlKey: true, shiftKey: false, altKey: false };
const shift = { ctrlKey: false, shiftKey: true, altKey: false };

describe('resolveMouseAction (verified Onshape/SolidWorks bindings)', () => {
  describe('onshape scheme', () => {
    it('right drag orbits; left does nothing', () => {
      expect(resolveMouseAction('onshape', 2, none, false)).toEqual({ kind: 'orbit', constrained: false });
      expect(resolveMouseAction('onshape', 0, none, false)).toEqual({ kind: 'none' });
    });

    it('middle drag pans, and Ctrl+right drag pans', () => {
      expect(resolveMouseAction('onshape', 1, none, false)).toEqual({ kind: 'pan' });
      expect(resolveMouseAction('onshape', 2, ctrl, false)).toEqual({ kind: 'pan' });
    });

    it('Alt+right drag is constrained rotate (turntable)', () => {
      expect(resolveMouseAction('onshape', 2, alt, false)).toEqual({ kind: 'orbit', constrained: true });
    });

    it('the default-constrained checkbox swaps plain and Alt drags', () => {
      expect(resolveMouseAction('onshape', 2, none, true)).toEqual({ kind: 'orbit', constrained: true });
      expect(resolveMouseAction('onshape', 2, alt, true)).toEqual({ kind: 'orbit', constrained: false });
    });
  });

  describe('solidworks scheme', () => {
    it('middle drag orbits; left/right do nothing', () => {
      expect(resolveMouseAction('solidworks', 1, none, false)).toEqual({ kind: 'orbit', constrained: false });
      expect(resolveMouseAction('solidworks', 0, none, false)).toEqual({ kind: 'none' });
      expect(resolveMouseAction('solidworks', 2, none, false)).toEqual({ kind: 'none' });
    });

    it('Ctrl+middle pans and Shift+middle drag-zooms', () => {
      expect(resolveMouseAction('solidworks', 1, ctrl, false)).toEqual({ kind: 'pan' });
      expect(resolveMouseAction('solidworks', 1, shift, false)).toEqual({ kind: 'dragZoom' });
    });

    it('Alt+middle drag is Roll View, never constrained rotate', () => {
      // SOLIDWORKS Roll View spins the view in the screen plane; the
      // default-constrained checkbox does not remap this binding.
      expect(resolveMouseAction('solidworks', 1, alt, false)).toEqual({ kind: 'roll' });
      expect(resolveMouseAction('solidworks', 1, alt, true)).toEqual({ kind: 'roll' });
    });

    it('the default-constrained checkbox only re-tunes plain middle drag', () => {
      expect(resolveMouseAction('solidworks', 1, none, false)).toEqual({ kind: 'orbit', constrained: false });
      expect(resolveMouseAction('solidworks', 1, none, true)).toEqual({ kind: 'orbit', constrained: true });
    });
  });
});
