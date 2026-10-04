/**
 * Launch-to-launch fidelity (user request 2026-10-04: "reopen exactly where
 * I left — every setting identical"): the autosave carries the route picks,
 * the selected robot, the playhead and the playback range, and a quit beats
 * the debounce via a beforeunload flush.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GEOMETRY, makeSession, serializeSession, type SessionTrajectory } from '@pathblender/core';
import { App } from '../src/App';

const robot = (id: string, teamNumber: string, colorIndex: number, y = 2): SessionTrajectory =>
  makeSession({
    id,
    name: `Route ${teamNumber}`,
    teamName: '',
    teamNumber,
    source: 'choreo-traj',
    alliance: 'blue',
    durationS: 8,
    samples: [0, 8].map((t) => ({ t, x: 2 + t, y, heading: 0, vx: 1, vy: 0, omega: 0 })),
    geometry: DEFAULT_GEOMETRY,
    geometrySource: 'default',
    moduleLocations: [],
    events: [],
    warnings: [],
  }, colorIndex);

function seedAutosave(robots: SessionTrajectory[], ui?: Record<string, unknown>) {
  const file = JSON.parse(serializeSession(robots, 'rebuilt-2026')) as Record<string, unknown>;
  if (ui) file.ui = ui;
  localStorage.setItem('pb.autosave.v1', JSON.stringify(file));
}

beforeEach(() => localStorage.clear());

describe('session fidelity across relaunch', () => {
  it('restores the selected robot, playhead and playback range from the autosave', async () => {
    const a = robot('robot-a', '0001', 0);
    const b = robot('robot-b', '0002', 1, 6);
    seedAutosave([a, b], { selectedId: 'robot-b', t: 2.5, playbackRange: 'paths' });

    render(<App />);
    await screen.findByRole('button', { name: /#0002, Choreo/ });
    // Selection: robot-b's card is the pressed one.
    expect(screen.getByRole('button', { name: /#0002, Choreo/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /#0001, Choreo/ })).toHaveAttribute('aria-pressed', 'false');
    // Playback range and playhead (paths range → duration = path length 8 s).
    expect(screen.getByRole('combobox', { name: 'Playback range' })).toHaveValue('paths');
    const slider = screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(2.5);
    expect(slider).toHaveAttribute('aria-valuetext', '2.50 / 8.00 s');
  });

  it('applies defaults over an old autosave that carries no ui slot', async () => {
    seedAutosave([robot('robot-a', '0001', 0), robot('robot-b', '0002', 1, 6)]);

    render(<App />);
    await screen.findByRole('button', { name: /#0002, Choreo/ });
    expect(screen.getByRole('button', { name: /#0001, Choreo/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Playback range' })).toHaveValue('full');
    const slider = screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0);
  });

  it('keeps an adopted route pick across a quit that beats the debounce', async () => {
    const a = robot('robot-a', '0001', 0);
    const b = { ...robot('robot-b', '0002', 1, 6), routeId: 'route-l1' };
    seedAutosave([a, b], { selectedId: 'robot-b', t: 1.25 });

    const first = render(<App />);
    await screen.findByRole('button', { name: /#0002, Choreo/ });
    // Change something and quit immediately — the 600 ms debounce never
    // fires, so only the beforeunload flush can save this.
    fireEvent.click(screen.getByRole('button', { name: /#0001, Choreo/ }));
    fireEvent(window, new Event('beforeunload'));
    first.unmount();

    render(<App />);
    await screen.findByRole('button', { name: /#0002, Choreo/ });
    expect(screen.getByRole('button', { name: /#0001, Choreo/ })).toHaveAttribute('aria-pressed', 'true');
    const slider = screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(1.25);
  });

  it('keeps an adopted example route (M5) across relaunch — never refreshed', async () => {
    const first = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Try an example' }));
    await screen.findByText('#11019', { selector: '.robot-name' }, { timeout: 10000 });

    // Adopt #11019 by picking M5 from its library, then quit at once.
    const picker = screen.getByRole('combobox', { name: 'Active route for #11019' });
    fireEvent.change(picker, { target: { value: 'welcome-example-route-11019-M5' } });
    expect(picker).toHaveValue('welcome-example-route-11019-M5');
    fireEvent(window, new Event('beforeunload'));
    first.unmount();

    render(<App />);
    await screen.findByText('#11019', { selector: '.robot-name' }, { timeout: 10000 });
    // Still adopted, still on M5 — the example refresh must not touch it.
    expect(screen.getByRole('combobox', { name: 'Active route for #11019' })).toHaveValue(
      'welcome-example-route-11019-M5',
    );
    // The untouched example robot (#8814) still refreshes to the current demo.
    expect(screen.getByRole('combobox', { name: 'Active route for #8814' })).toHaveValue(
      'welcome-example-route-8814-L1',
    );
  });

  it('falls back to the first robot when the saved selection no longer exists', async () => {
    // Saved selection points at a pre-rename example robot; the refresh
    // replaces it, so the selection must fall back rather than dangle.
    const stale = robot('stale-example', '0001', 0);
    stale.trajectory = { ...stale.trajectory, name: '示例路径 A' };
    seedAutosave([stale, robot('robot-b', '0002', 1, 6)], { selectedId: 'stale-example' });

    render(<App />);
    await screen.findByText('#8814', { selector: '.robot-name' }, { timeout: 10000 });
    expect(screen.getByRole('button', { name: /#8814, Choreo/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /#0002, Choreo/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
