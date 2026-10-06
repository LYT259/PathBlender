/**
 * Check-summary trim (user request 2026-10-06): the "basis" sentence, the
 * participation-scope line and the closest-approach readout no longer render —
 * the clear summary stays icon + title (+ hidden count). The single-robot
 * hint survives: it is a different, actionable sentence.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';

const ghostauto = (name: string) => new File(
  [readFileSync(resolve(__dirname, '../../../samples/ghostauto', name), 'utf8')],
  name,
);
const drop = (files: File[]) => fireEvent.drop(window, { dataTransfer: { files } });

beforeEach(() => localStorage.clear());
// Import toasts schedule a 2.5 s dismiss; let the timers settle before the
// environment tears down.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 2600)));

describe('checks panel summary trim', () => {
  it('shows no basis sentence, scope line or closest-approach readout', async () => {
    const { container } = render(<App />);
    drop([ghostauto('straight_run.ghostauto'), ghostauto('stop_and_score.ghostauto')]);
    await waitFor(() => expect(container.querySelector('.conflict-panel')).not.toBeNull());
    expect(screen.queryByText(/For the imported paths/)).toBeNull();
    expect(screen.queryByText(/robots included/)).toBeNull();
    expect(container.querySelector('.min-sep')).toBeNull();
  });

  it('keeps the single-robot hint', async () => {
    const { container } = render(<App />);
    drop([ghostauto('straight_run.ghostauto')]);
    await waitFor(() => expect(container.querySelector('.conflict-panel')).not.toBeNull());
    expect(screen.getByText(/Import another robot to compare paths/)).toBeInTheDocument();
  });
});
