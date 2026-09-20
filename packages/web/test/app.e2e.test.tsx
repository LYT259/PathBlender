/**
 * End-to-end smoke tests on the real App component (jsdom):
 * import → robot list → collision report → what-if delay → errors.
 * Path files come straight from the physical sample suite (samples/).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
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

beforeEach(() => localStorage.clear());

function selectRobot(name: string): HTMLElement {
  fireEvent.click(screen.getByText(name, { selector: '.robot-name' }));
  return screen.getByRole('region', { name, exact: true });
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
    expect(screen.getByText('#0001', { selector: '.robot-library-team' })).toBeInTheDocument();

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
      document.querySelectorAll('.robot-library-row .band-dot'),
    ).map((el) => (el as HTMLElement).style.background);
    expect(colors).toHaveLength(3);
    expect(new Set(colors).size).toBe(3);
  });

  it('team numbers: extracted from .ghostauto, editable in the selected robot inspector', async () => {
    render(<App />);
    dropFiles([file('ghostauto/straight_run.ghostauto')]);
    await waitFor(
      () => {
        expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
      },
    );
    const inspector = selectRobot('Straight Run');
    const input = within(inspector).getByRole('textbox', { name: /team/i }) as HTMLInputElement;
    expect(input.value).toBe('0001');
    fireEvent.change(input, { target: { value: '254' } });
    expect(input.value).toBe('254');
    expect(screen.getByText('#254', { selector: '.robot-library-team' })).toBeInTheDocument();
  });

  it('the file picker has no extension filter (all formats selectable)', () => {
    render(<App />);
    const input = document.querySelector(
      '.toolbar input[type="file"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute('accept')).toBeFalsy();
  });

  it('theme: stages a manual choice until Save and persists the saved choice', () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    // system default resolves to something and sets the attribute
    expect(['dark', 'light']).toContain(document.documentElement.dataset.theme);
    const initialTheme = document.documentElement.dataset.theme;
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    const dialog = screen.getByRole('dialog', { name: 'Preferences' });
    const themeSelect = within(dialog).getByRole('combobox', { name: /theme|appearance/i });
    fireEvent.change(themeSelect, { target: { value: 'light' } });
    expect(document.documentElement.dataset.theme).toBe(initialTheme);
    expect(localStorage.getItem('ghpb.theme')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save$/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('ghpb.theme')).toBe('light');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    const nextDialog = screen.getByRole('dialog', { name: 'Preferences' });
    fireEvent.change(within(nextDialog).getByRole('combobox', { name: /theme|appearance/i }), { target: { value: 'system' } });
    fireEvent.click(within(nextDialog).getByRole('button', { name: /^Save$/i }));
    expect(localStorage.getItem('ghpb.theme')).toBeNull();
  });

  it('AI panel opens on the new-chat view; gear opens Preferences with AI settings', async () => {
    render(<App />);
    dropFiles([file('ghostauto/side_lane.ghostauto')]);
    await screen.findByText('Side Lane', { selector: '.robot-name' });
    fireEvent.click(screen.getByRole('button', { name: 'AI Assistant', exact: true }));
    // New-chat hero first; gear now opens the Preferences modal.
    expect(document.querySelector('.ai-panel')).not.toBeNull();
    expect(document.querySelector('.ai-hero')).not.toBeNull();
    expect(document.querySelector('.ai-settings')).toBeNull();
    // Gear is the last of the three top-bar icons (history, new chat, gear).
    const topBtns = document.querySelectorAll('.ai-top .ai-icon-btn');
    fireEvent.click(topBtns[topBtns.length - 1]!);
    // Preferences modal shows the AI section (single settings entry).
    expect(document.querySelector('.prefs-modal')).not.toBeNull();
    expect(document.querySelector('.prefs-ai')).not.toBeNull();
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
      expect(screen.getByText('1', { selector: '.conflict-count' })).toBeInTheDocument();
    });

    // Delay edits commit on blur, so incomplete typing never changes the plan.
    const inspector = selectRobot('Straight Run');
    const delayInput = within(inspector).getByRole('spinbutton', { name: /delay/i });
    fireEvent.change(delayInput, { target: { value: '3.5' } });
    fireEvent.blur(delayInput);
    fireEvent.click(screen.getByRole('button', { name: /^Checks/i }));

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
    expect(screen.getAllByText(/9\.22/, { selector: '.robot-library-meta span' }).length).toBeGreaterThan(0);
  }, 30000);

  it('exposes alliance switching and session save while preserving file-supplied geometry', async () => {
    render(<App />);
    dropFiles([file('traj/v3_swerve.traj')]);
    await waitFor(
      () => {
      expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
    });
    const inspector = selectRobot('swerve');
    expect(screen.getByRole('button', { name: 'Blue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Red' })).toBeInTheDocument();
    expect(within(inspector).queryByRole('spinbutton', { name: /length|width/i })).not.toBeInTheDocument();
    expect(inspector.querySelector('.robot-dimensions')).toHaveTextContent('0.81 m');
    // The responsive overflow menu contains a second Save action; jsdom
    // does not apply the CSS breakpoint that chooses between the two.
    expect(screen.getByText('Save session', { selector: '.toolbar > .save-action' })).toBeEnabled();
  });
});
