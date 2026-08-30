/**
 * Keyboard shortcuts on the unified clock: ←/→ scrub, Shift-± large step,
 * Home rewind, Space toggle — and none of them fire while typing in inputs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

const SAMPLES = resolve(__dirname, '../../../samples');

function importOne(rel: string): void {
  const text = readFileSync(resolve(SAMPLES, rel), 'utf-8');
  fireEvent.drop(window, {
    dataTransfer: {
      files: [new File([text], rel.split('/').pop() as string, { type: 'application/json' })],
    },
  });
}

const clock = () => parseFloat(screen.getByText(/s$/, { selector: '.clock' }).textContent ?? '-1');

describe('playback keyboard shortcuts', () => {
  it('arrows scrub, Shift widens the step, Home rewinds', async () => {
    render(<App />);
    importOne('ghostauto/straight_run.ghostauto');
    await waitFor(() => {
      expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { code: 'ArrowRight', key: 'ArrowRight' });
    expect(clock()).toBeCloseTo(0.5, 5);
    fireEvent.keyDown(window, { code: 'ArrowRight', key: 'ArrowRight', shiftKey: true });
    expect(clock()).toBeCloseTo(2.5, 5);
    fireEvent.keyDown(window, { code: 'ArrowLeft', key: 'ArrowLeft' });
    expect(clock()).toBeCloseTo(2.0, 5);
    fireEvent.keyDown(window, { code: 'Home', key: 'Home' });
    expect(clock()).toBeCloseTo(0, 5);
  });

  it('shortcuts stay inert while a form control has focus', async () => {
    render(<App />);
    importOne('ghostauto/straight_run.ghostauto');
    await waitFor(() => {
      expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
    });
    const delayInput = document.querySelector(
      '.robot-card input[type="number"]',
    ) as HTMLInputElement;
    expect(delayInput).not.toBeNull();
    delayInput.focus();
    fireEvent.keyDown(delayInput, { code: 'ArrowRight', key: 'ArrowRight' });
    expect(clock()).toBeCloseTo(0, 5);
  });
});
