/**
 * End-to-end smoke tests on the real App component (jsdom):
 * import → robot list → collision report → what-if delay → errors.
 * Path files come straight from the physical sample suite (samples/).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { ThemeProvider } from '../src/theme';

const SAMPLES = resolve(__dirname, '../../../samples');
const read = (rel: string): string =>
  readFileSync(resolve(SAMPLES, rel), 'utf-8');

const file = (rel: string): File =>
  new File([read(rel)], rel.split('/').pop() as string, {
    type: 'application/json',
  });

function dropFiles(files: File[]): void {
  fireEvent.drop(window, { dataTransfer: { files } });
}

describe('App import → fusion → collision flow', () => {
  it('renders the empty state', () => {
    render(<App />);
    expect(document.querySelector('.toolbar')).not.toBeNull();
    expect(screen.getByText(/Robots \(0\)/)).toBeInTheDocument();
  });

  it('imports a Choreo .traj and a .ghostauto, reports their collision', async () => {
    render(<App />);
    dropFiles([
      file('traj/v3_swerve.traj'),
      file('ghostauto/straight_run.ghostauto'),
      file('ghostauto/stop_and_score.ghostauto'),
    ]);

    await waitFor(
      () => {
      expect(screen.getByText(/Robots \(3\)/)).toBeInTheDocument();
    });

    // Choreo card + ghost cards
    expect(screen.getByText('swerve', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('Straight Run', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('Stop And Score', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('Team 0001', { selector: '.robot-meta span' })).toBeInTheDocument();

    // Collisions: the tuned pair (straight_run × stop_and_score) plus the
    // Choreo swerve sample, which starts at (1,1) right next to Straight
    // Run's (2,2) start box and overlaps it in the first second.
    await waitFor(
      () => {
        expect(screen.getByText('2', { selector: '.conflict-count' })).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(
      screen.getByText('Straight Run × Stop And Score', { selector: '.conflict-pair' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/closest/i, { selector: '.conflict-when' })).toHaveLength(2);
  });

  it('assigns each imported robot a distinct color from the palette', async () => {
    render(<App />);
    dropFiles([
      file('ghostauto/straight_run.ghostauto'),
      file('ghostauto/stop_and_score.ghostauto'),
      file('ghostauto/side_lane.ghostauto'),
    ]);
    await waitFor(
      () => {
        expect(screen.getByText(/Robots \(3\)/)).toBeInTheDocument();
      },
    );
    const colors = Array.from(
      document.querySelectorAll('.robot-card .band-dot'),
    ).map((el) => (el as HTMLElement).style.background);
    expect(colors).toHaveLength(3);
    expect(new Set(colors).size).toBe(3);
  });

  it('team numbers: extracted from .ghostauto, editable on the card', async () => {
    render(<App />);
    dropFiles([file('ghostauto/straight_run.ghostauto')]);
    await waitFor(
      () => {
        expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
      },
    );
    const input = document.querySelector(
      '.robot-card input[inputmode="numeric"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('0001');
    fireEvent.change(input, { target: { value: '254' } });
    expect(input.value).toBe('254');
  });

  it('the file picker has no extension filter (all formats selectable)', () => {
    render(<App />);
    const input = document.querySelector(
      '.toolbar input[type="file"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute('accept')).toBeFalsy();
  });

  it('theme: follows system by default, manual choice sticks', () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    // system default resolves to something and sets the attribute
    expect(['dark', 'light']).toContain(document.documentElement.dataset.theme);
    fireEvent.click(screen.getByRole('button', { name: /Preferences|偏好设置/ }));
    const selects = document.querySelectorAll('.prefs-modal select');
    // order: language, theme, channel — theme is the second-to-last
    const themeSelect = selects[selects.length - 2] as HTMLSelectElement;
    fireEvent.change(themeSelect, { target: { value: 'light' } });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('ghpb.theme')).toBe('light');
    fireEvent.change(themeSelect, { target: { value: 'dark' } });
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.change(themeSelect, { target: { value: 'system' } });
    expect(localStorage.getItem('ghpb.theme')).toBeNull();
  });

  it('AI panel opens on the new-chat view; gear reveals settings (default off, no network)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'AI Assistant', exact: true }));
    // New-chat hero first; settings live behind the gear.
    expect(document.querySelector('.ai-panel')).not.toBeNull();
    expect(document.querySelector('.ai-hero')).not.toBeNull();
    expect(document.querySelector('.ai-settings')).toBeNull();
    fireEvent.click(document.querySelector('.ai-icon-btn')!);
    expect(document.querySelector('.ai-settings')).not.toBeNull();
    expect(document.querySelector('.ai-hero')).toBeNull();
  });

  it('the what-if start delay resolves the collision', async () => {
    render(<App />);
    dropFiles([
      file('ghostauto/straight_run.ghostauto'),
      file('ghostauto/stop_and_score.ghostauto'),
    ]);
    await waitFor(
      () => {
      expect(screen.getByText(/Robots \(2\)/)).toBeInTheDocument();
    });
    await waitFor(
      () => {
      expect(
        screen.getAllByText('collision', { selector: '.conflict-tag' }).length,
      ).toBeGreaterThan(0);
    });

    // Find the delay input inside the Straight Run card and set 3.5 s.
    const straightCard = screen
      .getByText('Straight Run', { selector: '.robot-name' })
      .closest('div.robot-card');
    expect(straightCard).not.toBeNull();
    const delayInput = straightCard!.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    fireEvent.change(delayInput, { target: { value: '3.5' } });

    await waitFor(
      () => {
      expect(screen.getByText('0', { selector: '.conflict-count' })).toBeInTheDocument();
    });
  });

  it('bad files produce an actionable error banner, good ones still import', async () => {
    render(<App />);
    dropFiles([
      new File(['not json{'], 'broken.traj'),
      file('ghostauto/side_lane.ghostauto'),
    ]);
    await waitFor(
      () => {
      expect(screen.getByText(/file\(s\) failed to import/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/not valid JSON/i, { selector: '.import-banner li' })).toBeInTheDocument();
    await waitFor(
      () => {
      expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
    });
    expect(screen.getByText('Side Lane', { selector: '.robot-name' })).toBeInTheDocument();
  });

  it('PathPlanner .path now imports natively (Phase 2 generation)', async () => {
    render(<App />);
    dropFiles([file('pathplanner/Pickup.path')]);
    await waitFor(
      () => {
        expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    expect(screen.getByText('Pickup', { selector: '.robot-name' })).toBeInTheDocument();
  });

  it('.auto imports when its referenced .path files arrive in the same batch', async () => {
    render(<App />);
    dropFiles([
      file('pathplanner/Example Auto.auto'),
      file('pathplanner/Pickup.path'),
      file('pathplanner/Score.path'),
    ]);
    // All three become robots: the chained auto plus the two standalone paths.
    // The auto shares Pickup's start pose, so a collision is also reported —
    // correct behavior for a path double-entered into an alliance plan.
    await waitFor(
      () => {
        expect(screen.getByText(/Robots \(3\)/)).toBeInTheDocument();
      },
      { timeout: 10000 },
    );
    expect(screen.getByText('Example Auto', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getAllByText(/9\.22/, { selector: '.robot-meta span' }).length).toBeGreaterThan(0);
  }, 30000);

  it('exposes alliance switching, geometry editing, and session save on robot cards', async () => {
    render(<App />);
    dropFiles([file('traj/v3_swerve.traj')]);
    await waitFor(
      () => {
      expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Blue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Red' })).toBeInTheDocument();
    expect(screen.getByTitle('length')).toBeInTheDocument();
    expect(screen.getByTitle('width')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save session/i })).toBeEnabled();
  });
});
