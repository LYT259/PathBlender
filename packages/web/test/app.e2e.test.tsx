/**
 * End-to-end smoke tests on the real App component (jsdom):
 * import → robot list → collision report → what-if delay → errors.
 * Path files come straight from the physical sample suite (samples/).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

function selectRobot(identity: string, regionName: string): HTMLElement {
  // The row tooltip carries the full identity (display name, or #teamNumber,
  // or route name); the inspector region keeps the imported route name.
  const label = [...document.querySelectorAll('.robot-library-name')].find((element) => element.getAttribute('title') === identity);
  expect(label).toBeDefined();
  fireEvent.click(label!.closest('button')!);
  return screen.getByRole('region', { name: regionName, exact: true });
}

describe('App import → fusion → collision flow', () => {
  it('cancels a pending import notice when the app is closed', async () => {
    const timeout = vi.spyOn(window, 'setTimeout');
    const clear = vi.spyOn(window, 'clearTimeout');
    const app = render(<App />);
    try {
      const route = file('ghostauto/straight_run.ghostauto');
      Object.defineProperty(route, 'webkitRelativePath', { value: 'routes/straight_run.ghostauto' });
      dropFiles([route]);
      await waitFor(() => expect(timeout.mock.calls.some((call) => call[1] === 2500)).toBe(true));
      const index = timeout.mock.calls.findIndex((call) => call[1] === 2500);
      const timer = timeout.mock.results[index].value;
      app.unmount();
      expect(clear).toHaveBeenCalledWith(timer);
    } finally {
      app.unmount();
      timeout.mockRestore();
      clear.mockRestore();
    }
  });

  it('switches field construction with mutually exclusive buttons and remembers the choice', async () => {
    const app = render(<App />);
    dropFiles([file('ghostauto/straight_run.ghostauto')]);
    const group = await screen.findByRole('group', { name: 'Field construction (welded vs AndyMark-built)' });
    const andymark = within(group).getByRole('button', { name: 'AndyMark' });
    const welded = within(group).getByRole('button', { name: 'Welded' });
    fireEvent.click(andymark);
    expect(andymark).toHaveAttribute('aria-pressed', 'true');
    expect(welded).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(welded);
    expect(welded).toHaveAttribute('aria-pressed', 'true');
    expect(andymark).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(andymark);
    app.unmount();
    render(<App />);
    dropFiles([file('ghostauto/straight_run.ghostauto')]);
    const restored = await screen.findByRole('group', { name: 'Field construction (welded vs AndyMark-built)' });
    expect(within(restored).getByRole('button', { name: 'AndyMark' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the empty state', () => {
    render(<App />);
    expect(document.querySelector('.toolbar')).not.toBeNull();
    expect(screen.queryByRole('complementary', { name: /Robots \(0\)/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import path files', exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show or hide path list' })).not.toBeInTheDocument();
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
    expect(screen.getByText('Choreo', { selector: '.robot-library-meta span' })).toBeInTheDocument();
    expect(screen.getByText('#0001', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('#0002', { selector: '.robot-name' })).toBeInTheDocument();
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
      screen.getByText('#0001 × #0002', { selector: '.conflict-pair' }),
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

  it('team numbers: extracted from .ghostauto, shown on the heading and robot card', async () => {
    render(<App />);
    dropFiles([file('ghostauto/straight_run.ghostauto')]);
    await waitFor(
      () => {
        expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
      },
    );
    const inspector = selectRobot('#0001', 'Straight Run');
    // The identity rows under the heading (team # / alliance) were removed
    // 2026-10-04; the team number still shows in the inspector heading and
    // on the robot card.
    expect(within(inspector).getByRole('heading', { name: '#0001' })).toBeInTheDocument();
    expect(within(inspector).queryByText('team #')).not.toBeInTheDocument();
    expect(within(inspector).queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('#0001', { selector: '.robot-library-team' })).toBeInTheDocument();
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
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Light', exact: true }));
    expect(document.documentElement.dataset.theme).toBe(initialTheme);
    expect(localStorage.getItem('pb.theme')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save$/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('pb.theme')).toBe('light');
    // Save keeps the dialog open (user request 2026-10-02); Cancel closes it.
    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    const nextDialog = screen.getByRole('dialog', { name: 'Preferences' });
    fireEvent.click(within(nextDialog).getByRole('radio', { name: 'Follow system', exact: true }));
    fireEvent.click(within(nextDialog).getByRole('button', { name: /^Save$/i }));
    expect(localStorage.getItem('pb.theme')).toBeNull();
  });

  it('preferences: Save waits for a change and Cancel always gets you out', () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    const initialTheme = document.documentElement.dataset.theme;
    const other = initialTheme === 'light' ? 'dark' : 'light';
    const themeOf = (scope: HTMLElement) =>
      within(scope).getByRole('radio', { checked: true }) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    const dialog = screen.getByRole('dialog', { name: 'Preferences' });
    const initialMode = themeOf(dialog).value;
    const save = within(dialog).getByRole('button', { name: /^Save$/i });
    // Untouched dialog: Save has nothing to save, and Cancel — which used to be
    // the disabled one — is the way out (user report 2026-09-24).
    expect(save).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe(initialTheme);

    // After a change both are live, and Cancel throws the draft away rather
    // than leaving it staged for the next time the dialog opens.
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    const next = screen.getByRole('dialog', { name: 'Preferences' });
    fireEvent.click(within(next).getByRole('radio', { name: other === 'dark' ? 'Dark' : 'Light', exact: true }));
    expect(within(next).getByRole('button', { name: /^Save$/i })).toBeEnabled();
    fireEvent.click(within(next).getByRole('button', { name: /^Cancel$/i }));
    expect(document.documentElement.dataset.theme).toBe(initialTheme);
    expect(localStorage.getItem('pb.theme')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    const again = screen.getByRole('dialog', { name: 'Preferences' });
    expect(themeOf(again).value).toBe(initialMode);
    expect(within(again).getByRole('button', { name: /^Save$/i })).toBeDisabled();
    // A disabled Save is not a hidden one: clicking it must not close the
    // dialog either, so the row reads as "nothing to save yet".
    fireEvent.click(within(again).getByRole('button', { name: /^Save$/i }));
    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeInTheDocument();
  });

  it('AI assistant stays withdrawn: no entry point in toolbar, inspector or preferences', async () => {
    render(<App />);
    dropFiles([file('ghostauto/side_lane.ghostauto')]);
    await screen.findByText('#0003', { selector: '.robot-name' });
    // 2026-09-20 retreat: every assistant surface is unreachable while
    // AI_ENABLED is false (ai/availability.ts); the code itself remains.
    expect(screen.queryByRole('button', { name: 'AI Assistant', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assistant', exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /preferences/i }));
    expect(document.querySelector('.prefs-modal')).not.toBeNull();
    expect(document.querySelector('.prefs-ai')).toBeNull();
  });

  it('conflicts stay visible and read-only — the viewer adjusts nothing for you', async () => {
    render(<App />);
    dropFiles([
      file('ghostauto/straight_run.ghostauto'),
      file('ghostauto/stop_and_score.ghostauto'),
    ]);
    await waitFor(
      () => {
        expect(screen.getByText(/Robots \(2\)/)).toBeInTheDocument();
      },
    );
    await waitFor(
      () => {
        expect(screen.getByText('1', { selector: '.conflict-count' })).toBeInTheDocument();
      },
    );
    const inspector = selectRobot('#0001', 'Straight Run');
    // The composition editor replaces the old read-only delay row; it does
    // not auto-resolve collisions (viewer-only positioning stays intact).
    expect(within(inspector).getByRole('spinbutton', { name: 'Start 1' })).toHaveValue(0);
    expect(within(inspector).getByRole('heading', { name: 'Auto sequence' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resolve|adjust/i })).not.toBeInTheDocument();
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
    expect(screen.getByText('#0003', { selector: '.robot-name' })).toBeInTheDocument();
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
    expect(screen.getByText('PathPlanner', { selector: '.robot-library-meta span' })).toBeInTheDocument();
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
    expect(screen.getByText('PP Auto', { selector: '.robot-library-meta span' })).toBeInTheDocument();
    expect(screen.getAllByText(/9\.22/, { selector: '.robot-library-meta span' }).length).toBeGreaterThan(0);
  }, 30000);

  it('shows the file alliance read-only and saves sessions with file-supplied geometry', async () => {
    render(<App />);
    dropFiles([file('traj/v3_swerve.traj')]);
    await waitFor(
      () => {
      expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument();
    });
    const inspector = selectRobot('#AAAAAA', 'swerve');
    // Pure viewer (2026-09-30): alliance comes from the file; no toggle.
    expect(within(inspector).queryByRole('button', { name: 'Blue' })).not.toBeInTheDocument();
    expect(within(inspector).queryByRole('button', { name: 'Red' })).not.toBeInTheDocument();
    // The inspector alliance row went with the identity block (2026-10-04);
    // the alliance now shows on the toolbar toggle alone.
    expect(within(inspector).queryByText(/^(blue|red)$/i)).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'alliance' })).getByRole('button', { name: 'Blue' })).toBeInTheDocument();
    expect(within(inspector).queryByRole('spinbutton', { name: /length|width/i })).not.toBeInTheDocument();
    expect(inspector.querySelector('.robot-dimensions')).toHaveTextContent('0.81 m');
    // The responsive overflow menu contains a second Save action; jsdom
    // does not apply the CSS breakpoint that chooses between the two.
    expect(screen.getByText('Save session', { selector: '.toolbar > .save-action' })).toBeEnabled();
  });
});

describe('artwork style switcher vs 3D', () => {
  it('shows the schematic/rendered switcher in 2D but hides it in 3D (identical scene)', async () => {
    render(<App />);
    dropFiles([file('ghostauto/straight_run.ghostauto')]);
    await waitFor(() => expect(screen.getByText(/Robots \(1\)/)).toBeInTheDocument());

    // Default field (2026) has both artwork styles and a 3D model.
    const style = () => document.querySelector('.field-style-toggle');
    expect(style()).not.toBeNull(); // 2D: switchable

    fireEvent.click(screen.getByRole('button', { name: '3D', exact: true }));
    expect(style()).toBeNull(); // 3D: official model replaces the artwork
    const trails = screen.getByRole('checkbox', { name: 'trails' });
    expect(trails).toBeChecked();
    fireEvent.click(trails);
    expect(trails).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '2D', exact: true }));
    expect(style()).not.toBeNull(); // back to 2D: the choice returns
    expect(screen.getByRole('checkbox', { name: 'trails' })).not.toBeChecked();
  });
});
