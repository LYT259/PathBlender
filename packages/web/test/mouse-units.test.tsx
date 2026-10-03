import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatLength,
  lengthUnitSuffix,
  readLengthUnit,
  useLengthUnit,
  writeLengthUnit,
} from '../src/length-units';
import { readMouseControls, useMouseControls, writeMouseControls } from '../src/mouse-controls';

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
