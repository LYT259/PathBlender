import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatLength,
  formatLengthNumber,
  LENGTH_UNITS,
  lengthUnitSuffix,
  readLengthUnit,
  useLengthUnit,
  writeLengthUnit,
} from '../src/length-units';
import {
  defaultConstrainedPref,
  effectiveReverseScroll,
  penAsMousePref,
  readMouseControls,
  resolveMouseAction,
  reverseScrollPref,
  useMouseControls,
  writeMouseControls,
} from '../src/mouse-controls';

beforeEach(() => localStorage.clear());

describe('formatLength', () => {
  it('formats meters by default with 2 decimals', () => {
    expect(formatLength(0.927, 'm')).toBe('0.93 m');
    expect(formatLength(0, 'm')).toBe('0.00 m');
  });

  it('converts to centimeters and inches', () => {
    expect(formatLength(0.927, 'cm')).toBe('92.7 cm');
    expect(formatLength(0.927, 'in')).toBe('36.5 in');
  });

  it('converts to decimal feet and yards with the exact factors', () => {
    // Exact definitions: 1 ft = 0.3048 m, 1 yd = 0.9144 m.
    expect(formatLength(0.927, 'ft')).toBe('3.04 ft');
    expect(formatLength(0.927, 'yd')).toBe('1.01 yd');
    expect(formatLength(0.3048, 'ft')).toBe('1.00 ft');
    expect(formatLength(0.9144, 'yd')).toBe('1.00 yd');
    expect(formatLength(0.0254, 'in')).toBe('1.0 in');
  });

  it('keeps the legacy feet+inches format, dropping a leading zero foot', () => {
    // 0.927 m = 36.5 in = 3 ft 0.5 in.
    expect(formatLength(0.927, 'ftin')).toBe('3′0.5″');
    expect(formatLength(0.2, 'ftin')).toBe('7.9″');
  });

  it('keeps the sign for penetration depths', () => {
    expect(formatLength(-0.12, 'm')).toBe('-0.12 m');
    expect(formatLength(-0.12, 'in')).toBe('-4.7 in');
    expect(formatLength(-0.12, 'ft')).toBe('-0.39 ft');
  });

  it('formatLengthNumber gives the bare value for compact pair readouts', () => {
    expect(formatLengthNumber(0.927, 'in')).toBe('36.5');
    expect(formatLengthNumber(0.927, 'm')).toBe('0.93');
    expect(formatLengthNumber(0.927, 'cm')).toBe('92.7');
    expect(formatLengthNumber(0.927, 'ftin')).toBe('3′0.5″');
  });

  it('exposes a short suffix per unit', () => {
    expect(lengthUnitSuffix('ftin')).toBe('ft/in');
    expect(lengthUnitSuffix('cm')).toBe('cm');
    expect(lengthUnitSuffix('ft')).toBe('ft');
    expect(lengthUnitSuffix('yd')).toBe('yd');
  });

  it('offers exactly cm, ft, in, m, yd in that order (no millimeters)', () => {
    expect(LENGTH_UNITS).toEqual(['cm', 'ft', 'in', 'm', 'yd']);
  });
});

describe('length unit preference', () => {
  it('defaults to inches and persists writes', () => {
    expect(readLengthUnit()).toBe('in');
    writeLengthUnit('m');
    expect(readLengthUnit()).toBe('m');
  });

  it('falls back to inches for unknown stored values', () => {
    localStorage.setItem('pb.lengthUnit', 'furlongs');
    expect(readLengthUnit()).toBe('in');
  });

  it('honors the legacy ftin stored value as feet+inches, never decimal feet', () => {
    // Saved by a build before the five-unit picker: the mixed feet+inches
    // display must survive, not collapse into decimal 'ft'.
    localStorage.setItem('pb.lengthUnit', 'ftin');
    expect(readLengthUnit()).toBe('ftin');
    expect(readLengthUnit()).not.toBe('ft');
  });

  it('persists the newly real units (ft, yd)', () => {
    writeLengthUnit('ft');
    expect(readLengthUnit()).toBe('ft');
    writeLengthUnit('yd');
    expect(readLengthUnit()).toBe('yd');
  });

  it('updates hooks in-process (web settings dialog shares the window)', () => {
    const a = renderHook(() => useLengthUnit());
    const b = renderHook(() => useLengthUnit());
    act(() => a.result.current[1]('cm'));
    expect(b.result.current[0]).toBe('cm');
  });
});

describe('mouse controls preference', () => {
  it('defaults to onshape and persists solidworks', () => {
    expect(readMouseControls()).toBe('onshape');
    writeMouseControls('solidworks');
    expect(readMouseControls()).toBe('solidworks');
  });

  it('falls back to onshape for unknown stored values', () => {
    localStorage.setItem('pb.mouseControls', 'catia');
    expect(readMouseControls()).toBe('onshape');
  });

  it('updates hooks in-process', () => {
    const a = renderHook(() => useMouseControls());
    const b = renderHook(() => useMouseControls());
    act(() => a.result.current[1]('solidworks'));
    expect(b.result.current[0]).toBe('solidworks');
  });
});

describe('view checkbox preferences', () => {
  it('defaults: reverse scroll off, constrained off, pen-as-mouse on', () => {
    expect(reverseScrollPref.read()).toBe(false);
    expect(defaultConstrainedPref.read()).toBe(false);
    expect(penAsMousePref.read()).toBe(true);
  });

  it('persists on/off and restores them', () => {
    reverseScrollPref.write(true);
    penAsMousePref.write(false);
    expect(localStorage.getItem('pb.reverseScroll')).toBe('on');
    expect(localStorage.getItem('pb.penAsMouse')).toBe('off');
    expect(reverseScrollPref.read()).toBe(true);
    expect(penAsMousePref.read()).toBe(false);
  });

  it('updates hooks in-process (settings dialog shares the window)', () => {
    const a = renderHook(() => reverseScrollPref.use());
    const b = renderHook(() => reverseScrollPref.use());
    act(() => a.result.current[1](true));
    expect(b.result.current[0]).toBe(true);
  });
});

describe('effectiveReverseScroll (per-scheme factory wheel direction)', () => {
  it('onshape defaults to scroll-up zooms in; the checkbox reverses it', () => {
    expect(effectiveReverseScroll('onshape', false)).toBe(false);
    expect(effectiveReverseScroll('onshape', true)).toBe(true);
  });

  it('solidworks defaults to scroll-up zooms out; the checkbox reverses it', () => {
    // SOLIDWORKS factory direction is the opposite of Onshape's, so the
    // same checkbox state flips the effective flag.
    expect(effectiveReverseScroll('solidworks', false)).toBe(true);
    expect(effectiveReverseScroll('solidworks', true)).toBe(false);
  });
});

describe('resolveMouseAction routing table', () => {
  it('onshape: right orbits, middle pans, left idle', () => {
    expect(resolveMouseAction('onshape', 2, { ctrlKey: false, shiftKey: false, altKey: false }, false))
      .toEqual({ kind: 'orbit', constrained: false });
    expect(resolveMouseAction('onshape', 1, { ctrlKey: false, shiftKey: false, altKey: false }, false))
      .toEqual({ kind: 'pan' });
    expect(resolveMouseAction('onshape', 0, { ctrlKey: false, shiftKey: false, altKey: false }, false))
      .toEqual({ kind: 'none' });
  });

  it('solidworks: middle orbits, Ctrl pans, Shift drag-zooms, left idle', () => {
    expect(resolveMouseAction('solidworks', 1, { ctrlKey: false, shiftKey: false, altKey: false }, false))
      .toEqual({ kind: 'orbit', constrained: false });
    expect(resolveMouseAction('solidworks', 1, { ctrlKey: true, shiftKey: false, altKey: false }, false))
      .toEqual({ kind: 'pan' });
    expect(resolveMouseAction('solidworks', 1, { ctrlKey: false, shiftKey: true, altKey: false }, false))
      .toEqual({ kind: 'dragZoom' });
    expect(resolveMouseAction('solidworks', 0, { ctrlKey: false, shiftKey: false, altKey: false }, false))
      .toEqual({ kind: 'none' });
  });
});
