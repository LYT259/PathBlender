import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatLength,
  lengthUnitSuffix,
  readLengthUnit,
  useLengthUnit,
  writeLengthUnit,
} from '../src/length-units';
import {
  defaultConstrainedPref,
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

  it('formats feet+inches, dropping a leading zero foot', () => {
    // 0.927 m = 36.5 in = 3 ft 0.5 in.
    expect(formatLength(0.927, 'ftin')).toBe('3′0.5″');
    expect(formatLength(0.2, 'ftin')).toBe('7.9″');
  });

  it('keeps the sign for penetration depths', () => {
    expect(formatLength(-0.12, 'm')).toBe('-0.12 m');
    expect(formatLength(-0.12, 'in')).toBe('-4.7 in');
  });

  it('exposes a short suffix per unit', () => {
    expect(lengthUnitSuffix('ftin')).toBe('ft/in');
    expect(lengthUnitSuffix('cm')).toBe('cm');
  });
});

describe('length unit preference', () => {
  it('defaults to meters and persists writes', () => {
    expect(readLengthUnit()).toBe('m');
    writeLengthUnit('in');
    expect(readLengthUnit()).toBe('in');
  });

  it('falls back to meters for unknown stored values', () => {
    localStorage.setItem('pb.lengthUnit', 'furlongs');
    expect(readLengthUnit()).toBe('m');
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
