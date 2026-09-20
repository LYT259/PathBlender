/** Route library: folder import, per-robot route switching, robot profiles. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const samples = resolve(__dirname, '../../../samples');

/** File carrying a relative path, as folder inputs and recursive drops do. */
function folderFile(samplePath: string, relPath: string, text?: string) {
  const file = new File([text ?? readFileSync(resolve(samples, samplePath), 'utf8')], relPath.split('/').at(-1)!, {
    type: 'application/json',
  });
  Object.defineProperty(file, 'webkitRelativePath', { value: relPath });
  return file;
}

const L1 = ['traj/v3_swerve.traj', '254/autos/L1.traj'] as const;
const TWO = ['traj/v2025.0.0_swerve.traj', '254/autos/TwoPiece.traj'] as const;
const GHOST = ['ghostauto/straight_run.ghostauto', '254/autos/straight_run.ghostauto'] as const;

const SETTINGS = JSON.stringify({
  robotConfig: {
    holonomicMode: true,
    robotMassKg: 70,
    robotWidth: 0.82,
    robotLength: 1.05,
    modules: [{ x: 0.3, y: 0.3 }, { x: 0.3, y: -0.3 }, { x: -0.3, y: 0.3 }, { x: -0.3, y: -0.3 }],
  },
});

async function importFolder(files: File[]) {
  fireEvent.drop(window, { dataTransfer: { files } });
}

describe('route library workflow', () => {
  beforeEach(() => {
    localStorage.clear();
    // Resolve open toasts between waits.
    vi.restoreAllMocks();
  });

  it('imports a folder into the library, seeds one robot, and tolerates bystanders', async () => {
    render(<App />);
    await importFolder([
      folderFile(...L1),
      folderFile(...TWO),
      folderFile(...GHOST),
      folderFile('', '254/deploy/pathplanner/settings.json', SETTINGS),
      new File(['binary-ish'], 'thumbnail.png', { type: 'image/png' }),
    ]);

    // Exactly one robot seeded from a folder import; the rest wait in the library.
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    // Bystanders and profiles never surface as import errors.
    await waitFor(() => expect(screen.queryByRole('status', { name: '' })?.textContent ?? '').toContain('3 routes'));
    expect(document.querySelector('.import-banner')).toBeNull();

    // The library panel lists the routes and the profile.
    const panel = screen.getByText('Route library (3)').closest('section')!;
    expect(within(panel).getAllByRole('listitem')).toHaveLength(4); // 3 routes + 1 profile

    // Seeded robot keeps its identity stable; team inferred from the folder.
    await waitFor(() => expect(document.querySelector('.robot-library-team')?.textContent).toBe('#254'));
  });

  it('switches a robot between library routes live, with undo restoring the previous route', async () => {
    render(<App />);
    await importFolder([folderFile(...GHOST), folderFile(...TWO)]);

    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    const picker = screen.getByRole('combobox', { name: /Active route for/i });
    // Ghost duration ≈8.3 s vs traj — the picker lists both.
    expect(picker.querySelectorAll('option')).toHaveLength(2);

    const before = screen.getByText('8.30 s');
    expect(before).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: within(document.body).getAllByRole('option')[1]!.value } });
    // Duration text refreshes to the other route's.
    await waitFor(() => expect(screen.queryByText('8.30 s')).toBeNull());

    // Undo puts the previous route back (switching is a session change).
    fireEvent.click(screen.getByRole('button', { name: /^Undo$/i }));
    await waitFor(() => expect(screen.getByText('8.30 s')).toBeInTheDocument());
  });

  it('places a second robot from the library with the + button', async () => {
    render(<App />);
    await importFolder([folderFile(...GHOST), folderFile(...TWO)]);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));

    fireEvent.click(screen.getAllByRole('button', { name: /Add .* as a robot/i })[0]!);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2));
    // Two distinct slots (selection targets the new one).
    expect(screen.getAllByRole('button', { name: /Ghost|, 8\.30 s/i }).length).toBeGreaterThan(0);
  });

  it('applies an imported robot profile to the bumper footprint', async () => {
    render(<App />);
    await importFolder([folderFile(...GHOST), folderFile('', '254/settings.json', SETTINGS)]);
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));

    fireEvent.click(screen.getByText('Straight Run', { selector: '.robot-name' }));
    fireEvent.click(screen.getByRole('button', { name: /^Robot$/i }));

    const profileSelect = await screen.findByRole('combobox', { name: 'Robot profile' });
    fireEvent.change(profileSelect, { target: { value: within(profileSelect).getAllByRole('option')[1]!.value } });

    // 1.05 × 0.82 from the settings file, now marked as file-sourced.
    await waitFor(() => expect(screen.getByText('1.05 m')).toBeInTheDocument());
    expect(screen.getByText('0.82 m')).toBeInTheDocument();
    expect(screen.getByText('From file')).toBeInTheDocument();
  });

  it('keeps single-file imports placing one robot per file', async () => {
    render(<App />);
    const files = [GHOST, TWO].map(([sample]) => new File(
      [readFileSync(resolve(samples, sample), 'utf8')],
      sample.split('/').at(-1)!,
      { type: 'application/json' },
    ));
    fireEvent.drop(window, { dataTransfer: { files } });
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2));
  });
});
