/** First-use guidance runs through the real import, playback and check flows. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSession, parsePathFile, serializeSession } from '@pathblender/core';
import { App } from '../src/App';

const sampleText = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
const playHint = 'Press Play to see the paths, or scrub the timeline.';
const checkHint = 'Select an issue below to jump to that moment.';

function sessionInput() {
  return document.querySelector<HTMLInputElement>('input[type="file"][accept=".pb,.ghpb.json"]')!;
}

async function openExample() {
  fireEvent.click(screen.getByRole('button', { name: 'Try an example' }));
  await screen.findByText('#8814', { selector: '.robot-name' }, { timeout: 10000 });
  expect(screen.getByText('#11019', { selector: '.robot-name' })).toBeInTheDocument();
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
    expect(within(welcome).queryByRole('button', { name: 'Demo mode' })).not.toBeInTheDocument();
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
    // Legacy pre-rename extension: files already on disk must keep opening.
    const saved = new File([serializeSession([robot], 'chargedup-2023')], 'previous.ghpb.json', { type: 'application/json' });
    fireEvent.change(sessionInput(), { target: { files: [saved] } });
    await screen.findByText('#0001', { selector: '.robot-name' });
    expect(screen.getByRole('combobox', { name: 'Game season' })).toHaveValue('chargedup-2023');
    fireEvent.click(screen.getByText('#0001', { selector: '.robot-name' }));
    expect(within(screen.getByRole('region', { name: 'Straight Run', exact: true })).getByText('1.25 s')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Import paths to get started' })).not.toBeInTheDocument();
  });

  it('loads the 2D example paused at t=0, and teaches collision navigation using the working controls', async () => {
    render(<App />);
    await openExample();
    expect(screen.getByText('Real 2026 routes from FRC teams 8814 and 11019.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // No autoplay (user request 2026-10-04): the example rests at t=0 until
    // the user presses Play, so the play tip still shows.
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeInTheDocument();
    expect(Number((screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement).value)).toBeCloseTo(0);
    expect(screen.getByText(playHint)).toBeInTheDocument();
    expect(screen.getByText('2.75 s', { selector: '.robot-library-meta span' })).toBeInTheDocument();
    expect(screen.getByText('3.41 s', { selector: '.robot-library-meta span' })).toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.conflict-count' })).toBeInTheDocument();
    expect(screen.getByText(checkHint)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Play', exact: true }));
    await screen.findByRole('button', { name: 'Pause', exact: true });
    await waitFor(() => expect(localStorage.getItem('pb.tip.play.v1')).toBe('done'));

    fireEvent.click(screen.getByRole('button', { name: 'Pause', exact: true }));
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByText('#8814 × #11019', { selector: '.conflict-pair' }).closest('button')!);
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeInTheDocument();
    expect(Number((screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement).value)).toBeCloseTo(0);
    expect(screen.queryByText(checkHint)).not.toBeInTheDocument();
    expect(localStorage.getItem('pb.tip.checks.v1')).toBe('done');
  });

  it('remembers dismissed guidance when the app is reopened', async () => {
    const first = render(<App />);
    await openExample();
    // Nothing auto-plays anymore (2026-10-04): dismiss both tips by hand.
    const playNote = screen.getByText(playHint).closest('[role="note"]')! as HTMLElement;
    fireEvent.click(within(playNote).getByRole('button', { name: 'Dismiss tip' }));
    const note = screen.getByText(checkHint).closest('[role="note"]')! as HTMLElement;
    fireEvent.click(within(note).getByRole('button', { name: 'Dismiss tip' }));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    first.unmount();

    render(<App />);
    await openExample();
    expect(screen.queryByText(playHint)).not.toBeInTheDocument();
    expect(screen.queryByText(checkHint)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  });

  it('replaces a stale example from an older build with the current example on restore', async () => {
    // Autosave written by an old build: the pre-rename demo generation —
    // legacy localized names, 0001/0002 team numbers, random ids.
    const stale = [0, 1].map((i) => {
      const robot = makeSession(parsePathFile(sampleText, 'straight_run.ghostauto'), i);
      robot.trajectory = {
        ...robot.trajectory,
        id: crypto.randomUUID(),
        name: i === 0 ? '示例路径 A' : 'Example path B',
        teamNumber: `000${i + 1}`,
      };
      return robot;
    });
    localStorage.setItem('pb.autosave.v1', serializeSession(stale, 'rebuilt-2026'));

    render(<App />);
    await screen.findByText('#8814', { selector: '.robot-name' }, { timeout: 10000 });
    expect(screen.getByText('#11019', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.queryByText('#0001', { selector: '.robot-name' })).not.toBeInTheDocument();
    // The refreshed example does not auto-play either.
    expect(screen.getByRole('button', { name: 'Play', exact: true })).toBeInTheDocument();
  });

  it('refreshes only the example robot when a restore mixes one with user paths', async () => {
    const example = makeSession(parsePathFile(sampleText, 'straight_run.ghostauto'), 0);
    example.trajectory = { ...example.trajectory, id: crypto.randomUUID(), name: '示例路径 A', teamNumber: '0001' };
    const mine = makeSession(parsePathFile(sampleText, 'straight_run.ghostauto'), 1);
    mine.trajectory = { ...mine.trajectory, id: 'my-robot', name: 'My Robot', teamNumber: '1234' };
    localStorage.setItem('pb.autosave.v1', serializeSession([example, mine], 'rebuilt-2026'));

    render(<App />);
    await screen.findByText('#8814', { selector: '.robot-name' }, { timeout: 10000 });
    expect(screen.getByText('#1234', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.queryByText('#11019', { selector: '.robot-name' })).not.toBeInTheDocument();
    expect(screen.queryByText('#0001', { selector: '.robot-name' })).not.toBeInTheDocument();
  });

  it('ends only the example paths after a real file is imported', async () => {
    render(<App />);
    await openExample();
    fireEvent.drop(window, { dataTransfer: { files: [new File([sampleText], 'straight_run.ghostauto')] } });
    await screen.findByText('#0001', { selector: '.robot-name' });
    fireEvent.click(screen.getByRole('button', { name: 'End example' }));
    expect(screen.queryByText('#8814', { selector: '.robot-name' })).not.toBeInTheDocument();
    expect(screen.queryByText('#11019', { selector: '.robot-name' })).not.toBeInTheDocument();
    expect(screen.getByText('#0001', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.queryByText('Real 2026 routes from FRC teams 8814 and 11019.')).not.toBeInTheDocument();
  });

  it('lists each route exactly once in the picker, with the library L1 as the current one', async () => {
    render(<App />);
    await openExample();
    // Regression: the off-library pseudo option duplicated L1 next to the
    // library's own L1 (the example robot carries no routeId by design).
    const picker = screen.getByRole('combobox', { name: 'Active route for #8814' });
    const options = within(picker).getAllByRole('option') as HTMLOptionElement[];
    expect(options).toHaveLength(22);
    expect(options.filter((o) => o.textContent === 'L1')).toHaveLength(1);
    expect(options.every((o) => o.value !== '')).toBe(true);
    expect(picker).toHaveValue(options.find((o) => o.textContent === 'L1')!.value);
    const second = screen.getByRole('combobox', { name: 'Active route for #11019' });
    const secondOptions = within(second).getAllByRole('option') as HTMLOptionElement[];
    expect(secondOptions).toHaveLength(20);
    expect(secondOptions.filter((o) => o.textContent === 'L1')).toHaveLength(1);
    expect(second).toHaveValue(secondOptions.find((o) => o.textContent === 'L1')!.value);
  });

  it("hides a robot's conflicts and bounds with the robot, and brings them back", async () => {
    render(<App />);
    await openExample();
    // Both L1s share a start pose: one conflict pair; both robots also
    // start a hair over the line.
    expect(screen.getByText('1', { selector: '.conflict-count' })).toBeInTheDocument();
    expect(screen.getByText('2', { selector: '.bounds-count' })).toBeInTheDocument();
    expect(screen.getByText('#8814 × #11019', { selector: '.conflict-pair' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide #8814 on field' }));
    expect(screen.getByText('0', { selector: '.conflict-count' })).toBeInTheDocument();
    expect(screen.queryByText('#8814 × #11019', { selector: '.conflict-pair' })).not.toBeInTheDocument();
    expect(screen.getByText('1', { selector: '.bounds-count' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide #11019 on field' }));
    expect(screen.queryByText('1', { selector: '.bounds-count' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show #8814 on field' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show #11019 on field' }));
    expect(screen.getByText('1', { selector: '.conflict-count' })).toBeInTheDocument();
    expect(screen.getByText('2', { selector: '.bounds-count' })).toBeInTheDocument();
    expect(screen.getByText('#8814 × #11019', { selector: '.conflict-pair' })).toBeInTheDocument();
  });

  it('adds a folder as its own team while the example is open, and keeps it after ending the example', async () => {
    render(<App />);
    await openExample();
    const route = new File([sampleText], 'straight_run.ghostauto');
    Object.defineProperty(route, 'webkitRelativePath', { value: 'routes/straight_run.ghostauto' });
    fireEvent.drop(window, { dataTransfer: { files: [route] } });
    await screen.findByRole('combobox', { name: 'Active route for #0001' });
    expect(document.querySelectorAll('.robot-library-row')).toHaveLength(3);
    expect(screen.getByRole('combobox', { name: 'Active route for #8814' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Active route for #11019' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End example' }));
    expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1);
    expect(screen.getByText('#0001', { selector: '.robot-name' })).toBeInTheDocument();
    expect(document.querySelector('.route-library-panel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'End example' })).not.toBeInTheDocument();
  });

  it('reports an invalid saved session without replacing the currently loaded scene', async () => {
    render(<App />);
    await openExample();
    fireEvent.change(sessionInput(), { target: { files: [new File(['{"app":"not-a-session"}'], 'broken.pb')] } });
    await waitFor(() => expect(document.querySelector('.import-banner')).toHaveTextContent('broken.pb'));
    expect(screen.getByText('#8814', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('#11019', { selector: '.robot-name' })).toBeInTheDocument();
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
