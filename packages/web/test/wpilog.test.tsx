/**
 * WPILOG import dialog tests (jsdom — the parse client falls back to its
 * synchronous path, so these exercise the same core functions the worker
 * runs). Covers: no-pose dead end, default selection → route, manual time
 * range, and failure isolation in a mixed batch.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REBUILT_2026 } from '@pathblender/core';
import type { WpilogIncomingFile, WpilogImportResult } from '../src/wpilog/WpilogImportDialog';
import { WpilogImportDialog } from '../src/wpilog/WpilogImportDialog';
import { I18nProvider } from '../src/i18n';

const SAMPLES = resolve(__dirname, '../../../samples');

/** A real DogLog/NT log with struct schemas (see samples/wpilog/README.md). */
const FIXTURE = new Uint8Array(readFileSync(resolve(SAMPLES, 'wpilog/WPILIB_TBD_aba74b981a582b4b.wpilog')));

function dialogProps(files: WpilogIncomingFile[], onDone: (result: WpilogImportResult) => void) {
  return {
    files,
    field: REBUILT_2026,
    onDone,
    onCancel: () => undefined,
  };
}

describe('WpilogImportDialog', () => {
  it('reports a log without pose candidates as an honest dead end', async () => {
    const bytes = new Uint8Array([0x57, 0x50, 0x49, 0x4c, 0x4f, 0x47, 0x00, 0x01, 0, 0, 0, 0]);
    render(<I18nProvider><WpilogImportDialog
      {...dialogProps([{ file: new File([bytes], 'empty.wpilog'), relPath: 'empty.wpilog' }], () => undefined)}
    /></I18nProvider>);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByRole('alert').textContent).toMatch(/No pose data/i);
    const importButton = document.querySelector('.wpilog-actions button.accent') as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);
  });

  it('reads the real DogLog fixture and lands on its honest limits', async () => {
    // The fixture logs telemetry but no field pose — the dialog must say so
    // rather than inventing a route from joysticks.
    render(<I18nProvider><WpilogImportDialog
      {...dialogProps([{ file: new File([FIXTURE], 'doglog.wpilog'), relPath: 'doglog.wpilog' }], () => undefined)}
    /></I18nProvider>);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 6000 });
    expect(screen.getByRole('alert').textContent).toMatch(/No pose data/i);
  });

  it('routes a synthetic log through candidate → interval → route', async () => {
    const log = buildLog();
    const results: WpilogImportResult[] = [];
    render(<I18nProvider><WpilogImportDialog
      {...dialogProps([{ file: new File([log], 'robot.wpilog'), relPath: 'robot.wpilog' }], (r) => results.push(r))}
    /></I18nProvider>);
    await waitFor(() => expect(screen.getAllByRole('radio').length).toBeGreaterThan(2), { timeout: 4000 });
    const importButton = document.querySelector('.wpilog-actions button.accent') as HTMLButtonElement;
    expect(importButton.disabled).toBe(false);
    fireEvent.click(importButton);
    await waitFor(() => expect(results).toHaveLength(1));
    const result = results[0]!;
    expect(result.failures).toHaveLength(0);
    expect(result.routes).toHaveLength(1);
    const traj = result.routes[0]!.trajectory;
    expect(traj.source).toBe('wpilog');
    expect(traj.samples.length).toBeGreaterThan(10);
    // t=0 is the auto start (control word enabled at 1 s; poses from 1 s on).
    expect(traj.samples[0]!.t).toBeCloseTo(0, 3);
    expect(traj.samples[0]!.x).toBeCloseTo(1, 3);
    expect(traj.durationS).toBeGreaterThan(2);
  });

  it('supports switching to the manual time range', async () => {
    const log = buildLog();
    const results: WpilogImportResult[] = [];
    render(<I18nProvider><WpilogImportDialog
      {...dialogProps([{ file: new File([log], 'robot.wpilog'), relPath: 'robot.wpilog' }], (r) => results.push(r))}
    /></I18nProvider>);
    await waitFor(() => expect(screen.getAllByRole('radio').length).toBeGreaterThan(2), { timeout: 4000 });
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    const manual = radios.find((r) =>
      r.name === 'wpilog-interval' && r.closest('.wpilog-interval')?.textContent?.match(/manual/i));
    expect(manual).toBeDefined();
    fireEvent.click(manual!);
    const start = document.querySelector('.wpilog-manual input[type=number]') as HTMLInputElement;
    expect(start).toBeTruthy();
    fireEvent.change(start, { target: { value: '2' } });
    const importButton = document.querySelector('.wpilog-actions button.accent') as HTMLButtonElement;
    fireEvent.click(importButton);
    await waitFor(() => expect(results).toHaveLength(1));
    const traj = results[0]!.routes[0]!.trajectory;
    // Manual window starts 2 s into the log: first kept pose sits at log
    // t=2 s → sample #50 → x = 1 + 50 × 0.1 = 6.
    expect(traj.samples[0]!.x).toBeCloseTo(6, 3);
  });

  it('isolates a failed file while importing the good one', async () => {
    const bad = new Uint8Array([1, 2, 3]);
    const results: WpilogImportResult[] = [];
    render(<I18nProvider><WpilogImportDialog
      {...dialogProps([
        { file: new File([bad], 'bad.wpilog'), relPath: 'bad.wpilog' },
        { file: new File([buildLog()], 'good.wpilog'), relPath: 'good.wpilog' },
      ], (r) => results.push(r))}
    /></I18nProvider>);
    await waitFor(() => expect(document.querySelectorAll('.wpilog-file').length).toBe(2), { timeout: 4000 });
    const importButton = document.querySelector('.wpilog-actions button.accent') as HTMLButtonElement;
    await waitFor(() => expect(importButton.disabled).toBe(false), { timeout: 4000 });
    fireEvent.click(importButton);
    await waitFor(() => expect(results).toHaveLength(1));
    const result = results[0]!;
    expect(result.routes.map((r) => r.relPath)).toEqual(['good.wpilog']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.relPath).toBe('bad.wpilog');
  });
});

/* ------------------------------------------------------------------ */
/* Synthetic log builder (shares the format spec, not core's code)     */
/* ------------------------------------------------------------------ */

class LogWriter {
  private chunks: number[] = [...[...'WPILOG'].map((c) => c.charCodeAt(0)), 0x00, 0x01, 0, 0, 0, 0];
  private nextId = 1;

  start(name: string, type: string, tsUs = 0): number {
    const id = this.nextId++;
    const enc = new TextEncoder();
    const nameBytes = [...enc.encode(name)];
    const typeBytes = [...enc.encode(type)];
    this.record(0, tsUs, [
      0, ...u32(id), ...u32(nameBytes.length), ...nameBytes,
      ...u32(typeBytes.length), ...typeBytes, ...u32(0),
    ]);
    return id;
  }

  record(entryId: number, tsUs: number, payload: number[]): void {
    const width = (v: number, max: number) => {
      let n = 1;
      while (n < max && v >= 256 ** n) n++;
      return n;
    };
    const idLen = width(entryId, 4);
    const sizeLen = width(payload.length, 4);
    const tsLen = width(tsUs, 8);
    this.chunks.push((idLen - 1) | ((sizeLen - 1) << 2) | ((tsLen - 1) << 4));
    for (let i = 0; i < idLen; i++) this.chunks.push(Math.floor(entryId / 256 ** i) % 256);
    for (let i = 0; i < sizeLen; i++) this.chunks.push(Math.floor(payload.length / 256 ** i) % 256);
    for (let i = 0; i < tsLen; i++) this.chunks.push(Math.floor(tsUs / 256 ** i) % 256);
    this.chunks.push(...payload);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

function u32(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
}

function f64le(...values: number[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) out.push(view.getUint8(i));
  }
  return out;
}

function buildLog(): Uint8Array {
  const writer = new LogWriter();
  const enc = new TextEncoder();
  const put = (id: number, text: string) => writer.record(id, 0, [...enc.encode(text)]);
  put(writer.start('NT:/.schema/struct:Pose2d', 'structschema'), 'Translation2d translation;Rotation2d rotation');
  put(writer.start('NT:/.schema/struct:Translation2d', 'structschema'), 'double x;double y');
  put(writer.start('NT:/.schema/struct:Rotation2d', 'structschema'), 'double value');
  put(
    writer.start('NT:/.schema/struct:ControlWord', 'structschema'),
    'uint64 opModeHash:56;enum{unknown=0,autonomous=1,teleoperated=2,utility=3} uint64 robotMode:2;bool enabled:1;bool eStop:1;bool fmsAttached:1;bool dsAttached:1;',
  );

  const pose = writer.start('NT:/Drivetrain/Pose', 'struct:Pose2d');
  for (let i = 0; i <= 150; i++) {
    const tS = 1 + i * 0.02; // poses from 1 s, 50 Hz
    writer.record(pose, Math.round(tS * 1e6), f64le(1 + i * 0.1, 2, 0.1));
  }
  const cw = writer.start('NT:/DriverStation/ControlWord', 'struct:ControlWord');
  const cwBytes = (mode: number, enabled: boolean) => {
    let whole = BigInt(mode) << 56n;
    if (enabled) whole |= 1n << 58n;
    const out: number[] = [];
    for (let i = 0; i < 8; i++) out.push(Number((whole >> BigInt(8 * i)) & 0xffn));
    return out;
  };
  writer.record(cw, 0, cwBytes(2, false));
  writer.record(cw, 1_000_000, cwBytes(1, true));
  writer.record(cw, 3_500_000, cwBytes(2, false));
  return writer.bytes();
}

/* ------------------------------------------------------------------ */
/* App integration: .wpilog files detour into the dialog             */
/* ------------------------------------------------------------------ */

describe('App wpilog import routing', () => {
  it('routes a dropped .wpilog into the selection dialog and back out', async () => {
    localStorage.clear();
    const { App } = await import('../src/App');
    const { ThemeProvider } = await import('../src/theme');
    const log = buildLog();
    render(<ThemeProvider><App /></ThemeProvider>);
    fireEvent.drop(window, { dataTransfer: { files: [new File([log], 'robot.wpilog')] } });
    // The dialog (not the error banner) answers the drop.
    const dialog = await waitFor(() => document.querySelector('.wpilog-dialog'), { timeout: 5000 });
    expect(dialog).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('radio').length).toBeGreaterThan(2), { timeout: 5000 });
    fireEvent.click(document.querySelector('.wpilog-actions button.accent') as HTMLButtonElement);
    // The dialog closes and the route lands as a robot row (the toast
    // counts it); the row's own route option names the log stem.
    await waitFor(() => expect(document.querySelector('.toast')?.textContent).toMatch(/Imported 1/), { timeout: 5000 });
    expect(document.querySelector('.wpilog-dialog')).toBeNull();
    expect(document.querySelectorAll('.robot-library-name').length).toBeGreaterThan(0);
  });
});
