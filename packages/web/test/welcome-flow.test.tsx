/** First-use guidance runs through the real import, playback and check flows. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSession, parsePathFile, serializeSession } from '@pathblender/core';
import { App } from '../src/App';

const sampleText = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
const playHint = 'Press Play to see the paths, or scrub the timeline.';
const checkHint = 'Select an issue below to jump to that moment.';

function sessionInput() {
  return document.querySelector<HTMLInputElement>('input[type="file"][accept=".ghpb.json"]')!;
}

async function openExample() {
  fireEvent.click(screen.getByRole('button', { name: 'Try an example' }));
  await screen.findByText('Example path A', { selector: '.robot-name' });
  expect(screen.getByText('Example path B', { selector: '.robot-name' })).toBeInTheDocument();
}

beforeEach(() => localStorage.clear());

describe('welcome flow', () => {
  it('shows the brand and starting actions while retaining accessible descriptions', () => {
    render(<App />);
    const welcome = screen.getByRole('region', { name: 'Import paths to get started' });
    expect(within(welcome).getAllByRole('button')).toHaveLength(4);
    expect(within(welcome).getByRole('heading', { name: 'PathBlender' })).toBeInTheDocument();
    expect(welcome.textContent).toBe('PathBlenderImport path filesImport folderOpen saved sessionTry an example');
    expect(within(welcome).getByRole('button', { name: 'Import path files' })).toHaveAccessibleDescription(/Choreo or PathPlanner/);
    const folder = within(welcome).getByRole('button', { name: 'Import folder' });
    expect(folder).toHaveAccessibleDescription(/several routes.*choose which to replay/);
    expect(within(welcome).getByRole('button', { name: 'Open saved session' })).toHaveAccessibleDescription(/previously saved analysis/);
    expect(within(welcome).getByRole('button', { name: 'Try an example' })).toHaveAccessibleDescription(/playback and collision checks/);
    expect(within(welcome).queryByText('You can also drop files or a folder into this window')).not.toBeInTheDocument();

    const toolbar = within(document.querySelector<HTMLElement>('.toolbar')!);
    expect(toolbar.getAllByRole('button').map((button) => button.getAttribute('aria-label') || button.textContent)).toEqual(['Preferences']);
    expect(toolbar.queryByText('PathBlender', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'How to use PathBlender' })).not.toBeInTheDocument();
  });

  it('opens the corresponding picker from each import action, with files first', () => {
    render(<App />);
    const welcome = within(screen.getByRole('region', { name: 'Import paths to get started' }));
    const folder = welcome.getByRole('button', { name: 'Import folder' });
    const files = welcome.getByRole('button', { name: 'Import path files' });
    expect(welcome.getAllByRole('button').slice(0, 2)).toEqual([files, folder]);

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][multiple]:not([webkitdirectory])')!;
    const folderInput = document.querySelector<HTMLInputElement>('input[webkitdirectory]')!;
    const filePicker = vi.spyOn(fileInput, 'click').mockImplementation(() => undefined);
    const folderPicker = vi.spyOn(folderInput, 'click').mockImplementation(() => undefined);
    const savedPicker = vi.spyOn(sessionInput(), 'click').mockImplementation(() => undefined);
    try {
      fireEvent.click(folder);
      expect(folderPicker).toHaveBeenCalledOnce();
      expect(filePicker).not.toHaveBeenCalled();
      expect(savedPicker).not.toHaveBeenCalled();

      fireEvent.click(files);
      expect(filePicker).toHaveBeenCalledOnce();
      expect(folderPicker).toHaveBeenCalledOnce();
      expect(savedPicker).not.toHaveBeenCalled();
    } finally {
      filePicker.mockRestore();
      folderPicker.mockRestore();
      savedPicker.mockRestore();
    }
  });

  it('opens a saved session through its own picker and restores its field and timing', async () => {
    render(<App />);
    const picker = vi.spyOn(sessionInput(), 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Open saved session' }));
    expect(picker).toHaveBeenCalledOnce();
    picker.mockRestore();

    const robot = makeSession(parsePathFile(sampleText, 'straight_run.ghostauto'));
    robot.startDelayS = 1.25;
    const saved = new File([serializeSession([robot], 'chargedup-2023')], 'previous.ghpb.json', { type: 'application/json' });
    fireEvent.change(sessionInput(), { target: { files: [saved] } });
    await screen.findByText('Straight Run', { selector: '.robot-name' });
    expect(screen.getByRole('combobox', { name: 'Game season' })).toHaveValue('chargedup-2023');
    fireEvent.click(screen.getByText('Straight Run', { selector: '.robot-name' }));
    expect(within(screen.getByRole('region', { name: 'Straight Run', exact: true })).getByText('1.25 s')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Import paths to get started' })).not.toBeInTheDocument();
  });

  it('loads a paused 2D example and teaches playback and collision navigation using the working controls', async () => {
    render(<App />);
    await openExample();
    expect(screen.getByText('Fictional paths for exploring the app.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('slider')).toHaveValue('0');
    expect(screen.getAllByText('20.00 s', { selector: '.robot-library-meta span' })).toHaveLength(2);
    expect(screen.getByText('1', { selector: '.conflict-count' })).toBeInTheDocument();
    expect(screen.getByText(playHint)).toBeInTheDocument();
    expect(screen.getByText(checkHint)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Play', exact: true }));
    expect(screen.getByRole('button', { name: 'Pause', exact: true })).toBeInTheDocument();
    expect(screen.queryByText(playHint)).not.toBeInTheDocument();
    expect(localStorage.getItem('ghpb.tip.play.v1')).toBe('done');

    fireEvent.click(screen.getByText('Example path A × Example path B', { selector: '.conflict-pair' }).closest('button')!);
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeInTheDocument();
    expect(Number((screen.getByRole('slider') as HTMLInputElement).value)).toBeCloseTo(10);
    expect(screen.queryByText(checkHint)).not.toBeInTheDocument();
    expect(localStorage.getItem('ghpb.tip.checks.v1')).toBe('done');
  });

  it('remembers dismissed guidance when the app is reopened', async () => {
    const first = render(<App />);
    await openExample();
    for (const hint of [playHint, checkHint]) {
      const note = screen.getByText(hint).closest('[role="note"]')! as HTMLElement;
      fireEvent.click(within(note).getByRole('button', { name: 'Dismiss tip' }));
    }
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    first.unmount();

    render(<App />);
    await openExample();
    expect(screen.queryByText(playHint)).not.toBeInTheDocument();
    expect(screen.queryByText(checkHint)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  });

  it('ends only the example paths after a real file is imported and supports undo', async () => {
    render(<App />);
    await openExample();
    fireEvent.drop(window, { dataTransfer: { files: [new File([sampleText], 'straight_run.ghostauto')] } });
    await screen.findByText('Straight Run', { selector: '.robot-name' });
    fireEvent.click(screen.getByRole('button', { name: 'End example' }));
    expect(screen.queryByText('Example path A', { selector: '.robot-name' })).not.toBeInTheDocument();
    expect(screen.queryByText('Example path B', { selector: '.robot-name' })).not.toBeInTheDocument();
    expect(screen.getByText('Straight Run', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.queryByText('Fictional paths for exploring the app.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(screen.getByText('Example path A', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('Example path B', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('Straight Run', { selector: '.robot-name' })).toBeInTheDocument();
  });

  it('hides history buttons on return to welcome while retaining keyboard undo', async () => {
    render(<App />);
    await openExample();
    fireEvent.click(screen.getByRole('button', { name: 'End example' }));
    expect(screen.getByRole('region', { name: 'Import paths to get started' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show or hide path list' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redo', exact: true })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(screen.getByText('Example path A', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End example' })).toBeInTheDocument();
  });

  it('preserves a real library route that replaced an example robot when ending the example', async () => {
    render(<App />);
    await openExample();
    const route = new File([sampleText], 'straight_run.ghostauto');
    Object.defineProperty(route, 'webkitRelativePath', { value: 'routes/straight_run.ghostauto' });
    fireEvent.drop(window, { dataTransfer: { files: [route] } });
    const picker = await screen.findByRole('combobox', { name: 'Active route for Example path A' });
    const importedOption = within(picker).getByRole('option', { name: /Straight Run/ }) as HTMLOptionElement;
    fireEvent.change(picker, { target: { value: importedOption.value } });
    expect(screen.getByText('Straight Run', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('Example path B', { selector: '.robot-name' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'End example' }));
    expect(screen.getByText('Straight Run', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.queryByText('Example path B', { selector: '.robot-name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End example' })).not.toBeInTheDocument();
  });

  it('keeps routes from a folder accessible when the example ends before a route is selected', async () => {
    render(<App />);
    await openExample();
    const route = new File([sampleText], 'straight_run.ghostauto');
    Object.defineProperty(route, 'webkitRelativePath', { value: 'routes/straight_run.ghostauto' });
    fireEvent.drop(window, { dataTransfer: { files: [route] } });
    await screen.findByRole('combobox', { name: 'Active route for Example path A' });
    fireEvent.click(screen.getByRole('button', { name: 'End example' }));

    expect(screen.getByText('Straight Run', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('Route library (1)')).toBeInTheDocument();
    expect(screen.queryByText('Example path A', { selector: '.robot-name' })).not.toBeInTheDocument();
    expect(screen.queryByText('Example path B', { selector: '.robot-name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End example' })).not.toBeInTheDocument();
  });

  it('does not let a pending example replace the scene the user just restored with Undo', async () => {
    render(<App />);
    await openExample();
    fireEvent.change(screen.getByRole('combobox', { name: 'Game season' }), { target: { value: 'chargedup-2023' } });
    fireEvent.click(screen.getByRole('button', { name: 'End example' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try an example' }));
      fireEvent.keyDown(window, { key: 'z', metaKey: true });
      await vi.dynamicImportSettled();
    });

    expect(screen.getByRole('combobox', { name: 'Game season' })).toHaveValue('chargedup-2023');
    expect(screen.getByText('Example path A', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('Example path B', { selector: '.robot-name' })).toBeInTheDocument();
  });

  it('reports an invalid saved session without replacing the currently loaded scene', async () => {
    render(<App />);
    await openExample();
    fireEvent.change(sessionInput(), { target: { files: [new File(['{"app":"not-a-session"}'], 'broken.ghpb.json')] } });
    await waitFor(() => expect(document.querySelector('.import-banner')).toHaveTextContent('broken.ghpb.json'));
    expect(screen.getByText('Example path A', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('Example path B', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End example' })).toBeInTheDocument();
  });

  it('opens accessible preferences and returns keyboard focus when dismissed', () => {
    render(<App />);
    const help = screen.getByRole('button', { name: 'Preferences' });
    help.focus();
    fireEvent.click(help);
    const dialog = screen.getByRole('dialog', { name: 'Preferences' });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(help).toHaveFocus();
  });
});
