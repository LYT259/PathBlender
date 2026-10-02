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
  it('keeps the import page clean: no field picker or view switch until there is a field', () => {
    render(<App />);
    const input = document.querySelector<HTMLInputElement>('.toolbar input[type="file"]')!;
    const openPicker = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    const welcome = document.querySelector<HTMLElement>('.workspace-empty')!;
    expect(welcome).toBeInTheDocument();
    fireEvent.click(within(welcome).getByRole('button', { name: 'Import path files' }));
    expect(openPicker).toHaveBeenCalledOnce();
    // User directive 2026-09-23: the season picker, its construction variant and
    // the 2D/3D switch are meaningless before anything is loaded, so the whole
    // canvas bar waits for the first robot.
    expect(screen.queryByRole('button', { name: '2D', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '3D', exact: true })).toBeNull();
    expect(document.querySelector('.canvas-bar')).toBeNull();
    expect(document.querySelectorAll('.field-select')).toHaveLength(0);
    // Onboarding now gives explicit starting actions instead of a slogan and
    // repeated numbered instructions. Workspace tools wait for imported paths.
    expect(within(welcome).queryByText('Files stay on this device')).toBeNull();
    expect(within(welcome).getByRole('button', { name: 'Open saved session' })).toBeInTheDocument();
    expect(welcome.textContent).not.toContain('.ghostauto');
    expect(screen.queryByRole('button', { name: /^Undo$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show or hide path list' })).not.toBeInTheDocument();
    expect(document.querySelector('.robot-library')).not.toBeInTheDocument();
    openPicker.mockRestore();
  });

  it('shows the view switch once robots land, defaulting to 2D', async () => {
    render(<App />);
    await importSamples('ghostauto/straight_run.ghostauto');
    expect(screen.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.canvas-bar')).toBeInTheDocument();
  });

  it('closes robot details back to checks without hiding the sidebar or removing a robot', async () => {
    render(<App />);
    await importSamples('ghostauto/straight_run.ghostauto', 'ghostauto/stop_and_score.ghostauto');
    selectRobot('Straight Run');
    fireEvent.click(screen.getByRole('button', { name: 'Close robot details' }));

    expect(screen.queryByRole('region', { name: 'Straight Run', exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Checks/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Show or hide inspector' })).toHaveAttribute('aria-pressed', 'true');
    expect(conflictPair()).toBeVisible();
    expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();

    // Selecting a robot again reopens its details; hiding the entire sidebar
    // remains an explicit action on the toolbar.
    selectRobot('Stop And Score');
    expect(screen.getByRole('region', { name: 'Stop And Score', exact: true })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show or hide inspector' }));
    expect(screen.getByRole('button', { name: 'Show or hide inspector' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: 'Stop And Score', exact: true })).not.toBeInTheDocument();
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

  it('conflicts are reported but never auto-adjusted — the viewer changes nothing', async () => {
    render(<App />);
    await importSamples('ghostauto/straight_run.ghostauto', 'ghostauto/stop_and_score.ghostauto');
    expect(conflictPair()).toBeInTheDocument();
    // Pure viewer (2026-09-30): no suggest/resolve action, no delay inputs.
    expect(screen.queryByRole('button', { name: /suggest|resolve|adjust/i })).not.toBeInTheDocument();
    const inspector = selectRobot('Straight Run');
    expect(inspector.queryByRole('spinbutton', { name: /delay/i })).not.toBeInTheDocument();
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

    // Restore a different saved session, including its field and timing.
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
    expect(selectRobot('Stop And Score').getByText('1.25 s')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(season).toHaveValue('reefscape-2025');
    expect(selectRobot('Straight Run').getByText('0.00 s')).toBeInTheDocument();
    expect(screen.queryByText('Stop And Score', { selector: '.robot-name' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(season).toHaveValue('chargedup-2023');
    expect(selectRobot('Stop And Score').getByText('1.25 s')).toBeInTheDocument();
    expect(screen.queryByText('Straight Run', { selector: '.robot-name' })).not.toBeInTheDocument();
  });

  it('undo removes an import back to the welcome screen, redo restores it', async () => {
    render(<App />);
    await importSamples('traj/v3_swerve.traj');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByRole('region', { name: 'Import paths to get started' });

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await screen.findByText('swerve', { selector: '.robot-name' });
    expect(screen.getByRole('combobox', { name: 'Game season' })).toHaveValue('rebuilt-2026');
  });
});
