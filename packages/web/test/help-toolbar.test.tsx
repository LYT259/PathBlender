/**
 * Toolbar help entry (2026-10-10): the ? button — removed with 0cef73b,
 * restored the same day — opens the quick guide, whose footer carries the
 * keyboard-shortcuts list. The A-B compare feature (briefly a toolbar
 * button) was deleted outright the same evening on user decision; the
 * overflow menu stayed gone.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';

const SAMPLES = resolve(__dirname, '../../../samples');

// The app autosaves and restores its session from localStorage — without a
// wipe, each test would inherit the previous test's robots.
beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); });

describe('toolbar help entry', () => {
  it('the ⋯ overflow menu no longer exists', () => {
    render(<App />);
    expect(document.querySelector('.workspace-menu')).toBeNull();
  });

  it('no A-B compare control remains anywhere (feature deleted 2026-10-10)', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: /A-B compare/ })).toBeNull();
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

  it('the guide still opens with robots on the field', async () => {
    render(<App />);
    const text = readFileSync(resolve(SAMPLES, 'ghostauto/straight_run.ghostauto'), 'utf-8');
    fireEvent.drop(window, {
      dataTransfer: {
        files: [new File([text], 'straight_run.ghostauto', { type: 'application/json' })],
      },
    });
    await waitFor(() => {
      expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick guide' })[0]!);
    expect(screen.getByRole('dialog', { name: 'Quick guide' })).toBeInTheDocument();
  });
});
