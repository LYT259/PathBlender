/** Team-owned folder routes: automatic placement, identity and persistence. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { saveText } from '../src/download';

vi.mock('../src/download', () => ({ saveText: vi.fn(async () => true) }));
const samples = resolve(__dirname, '../../../samples');
const TRAJ = readFileSync(resolve(samples, 'traj/v3_swerve.traj'), 'utf8');
const GHOST = readFileSync(resolve(samples, 'ghostauto/straight_run.ghostauto'), 'utf8');
function folderFile(relPath: string, text = TRAJ) {
  const file = new File([text], relPath.split('/').at(-1)!, { type: 'application/json' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relPath });
  return file;
}
function importFolder(files: File[]) { fireEvent.drop(window, { dataTransfer: { files } }); }
const rows = () => [...document.querySelectorAll('.robot-library-row')] as HTMLElement[];
const rowFor = (label: string) => rows().find((r) => r.textContent?.includes(label))!;
const choices = (picker: HTMLElement) => within(picker).getAllByRole('option') as HTMLOptionElement[];
/** The composer is the one route-selection surface since the left picker left. */
async function openComposer(label: string) {
  await waitFor(() => expect(rows().some((r) => r.textContent?.includes(label))).toBe(true));
  fireEvent.click(within(rowFor(label)).getByRole('button', { name: 'Arrange timeline' }));
  await waitFor(() => expect(document.querySelector('.sequence-composer')).toBeTruthy());
}
const closeComposer = () => fireEvent.click(screen.getByRole('button', { name: 'Back to playback' }));
const composerClips = () => [...document.querySelectorAll('.sequence-track.is-editing .sequence-clip')] as HTMLElement[];
const sourceButtons = () => [...document.querySelectorAll('.sequence-route-source')] as HTMLElement[];
const sourceLabels = () => sourceButtons().map((b) => b.getAttribute('aria-label')!.split(':')[0]!);
/** Select the single clip and replace its route with the named library route, then Save. */
function replaceOnlyClip(target: string) {
  fireEvent.click(composerClips()[0]!);
  const source = sourceButtons().find((b) => b.getAttribute('aria-label')?.startsWith(`${target}: `))!;
  fireEvent.click(source);
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  expect(composerClips()[0]!.getAttribute('aria-label')).toMatch(new RegExp(`^${target},`));
}
const SETTINGS = JSON.stringify({ robotConfig: { robotWidth: 0.82, robotLength: 1.05,
  modules: [{ x: 0.3, y: 0.3 }, { x: 0.3, y: -0.3 }, { x: -0.3, y: 0.3 }, { x: -0.3, y: -0.3 }],
} });

describe('team folder workflow', () => {
  beforeEach(() => {
    localStorage.clear();
    // Pin meters: these assertions use the dimension text as a proxy for
    // "profile applied"; the unit preference has its own coverage.
    localStorage.setItem('pb.lengthUnit', 'm');
    vi.clearAllMocks();
  });

  it('automatically places one team on the first naturally sorted route, without a library panel', async () => {
    render(<App />);
    importFolder([folderFile('254/L10.traj'), folderFile('254/L2.traj'), folderFile('254/L1.traj'),
      folderFile('254/settings.json', SETTINGS), folderFile('254/image.png', 'not a route')]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    // The composer is the route surface: its library lists the whole folder in
    // natural order and the placed clip is the first one (L1).
    await openComposer('#254');
    expect(sourceLabels()).toEqual(['L1', 'L2', 'L10']);
    expect(composerClips()[0]!.getAttribute('aria-label')).toMatch(/^L1,/);
    closeComposer();
    expect(document.querySelector('.route-library-panel')).toBeNull();
    expect(document.querySelector('.import-banner')).toBeNull();
    expect(document.querySelector('.import-action')).toHaveClass('accent');
    expect(document.querySelector('.import-folder-action')).toHaveClass('accent');
  });

  it('adds a second team even when both selected folders have the same name, without mixing their routes', async () => {
    render(<App />);
    importFolder([folderFile('choreo/L3.traj'), folderFile('choreo/L1.traj')]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    importFolder([folderFile('choreo/L5.traj'), folderFile('choreo/L2.traj')]);
    await waitFor(() => expect(rows()).toHaveLength(2));
    await openComposer('#AAAAAA');
    expect(sourceLabels()).toEqual(['L1', 'L3']);
    closeComposer();
    await openComposer('#BBBBBB');
    expect(sourceLabels()).toEqual(['L2', 'L5']);
    // Switching the second team's route leaves the first team untouched.
    replaceOnlyClip('L5');
    closeComposer();
    await openComposer('#AAAAAA');
    expect(composerClips()[0]!.getAttribute('aria-label')).toMatch(/^L1,/);
  });

  it('keeps the display name, alliance and route choices when switching and reopening a saved session', async () => {
    render(<App />);
    importFolder([folderFile('choreo/L3.traj'), folderFile('choreo/L1.traj')]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    const input = screen.getByRole('textbox', { name: 'Edit display name' });
    expect(input).toHaveAttribute('placeholder', 'AAAAAA');
    fireEvent.change(input, { target: { value: '254' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Red', exact: true }));
    // Replace the placed L1 with L3 through the composer draft.
    await openComposer('254');
    replaceOnlyClip('L3');
    closeComposer();
    expect(screen.getByText('254', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select 254' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Save session', exact: true })[0]!);
    const text = vi.mocked(saveText).mock.calls.at(-1)![2];
    const stored = JSON.parse(text);
    expect(stored.robots[0].displayName).toBe('254');
    expect(stored.robots[0].teamNumber).toBe('AAAAAA'); // imported identity untouched
    expect(stored.robots[0].alliance).toBe('red');
    expect(stored.robots[0].routeOptions).toHaveLength(2);
    expect(stored.robots[0].sequence.segments).toHaveLength(1);
    expect(stored.robots[0].sequence.segments[0].routeId).toBe(stored.robots[0].routeOptions[1].id);
    importFolder([new File([text], 'restored.pb')]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    // The restored route choice survives the round trip, and switching back works.
    await openComposer('254');
    expect(composerClips()[0]!.getAttribute('aria-label')).toMatch(/^L3,/);
    replaceOnlyClip('L1');
    closeComposer();
    expect(screen.getByRole('button', { name: 'Red', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('254', { selector: '.robot-name' })).toBeInTheDocument();
  });

  it('does not erase a placeholder when the editor is opened and left unchanged', async () => {
    render(<App />);
    importFolder([folderFile('choreo/L1.traj')]);
    await screen.findByText('#AAAAAA', { selector: '.robot-name' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    fireEvent.blur(screen.getByRole('textbox', { name: 'Edit display name' }));
    expect(screen.getByText('#AAAAAA', { selector: '.robot-name' })).toBeInTheDocument();
  });

  it('clearing the display name restores the original placeholder identity everywhere', async () => {
    render(<App />);
    importFolder([folderFile('choreo/L1.traj')]);
    await screen.findByText('#AAAAAA', { selector: '.robot-name' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    const input = screen.getByRole('textbox', { name: 'Edit display name' });
    fireEvent.change(input, { target: { value: 'Choreo 主力' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Choreo 主力', { selector: '.robot-name' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit display name' }), { target: { value: '' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit display name' }), { key: 'Enter' });
    expect(screen.getByText('#AAAAAA', { selector: '.robot-name' })).toBeInTheDocument();
  });

  it('keeps each team\'s configuration choices separate', async () => {
    render(<App />);
    importFolder([folderFile('254/straight.ghostauto', GHOST), folderFile('254/settings.json', SETTINGS)]);
    await screen.findByText('#254', { selector: '.robot-name' });
    importFolder([folderFile('1678/L1.traj'), folderFile('1678/settings.json', SETTINGS)]);
    await screen.findByText('#1678', { selector: '.robot-name' });
    fireEvent.click(screen.getByText('#254', { selector: '.robot-name' }));
    const profileSelect = await screen.findByRole('combobox', { name: 'Robot profile' });
    expect(choices(profileSelect)).toHaveLength(2); // prompt + this team's configuration
    expect(choices(profileSelect)[1]).toHaveTextContent('254');
    fireEvent.change(profileSelect, { target: { value: choices(profileSelect)[1]!.value } });
    expect(await screen.findByText('1.05 m')).toBeInTheDocument();
  });

  it('keeps ordinary file imports placing one robot per file', async () => {
    render(<App />);
    importFolder([new File([TRAJ], 'L1.traj'), new File([TRAJ], 'L2.traj')]);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByText('#AAAAAA', { selector: '.robot-name' })).toBeInTheDocument();
    expect(screen.getByText('#BBBBBB', { selector: '.robot-name' })).toBeInTheDocument();
  });

  it('still reports malformed route files while using the valid routes', async () => {
    render(<App />);
    importFolder([folderFile('choreo/broken.traj', '{}'), folderFile('choreo/L1.traj')]);
    await screen.findByText('#AAAAAA', { selector: '.robot-name' });
    expect(document.querySelector('.import-banner')).toHaveTextContent('broken.traj');
    await openComposer('#AAAAAA');
    expect(sourceButtons()).toHaveLength(1);
  });

  it('restores independent route choices after restarting the app', async () => {
    const app = render(<App />);
    importFolder([folderFile('choreo/L1.traj'), folderFile('choreo/L3.traj')]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await openComposer('#AAAAAA');
    replaceOnlyClip('L3');
    closeComposer();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('pb.autosave.v1')!).robots[0].sequence).toBeDefined());
    app.unmount();
    render(<App />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await openComposer('#AAAAAA');
    expect(composerClips()[0]!.getAttribute('aria-label')).toMatch(/^L3,/);
    replaceOnlyClip('L1');
    expect(composerClips()[0]!.getAttribute('aria-label')).toMatch(/^L1,/);
  });

  it('distinguishes duplicate filenames in subfolders', async () => {
    render(<App />);
    importFolder([folderFile('choreo/left/L1.traj'), folderFile('choreo/right/L1.traj')]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await openComposer('#AAAAAA');
    expect(sourceLabels()).toEqual(['left/L1.traj', 'right/L1.traj']);
  });

  it('resolves PathPlanner auto dependencies only inside each imported folder', async () => {
    render(<App />);
    const original = readFileSync(resolve(samples, 'pathplanner/Pickup.path'), 'utf8');
    const shifted = JSON.parse(original);
    for (const waypoint of shifted.waypoints) {
      for (const point of ['anchor', 'prevControl', 'nextControl']) if (waypoint[point]) waypoint[point].x += 2;
    }
    const auto = JSON.stringify({ version: '2025.0', command: { type: 'path', data: { pathName: 'Pickup' } }, resetOdom: true });
    importFolder([folderFile('alpha/paths/Pickup.path', original), folderFile('alpha/autos/Run.auto', auto),
      folderFile('beta/paths/Pickup.path', JSON.stringify(shifted)), folderFile('beta/autos/Run.auto', auto)]);
    await waitFor(() => expect(rows()).toHaveLength(2));
    await openComposer('#AAAAAA');
    replaceOnlyClip('Run');
    closeComposer();
    await openComposer('#BBBBBB');
    replaceOnlyClip('Run');
    closeComposer();
    fireEvent.click(screen.getAllByRole('button', { name: 'Save session', exact: true })[0]!);
    const stored = JSON.parse(vi.mocked(saveText).mock.calls.at(-1)![2]);
    expect(stored.robots[1].samples[0].x - stored.robots[0].samples[0].x).toBeCloseTo(2, 6);
    importFolder([folderFile('gamma/Run.auto', auto)]);
    await waitFor(() => expect(document.querySelector('.import-banner')).toHaveTextContent('Run.auto'));
    expect(rows()).toHaveLength(2);
  });


  it('retains an explicitly selected robot profile when changing the active route', async () => {
    render(<App />);
    importFolder([folderFile('254/L1.traj'), folderFile('254/L3.traj'), folderFile('254/settings.json', SETTINGS)]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByText('#254', { selector: '.robot-name' }));
    const profiles = screen.getByRole('combobox', { name: 'Robot profile' });
    fireEvent.change(profiles, { target: { value: choices(profiles)[1]!.value } });
    expect(await screen.findByText('1.05 m')).toBeInTheDocument();
    await openComposer('#254');
    replaceOnlyClip('L3');
    closeComposer();
    expect(screen.getByText('1.05 m')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Save session', exact: true })[0]!);
    const stored = JSON.parse(vi.mocked(saveText).mock.calls.at(-1)![2]);
    expect(stored.robots[0].profileId).toBe(stored.robots[0].profileOptions[0].id);
    expect(stored.robots[0].geometry.lengthM).toBe(1.05);
  });


  it('keeps a loose Choreo project picked before its path, without assigning it to another folder', async () => {
    render(<App />);
    const project = readFileSync(resolve(samples, 'choreo/choreo.chor'), 'utf8');
    importFolder([new File([project], 'choreo.chor')]);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 robot profile'));
    importFolder([folderFile('folder/L1.traj')]);
    await screen.findByText('#AAAAAA', { selector: '.robot-name' });
    fireEvent.click(screen.getByText('#AAAAAA', { selector: '.robot-name' }));
    expect(screen.queryByRole('combobox', { name: 'Robot profile' })).not.toBeInTheDocument();
    importFolder([new File([TRAJ], 'L2.traj')]);
    await screen.findByText('#BBBBBB', { selector: '.robot-name' });
    fireEvent.click(screen.getByText('#BBBBBB', { selector: '.robot-name' }));
    expect(choices(screen.getByRole('combobox', { name: 'Robot profile' }))).toHaveLength(2);
  });

});
