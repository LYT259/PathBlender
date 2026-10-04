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
  fireEvent.click(screen.getByText(({ 'Straight Run': '#0001', 'Stop And Score': '#0002', 'Side Lane': '#0003' } as Record<string, string>)[name] ?? name, { selector: '.robot-name' }));
  return within(screen.getByRole('region', { name, exact: true }));
}

function openChecks() {
  fireEvent.click(screen.getByRole('button', { name: /^Checks/i }));
}

const conflictPair = () => screen.getByText('#0001 × #0002', { selector: '.conflict-pair' });

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

  it('returns from robot details to checks without removing a robot', async () => {
    render(<App />);
    await importSamples('ghostauto/straight_run.ghostauto', 'ghostauto/stop_and_score.ghostauto');
    selectRobot('Straight Run');
    openChecks();

    expect(screen.queryByRole('region', { name: 'Straight Run', exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Checks/i })).toHaveAttribute('aria-pressed', 'true');
    expect(conflictPair()).toBeVisible();
    expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();

    // Selecting a robot again reopens its details.
    selectRobot('Stop And Score');
    expect(screen.getByRole('region', { name: 'Stop And Score', exact: true })).toBeVisible();
  });

  it('drops hidden robots from collision analysis until they are shown again, then pauses at a selected conflict', async () => {
    render(<App />);
    await importSamples('ghostauto/straight_run.ghostauto', 'ghostauto/stop_and_score.ghostauto');
    expect(conflictPair()).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.conflict-count' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /hide.*#0001/i }));
    expect(screen.getByRole('button', { name: /show.*#0001/i })).toHaveAttribute('aria-pressed', 'false');
    // Hidden means absent for checks too (user request 2026-10-04): the
    // conflict pair and its count leave with the robot…
    expect(screen.queryByText('#0001 × #0002', { selector: '.conflict-pair' })).not.toBeInTheDocument();
    expect(screen.getByText('0', { selector: '.conflict-count' })).toBeInTheDocument();

    // …and come back when it does.
    fireEvent.click(screen.getByRole('button', { name: /show.*#0001/i }));
    expect(conflictPair()).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.conflict-count' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Play$/i }));
    expect(screen.getByRole('button', { name: /^Pause$/i })).toBeInTheDocument();
    fireEvent.click(conflictPair().closest('button')!);

    expect(screen.getByRole('button', { name: /^Play$/i })).toBeInTheDocument();
    expect(Number((screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement).value)).toBeGreaterThan(0);
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

  it('switches the field, and a saved session restores the field and robots together with timing', async () => {
    render(<App />);
    await importSamples('ghostauto/straight_run.ghostauto');
    const season = screen.getByRole('combobox', { name: 'Game season' });
    expect(season).toHaveValue('rebuilt-2026');
    fireEvent.change(season, { target: { value: 'reefscape-2025' } });
    expect(season).toHaveValue('reefscape-2025');
    expect(screen.getByText('#0001', { selector: '.robot-name' })).toBeInTheDocument();

    // Restore a different saved session, including its field and timing.
    const savedRobot = makeSession(parsePathFile(
      readFileSync(resolve(samples, 'ghostauto/stop_and_score.ghostauto'), 'utf8'),
      'stop_and_score.ghostauto',
    ));
    savedRobot.startDelayS = 1.25;
    const savedSession = new File(
      [serializeSession([savedRobot], 'chargedup-2023')],
      'alliance.pb',
      { type: 'application/json' },
    );
    fireEvent.drop(window, { dataTransfer: { files: [savedSession] } });
    await screen.findByText('#0002', { selector: '.robot-name' });
    expect(season).toHaveValue('chargedup-2023');
    expect(screen.queryByText('#0001', { selector: '.robot-name' })).not.toBeInTheDocument();
    expect(selectRobot('Stop And Score').getByRole('spinbutton', { name: 'Start 1' })).toHaveValue(1.25);
  });

  it('undoes and redoes scene changes with the toolbar buttons and ⌘Z', async () => {
    render(<App />);
    await importSamples('ghostauto/straight_run.ghostauto', 'ghostauto/stop_and_score.ghostauto');

    // Workspace chrome: undo/redo only — the side panels are not
    // collapsible (2026-10-04), so the sidebar toggles are gone and both
    // panels stay open. The import itself is an undoable step, so Undo is
    // already armed; Redo waits until something has been undone.
    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    const redoBtn = screen.getByRole('button', { name: 'Redo' });
    expect(undoBtn).toBeEnabled();
    expect(redoBtn).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Show or hide path list' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show or hide inspector' })).not.toBeInTheDocument();
    expect(document.querySelector('.workspace-inspector')).not.toHaveAttribute('hidden');

    // Clearing the session is one more undoable step.
    fireEvent.click(document.querySelector<HTMLElement>('summary[aria-label="More actions"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(0));
    expect(undoBtn).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Show or hide path list' })).not.toBeInTheDocument();

    // ⌘Z restores both robots. The controls unmount with the last robot,
    // so re-query rather than reuse the pre-clear references.
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2));
    expect(screen.getByText('#0001', { selector: '.robot-name' })).toBeInTheDocument();
    const redoBtnAgain = screen.getByRole('button', { name: 'Redo' });
    expect(redoBtnAgain).toBeEnabled();

    // Redo clears again.
    fireEvent.click(redoBtnAgain);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(0));
  });
});
