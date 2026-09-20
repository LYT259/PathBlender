/** User-level regressions for the unified path comparison workspace. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSession, parsePathFile, serializeSession } from '@pathblender/core';
import { App } from '../src/App';

const samples = resolve(__dirname, '../../../samples');

async function importSamples(...paths: string[]) {
  const files = paths.map((path) => new File(
    [readFileSync(resolve(samples, path), 'utf8')],
    path.split('/').at(-1)!,
    { type: 'application/json' },
  ));
  fireEvent.drop(window, { dataTransfer: { files } });
  await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(paths.length));
}

function selectRobot(name: string) {
  fireEvent.click(screen.getByText(name, { selector: '.robot-name' }));
  return within(screen.getByRole('region', { name, exact: true }));
}

function openChecks() {
  fireEvent.click(screen.getByRole('button', { name: /^Checks/i }));
}

const conflictPair = () => screen.getByText('Straight Run × Stop And Score', { selector: '.conflict-pair' });

beforeEach(() => localStorage.clear());

describe('workspace workflow', () => {
  it('offers a working import action before any files are loaded and starts in 2D', () => {
    render(<App />);
    const input = document.querySelector<HTMLInputElement>('.toolbar input[type="file"]')!;
    const openPicker = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    const welcome = document.querySelector<HTMLElement>('.workspace-empty')!;
    expect(welcome).toBeInTheDocument();
    fireEvent.click(within(welcome).getByRole('button', { name: 'Import paths' }));
    expect(openPicker).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Undo$/i })).toBeDisabled();
    openPicker.mockRestore();
  });

  it('keeps hidden robots in collision analysis, then reveals and pauses at a selected conflict', async () => {
    render(<App />);
    await importSamples('ghostauto/straight_run.ghostauto', 'ghostauto/stop_and_score.ghostauto');
    expect(conflictPair()).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.conflict-count' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /hide.*Straight Run/i }));
    expect(screen.getByRole('button', { name: /show.*Straight Run/i })).toHaveAttribute('aria-pressed', 'false');
    expect(conflictPair()).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.conflict-count' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Play$/i }));
    expect(screen.getByRole('button', { name: /^Pause$/i })).toBeInTheDocument();
    fireEvent.click(conflictPair().closest('button')!);

    expect(screen.getByRole('button', { name: /^Play$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide.*Straight Run/i })).toHaveAttribute('aria-pressed', 'true');
    expect(Number((screen.getByRole('slider') as HTMLInputElement).value)).toBeGreaterThan(0);
    expect(conflictPair()).toBeInTheDocument();
  });

  it('lets one Undo restore the original plan after automatic delay resolution and Redo reapply it', async () => {
    render(<App />);
    await importSamples('ghostauto/straight_run.ghostauto', 'ghostauto/stop_and_score.ghostauto');
    expect(conflictPair()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest start delays' }));
    expect(screen.getByText('0', { selector: '.conflict-count' })).toBeInTheDocument();

    const delays = ['Straight Run', 'Stop And Score'].map((name) => {
      const inspector = selectRobot(name);
      return Number((inspector.getByRole('spinbutton', { name: /delay/i }) as HTMLInputElement).value);
    });
    expect(delays.some((delay) => delay > 0)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^Undo$/i }));
    for (const name of ['Straight Run', 'Stop And Score']) {
      expect(selectRobot(name).getByRole('spinbutton', { name: /delay/i })).toHaveValue(0);
    }
    openChecks();
    expect(conflictPair()).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.conflict-count' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Redo$/i }));
    expect(screen.getByText('0', { selector: '.conflict-count' })).toBeInTheDocument();
    expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2);
  });

  it('keeps comparison paths, playback and checks available while editing waypoints', async () => {
    render(<App />);
    await importSamples('traj/v3_swerve.traj', 'ghostauto/straight_run.ghostauto');
    const inspector = selectRobot('swerve');
    fireEvent.click(inspector.getByRole('button', { name: /edit path|adjust path/i }));

    expect(document.querySelector('.waypoint-panel')).toBeInTheDocument();
    expect(document.querySelector('.editing-banner')).toHaveTextContent('swerve');
    expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2);
    expect(screen.getByText('Straight Run', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Play$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: '3D', exact: true })).toBeDisabled();

    openChecks();
    expect(document.querySelector('.editing-banner')).toBeInTheDocument();
    expect(screen.getByText(/swerve × Straight Run/, { selector: '.conflict-pair' })).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2);
  });

  it('does not resolve a conflict from an uncommitted delay draft, and supports undo after commit', async () => {
    render(<App />);
    await importSamples('ghostauto/straight_run.ghostauto', 'ghostauto/stop_and_score.ghostauto');
    const delay = selectRobot('Straight Run').getByRole('spinbutton', { name: /delay/i });
    fireEvent.change(delay, { target: { value: '3.5' } });
    // The list remains an always-visible indication of the current analysis.
    expect(document.querySelectorAll('.robot-library-conflict')).toHaveLength(2);
    fireEvent.blur(delay);
    expect(document.querySelectorAll('.robot-library-conflict')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /^Undo$/i }));
    expect(selectRobot('Straight Run').getByRole('spinbutton', { name: /delay/i })).toHaveValue(0);
    expect(document.querySelectorAll('.robot-library-conflict')).toHaveLength(2);
  });

  it('restores the field and robots together through field changes and whole-session import history', async () => {
    render(<App />);
    await importSamples('ghostauto/straight_run.ghostauto');
    const season = screen.getByRole('combobox', { name: 'Game season' });
    expect(season).toHaveValue('rebuilt-2026');
    fireEvent.change(season, { target: { value: 'reefscape-2025' } });
    expect(season).toHaveValue('reefscape-2025');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(season).toHaveValue('rebuilt-2026');
    expect(screen.getByText('Straight Run', { selector: '.robot-name' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(season).toHaveValue('reefscape-2025');
    expect(screen.getByText('Straight Run', { selector: '.robot-name' })).toBeInTheDocument();

    const originalDelay = selectRobot('Straight Run').getByRole('spinbutton', { name: /delay/i });
    fireEvent.change(originalDelay, { target: { value: '0.5' } });
    fireEvent.blur(originalDelay);

    // Restore a different saved alliance, including its field and timing.
    const savedRobot = makeSession(parsePathFile(
      readFileSync(resolve(samples, 'ghostauto/stop_and_score.ghostauto'), 'utf8'),
      'stop_and_score.ghostauto',
    ));
    savedRobot.startDelayS = 1.25;
    const savedSession = new File(
      [serializeSession([savedRobot], 'chargedup-2023')],
      'alliance.ghpb.json',
      { type: 'application/json' },
    );
    fireEvent.drop(window, { dataTransfer: { files: [savedSession] } });
    await screen.findByText('Stop And Score', { selector: '.robot-name' });
    expect(season).toHaveValue('chargedup-2023');
    expect(screen.queryByText('Straight Run', { selector: '.robot-name' })).not.toBeInTheDocument();
    expect(selectRobot('Stop And Score').getByRole('spinbutton', { name: /delay/i })).toHaveValue(1.25);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(season).toHaveValue('reefscape-2025');
    expect(selectRobot('Straight Run').getByRole('spinbutton', { name: /delay/i })).toHaveValue(0.5);
    expect(screen.queryByText('Stop And Score', { selector: '.robot-name' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(season).toHaveValue('chargedup-2023');
    expect(selectRobot('Stop And Score').getByRole('spinbutton', { name: /delay/i })).toHaveValue(1.25);
    expect(screen.queryByText('Straight Run', { selector: '.robot-name' })).not.toBeInTheDocument();
  });

  it('preserves Redo when entering edit mode without changing a visible robot', async () => {
    render(<App />);
    await importSamples('traj/v3_swerve.traj');
    const delay = selectRobot('swerve').getByRole('spinbutton', { name: /delay/i });
    fireEvent.change(delay, { target: { value: '2' } });
    fireEvent.blur(delay);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(delay).toHaveValue(0);
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    fireEvent.click(selectRobot('swerve').getByRole('button', { name: /edit path|adjust path/i }));
    expect(document.querySelector('.waypoint-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByRole('spinbutton', { name: /delay/i })).toHaveValue(2);
    expect(document.querySelector('.editing-banner')).toHaveTextContent('swerve');
  });
});
