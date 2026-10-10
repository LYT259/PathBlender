/**
 * Toolbar rework (2026-10-10): the ⋯ overflow menu is gone. A-B compare is
 * a standalone toolbar button whose armed state is visible (lit between the
 * baseline snapshot and the compare click, cleared by a whole-scene reset);
 * the ? help button — removed with 0cef73b, restored — opens the quick
 * guide, whose footer carries the keyboard-shortcuts list.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';

// The app autosaves and restores its session from localStorage — without a
// wipe, each test would inherit the previous test's robots.
beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); });

const SAMPLES = resolve(__dirname, '../../../samples');

function importFiles(rels: string[]): void {
  fireEvent.drop(window, {
    dataTransfer: {
      files: rels.map((rel) => new File([readFileSync(resolve(SAMPLES, rel), 'utf-8')], rel.split('/').pop() as string, { type: 'application/json' })),
    },
  });
}

const abButton = () => screen.getByRole('button', { name: 'A-B compare' });

describe('toolbar help + A-B compare', () => {
  it('the ⋯ overflow menu no longer exists', () => {
    render(<App />);
    expect(document.querySelector('.workspace-menu')).toBeNull();
  });

  it('A-B arms visibly, reports, and the lit state clears', async () => {
    render(<App />);
    importFiles(['ghostauto/straight_run.ghostauto', 'ghostauto/side_lane.ghostauto']);
    await waitFor(() => {
      expect(screen.getByText(/Robots \(2\)/)).toBeInTheDocument();
    });

    expect(abButton().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(abButton());
    expect(abButton().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Baseline saved/)).toBeInTheDocument();

    fireEvent.click(abButton());
    expect(abButton().getAttribute('aria-pressed')).toBe('false');
    // Two comparable robots: the second click reports a tightest-pair delta
    // (safer or tighter — the direction depends on the pair, the report does not).
    expect(screen.getByText(/Tightest pair/)).toBeInTheDocument();
  });

  it('returning home clears an armed baseline with the session', async () => {
    render(<App />);
    importFiles(['ghostauto/straight_run.ghostauto']);
    await waitFor(() => {
      expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
    });
    fireEvent.click(abButton());
    expect(abButton().getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /Back to home/ }));
    // Wait for the welcome screen before dropping again — a real user cannot
    // re-import within the same tick as the reset.
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /Import paths to get started/ })).toBeInTheDocument();
    });
    importFiles(['ghostauto/side_lane.ghostauto']);
    await waitFor(() => {
      expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
    });
    // The armed light must not outlive the scenario it snapshotted.
    expect(abButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('the ? toolbar button opens the quick guide, which links the shortcuts', () => {
    render(<App />);
    // The welcome screen also links the guide, so scope to the toolbar
    // header (the welcome card carries its own banner).
    const header = screen.getByRole('banner', { name: 'PathBlender' });
    fireEvent.click(within(header).getByRole('button', { name: 'Quick guide' }));
    const guide = screen.getByRole('dialog', { name: 'Quick guide' });
    expect(guide).toBeInTheDocument();
    fireEvent.click(within(guide).getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });
});
